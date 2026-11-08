import { z } from 'zod';
import { detectDeletions, mergeRows, pruneTombstones, type MergeRules, type MergeSide, type Tombstones } from '@core/sync/merge';
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, gunzip, gzip, sha256Hex } from '@core/util/encoding';
import { applySyncedPreferences, preferences, SYNCED_PREFERENCES, type Preferences } from '@/features/settings/preferences';
import { getFriends, setFriends } from '@/features/friends/friends';
import { applyAttempt, emptyProgress } from '@/features/study/progressRepo';
import { forgetDeviceSecret, loadDeviceSecret, saveDeviceSecret } from '@/infra/crypto/tokenVault';
import { db, kvDelete, kvGet, kvSet } from '@/infra/db/db';
import type { AttemptRow, DraftRow, ExamRow, LocalImageRow, LocalQuestionRow, LocalSubjectRow, ProgressRow, SessionRow } from '@/infra/db/types';
import { checkToken, github, GitHubError, githubJson } from '@/infra/github/client';
import { newPairingCode, openLink, pairingUrl, sealLink, type DeviceLink } from './pairing';
import { deviceSync } from './state';

export { deviceSync };

/**
 * Sincronización entre los dispositivos de una persona. Sin servidores propios: los datos viven en
 * un gist secreto de su cuenta, y un gist secreto lo puede leer quien tenga la URL, así que van
 * cifrados con una clave que GitHub no ve. Nada de esto toca lo oficial: los puntos y los rankings
 * siguen saliendo sólo del registro público de eventos.
 */

const MARKER_FILE = 'questionbank-sync.txt';
const MARKER_TEXT = 'Datos cifrados de QuestionBank: la sincronización entre tus dispositivos. No edites este gist; si lo borras, sólo se pierde la copia. Lo que hay en cada dispositivo no se toca.\n';
const CORE_FILE = 'core.enc';
const BUCKETS = [...'0123456789abcdef'];
const bucketFile = (bucket: string) => `img-${bucket}.enc`;
/** Límite de lo que se manda en una sola escritura. */
const MAX_PATCH_CHARS = 4 * 1024 * 1024;
const MAX_CORE_BYTES = 64 * 1024 * 1024;
const TICK_MS = 60 * 1000;

const SECRET_STATE = 'device-sync-state';

export class DeviceSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceSyncError';
  }
}

/** `CompressionStream` no existe en Safari anterior a 16.4 ni en Firefox anterior a 113. */
export const deviceSyncSupported = (): boolean => typeof CompressionStream !== 'undefined' && typeof crypto.subtle !== 'undefined';

const TABLES = ['sessions', 'drafts', 'lQuestions', 'lSubjects', 'exams', 'friends'] as const;
type TableName = (typeof TABLES)[number];
type TableTombstones = Record<TableName, Tombstones>;

const noTombstones = (): TableTombstones => ({ sessions: {}, drafts: {}, lQuestions: {}, lSubjects: {}, exams: {}, friends: {} });

export interface CoreData {
  attempts: AttemptRow[];
  progress: ProgressRow[];
  sessions: SessionRow[];
  drafts: DraftRow[];
  lQuestions: LocalQuestionRow[];
  lSubjects: LocalSubjectRow[];
  exams: ExamRow[];
  friends: string[];
  tombstones: TableTombstones;
}

const CoreFile = z.object({
  v: z.literal(1),
  attempts: z.array(z.unknown()),
  progress: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  drafts: z.array(z.unknown()),
  lQuestions: z.array(z.unknown()),
  lSubjects: z.array(z.unknown()),
  exams: z.array(z.unknown()),
  friends: z.array(z.string()),
  tombstones: z.record(z.string(), z.record(z.string(), z.number())),
  preferences: z.object({ at: z.number(), values: z.record(z.string(), z.unknown()) }),
});

const RemoteImage = z.object({ hash: z.string(), base64: z.string(), type: z.string() }).loose();

interface Persisted {
  /** `raw_url` de cada fichero la última vez: cambia con su contenido, así se sabe qué ha tocado otro dispositivo. */
  seen: Record<string, string>;
  etag: string | null;
  pushedHash: string | null;
  base: Record<TableName, string[]>;
  tombstones: TableTombstones;
  /** Qué imágenes había en cada grupo al subirlo. */
  buckets: Record<string, string>;
  lastSyncAt: number | null;
}

const freshState = (): Persisted => ({ seen: {}, etag: null, pushedHash: null, base: { sessions: [], drafts: [], lQuestions: [], lSubjects: [], exams: [], friends: [] }, tombstones: noTombstones(), buckets: {}, lastSyncAt: null });

const isoTime = (iso: string) => Date.parse(iso);
const newest = <T>(time: (row: T) => number) => (local: T, remote: T) => (time(remote) > time(local) ? remote : local);

/** Una sesión terminada no vuelve atrás; entre dos abiertas, sigue la que lleva más respuestas. */
export const pickSession = (local: SessionRow, remote: SessionRow): SessionRow => {
  const rank = (s: SessionRow) => (s.state === 'finished' ? 1e6 : 0) + Object.keys(s.answers).length;
  return rank(remote) > rank(local) ? remote : local;
};

const RULES: { [K in TableName]: MergeRules<CoreData[K][number]> } = {
  sessions: { key: (r) => r.id, pick: pickSession },
  drafts: { key: (r) => r.id, pick: newest((r) => r.updatedAt), editedAt: (r) => r.updatedAt },
  lQuestions: { key: (r) => r.id, pick: newest((r) => isoTime(r.updatedAt)), editedAt: (r) => isoTime(r.updatedAt) },
  lSubjects: { key: (r) => r.id, pick: newest((r) => isoTime(r.updatedAt)), editedAt: (r) => isoTime(r.updatedAt) },
  exams: { key: (r) => r.id, pick: newest((r) => r.updatedAt), editedAt: (r) => r.updatedAt },
  friends: { key: (login) => login, pick: (local) => local },
};

const side = <K extends TableName>(data: CoreData, table: K): MergeSide<CoreData[K][number]> => ({ rows: data[table], tombstones: data.tombstones[table] });

function mergeTable<K extends TableName>(local: CoreData, remote: CoreData, table: K, into: CoreData): void {
  const result = mergeRows(side(local, table), side(remote, table), RULES[table]);
  into[table] = result.rows as CoreData[K];
  into.tombstones[table] = result.tombstones;
}

function mergeFlags(row: ProgressRow, local: ProgressRow, remote: ProgressRow): ProgressRow {
  const [mine, theirs] = [local.flagsAt ?? 0, remote.flagsAt ?? 0];
  const favorite = mine === theirs ? ((local.favorite || remote.favorite) as 0 | 1) : mine > theirs ? local.favorite : remote.favorite;
  const hard = mine === theirs ? ((local.hard || remote.hard) as 0 | 1) : mine > theirs ? local.hard : remote.hard;
  const flagsAt = Math.max(mine, theirs);
  if (row.favorite === favorite && row.hard === hard && (row.flagsAt ?? 0) === flagsAt) return row;
  return { ...row, favorite, hard, ...(flagsAt > 0 ? { flagsAt } : {}) };
}

/**
 * Si dos dispositivos repasaron la misma pregunta, quedarse con el más reciente perdería el otro
 * repaso. Los intentos se suman y el estado se rehace en orden, como si todo fuera en uno solo.
 */
export function mergeProgress(local: readonly ProgressRow[], remote: readonly ProgressRow[], attempts: readonly AttemptRow[], retention: number): ProgressRow[] {
  const history = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    const list = history.get(attempt.questionId);
    if (list) list.push(attempt);
    else history.set(attempt.questionId, [attempt]);
  }
  const mine = new Map(local.map((row) => [row.questionId, row]));
  const out: ProgressRow[] = [];
  for (const row of remote) {
    const own = mine.get(row.questionId);
    if (!own) {
      out.push(row);
      continue;
    }
    mine.delete(row.questionId);
    if (own.attempts === row.attempts && own.lastAt === row.lastAt) {
      out.push(mergeFlags(own, own, row));
      continue;
    }
    const answers = (history.get(row.questionId) ?? []).slice().sort((a, b) => a.at - b.at);
    const first = answers[0];
    // Sólo con el historial completo: si faltan intentos, rehacerlo daría un estado peor.
    const rebuilt = first && answers.length >= Math.max(own.attempts, row.attempts) ? answers.reduce((state, attempt) => applyAttempt(state, attempt, retention), emptyProgress(row.questionId, first.at)) : own.lastAt >= row.lastAt ? own : row;
    out.push(mergeFlags({ ...rebuilt, favorite: own.favorite, hard: own.hard, ...(own.flagsAt ? { flagsAt: own.flagsAt } : {}) }, own, row));
  }
  out.push(...mine.values());
  return out;
}

export function mergeCore(local: CoreData, remote: CoreData, retention: number): CoreData {
  const attempts = mergeRows<AttemptRow>({ rows: local.attempts, tombstones: {} }, { rows: remote.attempts, tombstones: {} }, { key: (a) => a.id, pick: (mine, theirs) => (theirs.published > mine.published ? theirs : mine) }).rows;
  const merged: CoreData = { ...local, attempts, progress: mergeProgress(local.progress, remote.progress, attempts, retention), tombstones: noTombstones() };
  for (const table of TABLES) mergeTable(local, remote, table, merged);
  return merged;
}

async function importKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(encoded) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const PREFIX = 'qb1:';

async function seal(value: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(value)));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  return `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
}

async function unseal(text: string, key: CryptoKey): Promise<unknown> {
  const [iv, cipher] = text.slice(PREFIX.length).split('.') as [string, string];
  if (!text.startsWith(PREFIX) || !cipher) throw new DeviceSyncError('La copia de GitHub no tiene un formato válido.');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource }, key, base64ToBytes(cipher) as BufferSource);
  } catch {
    throw new DeviceSyncError('La clave de este dispositivo no abre la copia de GitHub. Vuelve a vincularlo.');
  }
  return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain), MAX_CORE_BYTES)));
}

interface GistFile {
  raw_url: string;
  truncated?: boolean;
  content?: string;
}

interface Gist {
  id: string;
  files: Record<string, GistFile | null>;
}

/** La API corta los ficheros de más de 1 MB: el resto va por su `raw_url`. */
async function readFile(file: GistFile): Promise<string> {
  if (!file.truncated && file.content !== undefined) return file.content;
  const response = await fetch(file.raw_url, { credentials: 'omit' });
  if (!response.ok) throw new DeviceSyncError('No se ha podido bajar la copia de GitHub.');
  return response.text();
}

export async function loadDeviceLink(): Promise<DeviceLink | null> {
  const secret = await loadDeviceSecret();
  return secret ? (JSON.parse(secret) as DeviceLink) : null;
}

const loadPersisted = async () => ({ ...freshState(), ...(await kvGet<Partial<Persisted>>(SECRET_STATE)) });

async function readLocalCore(tombstones: TableTombstones): Promise<CoreData> {
  const [attempts, progress, sessions, drafts, lQuestions, lSubjects, exams, friends] = await Promise.all([db.attempts.toArray(), db.progress.toArray(), db.sessions.toArray(), db.drafts.toArray(), db.lQuestions.toArray(), db.lSubjects.toArray(), db.exams.toArray(), getFriends()]);
  return { attempts, progress, sessions, drafts, lQuestions, lSubjects, exams, friends, tombstones };
}

const idsOf = <K extends TableName>(data: CoreData, table: K): string[] => (data[table] as CoreData[K][number][]).map((row) => RULES[table].key(row as never));

function withDeletions(data: CoreData, persisted: Persisted, now: number): TableTombstones {
  const out = noTombstones();
  for (const table of TABLES) out[table] = pruneTombstones(detectDeletions(persisted.base[table], new Set(idsOf(data, table)), persisted.tombstones[table], now), now);
  return out;
}

async function writeTable<T>(table: { bulkPut(rows: T[]): Promise<unknown>; bulkDelete(keys: string[]): Promise<unknown> }, before: readonly T[], after: readonly T[], key: (row: T) => string): Promise<void> {
  const previous = new Map(before.map((row) => [key(row), row]));
  const changed = after.filter((row) => previous.get(key(row)) !== row);
  const kept = new Set(after.map(key));
  const removed = before.map(key).filter((id) => !kept.has(id));
  if (changed.length > 0) await table.bulkPut(changed);
  if (removed.length > 0) await table.bulkDelete(removed);
}

const STORES = [db.attempts, db.progress, db.sessions, db.drafts, db.lQuestions, db.lSubjects, db.exams, db.kv];

interface RemotePrefs {
  at: number;
  values: Partial<Preferences>;
}

/** Se lee, se funde y se escribe en una sola transacción: una respuesta que llegue mientras tanto no se pierde. */
async function mergeIntoDevice(persisted: Persisted, remote: CoreData | null, now: number): Promise<CoreData> {
  return db.transaction('rw', STORES, async () => {
    const before = await readLocalCore(noTombstones());
    const local: CoreData = { ...before, tombstones: withDeletions(before, persisted, now) };
    if (!remote) return local;
    const merged = mergeCore(local, remote, preferences.get().retention);
    await writeTable(db.attempts, before.attempts, merged.attempts, (r) => r.id);
    await writeTable(db.progress, before.progress, merged.progress, (r) => r.questionId);
    await writeTable(db.sessions, before.sessions, merged.sessions, (r) => r.id);
    await writeTable(db.drafts, before.drafts, merged.drafts, (r) => r.id);
    await writeTable(db.lQuestions, before.lQuestions, merged.lQuestions, (r) => r.id);
    await writeTable(db.lSubjects, before.lSubjects, merged.lSubjects, (r) => r.id);
    await writeTable(db.exams, before.exams, merged.exams, (r) => r.id);
    if (merged.friends.length !== before.friends.length || merged.friends.some((f, i) => f !== before.friends[i])) await setFriends(merged.friends);
    return merged;
  });
}

function toFile(data: CoreData): unknown {
  const prefs = preferences.get();
  return { v: 1, ...data, preferences: { at: prefs.syncedAt, values: Object.fromEntries(SYNCED_PREFERENCES.map((key) => [key, prefs[key]])) } };
}

async function takeRemoteImages(gist: Gist, persisted: Persisted, key: CryptoKey): Promise<void> {
  for (const bucket of BUCKETS) {
    const file = gist.files[bucketFile(bucket)];
    if (!file || persisted.seen[bucketFile(bucket)] === file.raw_url) continue;
    const images = z.array(RemoteImage).parse(await unseal(await readFile(file), key));
    const known = new Set(await db.localImages.where('hash').anyOf(images.map((image) => image.hash)).primaryKeys());
    const fresh = images.filter((image) => !known.has(image.hash));
    if (fresh.length === 0) continue;
    await db.localImages.bulkPut(fresh.map(({ base64, type, ...meta }) => ({ ...(meta as unknown as Omit<LocalImageRow, 'blob'>), blob: new Blob([base64ToBytes(base64) as BlobPart], { type }) })));
  }
}

async function changedImageFiles(persisted: Persisted, key: CryptoKey): Promise<{ files: Record<string, { content: string }>; signatures: Record<string, string> }> {
  const hashes = (await db.localImages.toCollection().primaryKeys()) as string[];
  const files: Record<string, { content: string }> = {};
  const signatures: Record<string, string> = { ...persisted.buckets };
  for (const bucket of BUCKETS) {
    const inBucket = hashes.filter((hash) => hash.startsWith(bucket)).sort();
    if (inBucket.length === 0) continue;
    const signature = await sha256Hex(inBucket.join());
    if (signature === persisted.buckets[bucket]) continue;
    const rows = await db.localImages.bulkGet(inBucket);
    const images = [];
    for (const row of rows) {
      if (!row) continue;
      const { blob, ...meta } = row;
      images.push({ ...meta, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), type: blob.type });
    }
    files[bucketFile(bucket)] = { content: await seal(images, key) };
    signatures[bucket] = signature;
  }
  return { files, signatures };
}

/** La escritura de cada lote es un solo commit del gist. El núcleo, lo último: las imágenes que cita ya están. */
async function pushFiles(link: DeviceLink, files: Record<string, { content: string }>): Promise<Gist> {
  const names = Object.keys(files).sort((a, b) => Number(a === CORE_FILE) - Number(b === CORE_FILE));
  let last: Gist | null = null;
  let batch: Record<string, { content: string }> = {};
  let size = 0;
  const flush = async () => {
    if (size === 0) return;
    last = await githubJson<Gist>(`/gists/${link.gistId}`, { token: link.token, method: 'PATCH', body: { files: batch } });
    batch = {};
    size = 0;
  };
  for (const name of names) {
    const file = files[name] as { content: string };
    if (size > 0 && size + file.content.length > MAX_PATCH_CHARS) await flush();
    batch[name] = file;
    size += file.content.length;
  }
  await flush();
  return last as unknown as Gist;
}

async function syncOnce(link: DeviceLink): Promise<void> {
  const persisted = await loadPersisted();
  const key = await importKey(link.key);
  const response = await github(`/gists/${link.gistId}`, { token: link.token, etag: persisted.etag, fresh: true });
  if (response.status === 401) throw new DeviceSyncError('GitHub ya no acepta el token de este dispositivo. Puede haber caducado: vuelve a vincularlo.');
  if (response.status === 404) throw new DeviceSyncError('La copia de GitHub ya no existe o el token no llega a ella. Vuelve a activarla.');
  if (!response.ok && response.status !== 304) throw new GitHubError(response.status, `GitHub respondió ${response.status}`);

  let remote: CoreData | null = null;
  let remotePrefs: RemotePrefs | null = null;
  const seen = { ...persisted.seen };
  if (response.status !== 304) {
    const gist = (await response.json()) as Gist;
    const core = gist.files[CORE_FILE];
    if (core && persisted.seen[CORE_FILE] !== core.raw_url) {
      const { preferences: prefs, v: _v, ...data } = CoreFile.parse(await unseal(await readFile(core), key));
      remote = { ...(data as unknown as CoreData), tombstones: { ...noTombstones(), ...(data.tombstones as Partial<TableTombstones>) } };
      remotePrefs = prefs as RemotePrefs;
    }
    await takeRemoteImages(gist, persisted, key);
    for (const [name, file] of Object.entries(gist.files)) if (file) seen[name] = file.raw_url;
    persisted.etag = response.headers.get('etag');
  }

  const now = Date.now();
  const merged = await mergeIntoDevice(persisted, remote, now);
  if (remotePrefs && remotePrefs.at > preferences.get().syncedAt) await applySyncedPreferences(remotePrefs.values, remotePrefs.at);

  const file = toFile(merged);
  const hash = await sha256Hex(JSON.stringify(file));
  const { files, signatures } = await changedImageFiles(persisted, key);
  if (hash !== persisted.pushedHash) files[CORE_FILE] = { content: await seal(file, key) };
  if (Object.keys(files).length > 0) {
    const updated = await pushFiles(link, files);
    for (const [name, gistFile] of Object.entries(updated.files)) if (gistFile) seen[name] = gistFile.raw_url;
    persisted.pushedHash = hash;
    persisted.buckets = signatures;
  }

  const base = {} as Record<TableName, string[]>;
  for (const table of TABLES) base[table] = idsOf(merged, table);
  await kvSet(SECRET_STATE, { ...persisted, seen, base, tombstones: merged.tombstones, lastSyncAt: now } satisfies Persisted);
  deviceSync.set({ enabled: true, status: 'idle', message: null, lastSyncAt: now });
}

let running: Promise<void> | null = null;
let again = false;

/** Sólo una a la vez. Si piden otra mientras tanto, se hace una más al acabar. */
export function syncDevices(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = (async () => {
    do {
      again = false;
      const link = await loadDeviceLink().catch(() => null);
      if (!link) {
        deviceSync.set((s) => ({ ...s, enabled: false, status: 'idle', message: null }));
        return;
      }
      deviceSync.set((s) => ({ ...s, enabled: true }));
      if (!navigator.onLine) return;
      deviceSync.set((s) => ({ ...s, status: 'syncing', message: null }));
      try {
        await syncOnce(link);
      } catch (error) {
        const offline = error instanceof TypeError;
        deviceSync.set((s) => ({ ...s, status: offline ? 'idle' : 'error', message: offline ? null : error instanceof Error ? error.message : 'No se ha podido sincronizar.' }));
        return;
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  running = run;
  return run;
}

/** Al abrir, al volver a la app, al irse (para no dejar nada sin subir) y cada minuto mientras está a la vista. */
export function startDeviceSync(): void {
  void kvGet<Partial<Persisted>>(SECRET_STATE).then((state) => deviceSync.set((s) => ({ ...s, lastSyncAt: state?.lastSyncAt ?? null })));
  void syncDevices();
  window.addEventListener('online', () => void syncDevices());
  document.addEventListener('visibilitychange', () => void syncDevices());
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncDevices();
  }, TICK_MS);
}

async function findExistingGist(token: string): Promise<Gist | null> {
  for (let page = 1; page <= 10; page++) {
    const gists = await githubJson<Gist[]>(`/gists?per_page=100&page=${page}`, { token, fresh: true });
    const found = gists.find((gist) => gist.files[MARKER_FILE]);
    if (found) return found;
    if (gists.length < 100) return null;
  }
  return null;
}

async function saveLink(link: DeviceLink): Promise<void> {
  await saveDeviceSecret(JSON.stringify(link));
  await kvDelete(SECRET_STATE);
  deviceSync.set({ enabled: true, status: 'idle', message: null, lastSyncAt: null });
  await syncDevices();
  // Un error de la primera vuelta no se puede quedar en un aviso que nadie relaciona con este paso.
  if (deviceSync.get().status === 'error') throw new DeviceSyncError(deviceSync.get().message ?? 'No se ha podido sincronizar.');
}

export class ExistingCopyError extends Error {
  constructor() {
    super('Tu cuenta ya tiene una copia de otro dispositivo.');
    this.name = 'ExistingCopyError';
  }
}

async function createGist(token: string): Promise<Gist> {
  return githubJson<Gist>('/gists', { token, method: 'POST', body: { description: 'QuestionBank · sincronización cifrada', public: false, files: { [MARKER_FILE]: { content: MARKER_TEXT } } } });
}

/** Los tokens de grano fino no dicen sus permisos: con ellos se ve al usar la API. */
async function assertGistToken(token: string): Promise<void> {
  const { scopes } = await checkToken(token);
  if (scopes.length > 0 && !scopes.includes('gist')) throw new DeviceSyncError('A este token le falta el permiso «gist».');
}

/** Primer dispositivo. Con una copia anterior no se puede usar sin su clave: hay que vincular o empezar de cero. */
export async function enableDeviceSync(rawToken: string, startOver = false): Promise<void> {
  const token = rawToken.trim();
  await assertGistToken(token);
  const existing = await findExistingGist(token);
  if (existing && !startOver) throw new ExistingCopyError();
  if (existing) {
    const removed = await github(`/gists/${existing.id}`, { token, method: 'DELETE' });
    if (!removed.ok && removed.status !== 404) throw new GitHubError(removed.status, `GitHub respondió ${removed.status}`);
  }
  const gist = await createGist(token);
  await saveLink({ token, gistId: gist.id, key: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))) });
}

export async function linkThisDevice(sealed: string, code: string): Promise<void> {
  await saveLink(await openLink(sealed, code));
}

export interface Pairing {
  url: string;
  code: string;
}

export async function createPairing(): Promise<Pairing> {
  const link = await loadDeviceLink();
  if (!link) throw new DeviceSyncError('Este dispositivo no tiene la sincronización activa.');
  const code = newPairingCode();
  return { url: pairingUrl(await sealLink(link, code)), code };
}

/** Lo que hay en este dispositivo se queda; sólo deja de sincronizarse. */
export async function disableDeviceSync(deleteCopy: boolean): Promise<void> {
  const link = await loadDeviceLink();
  if (link && deleteCopy) {
    const response = await github(`/gists/${link.gistId}`, { token: link.token, method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new GitHubError(response.status, `GitHub respondió ${response.status}`);
  }
  await forgetDeviceSecret();
  await kvDelete(SECRET_STATE);
  deviceSync.set({ enabled: false, status: 'idle', message: null, lastSyncAt: null });
}
