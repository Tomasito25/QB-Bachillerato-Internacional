import { useLiveQuery } from 'dexie-react-hooks';
import { DerivedCompetition, DerivedProfile, Leaderboard, Manifest, QuestionStats, type ManifestShard } from '@core/schema/derived';
import { FutureSchemaError, migrateDocument } from '@core/schema/migrations';
import { Question } from '@core/schema/question';
import { SubjectDoc } from '@core/schema/taxonomy';
import { sha256Hex } from '@core/util/encoding';
import { config } from '@/infra/config';
import { online, reportNetworkFailure } from '@/infra/connectivity';
import { db, kvGet, kvSet } from '@/infra/db/db';
import { logSync } from './log';
import { reconcileLocal } from './reconcile';
import { syncState } from './state';

export { syncState } from './state';

/**
 * Descarga de datos comunitarios.
 *
 * Va por Pages, no por la API: sin cuota y sin token. Compara hashes y sólo baja lo que cambió.
 * Cada fragmento se comprueba contra su hash, se valida y se aplica en una transacción junto con
 * ese hash: si se corta la red, lo aplicado queda bien y lo demás se reintenta en la próxima.
 */

const LAST_SYNC_KEY = 'last-sync-at';
const MANIFEST_KEY = 'manifest-summary';
const CONCURRENCY = 4;

export interface SyncReport {
  changed: number;
  skipped: number;
  invalid: number;
  promoted: number;
  conflicts: number;
}

export async function loadSyncState(): Promise<void> {
  const lastSyncAt = (await kvGet<number>(LAST_SYNC_KEY)) ?? null;
  syncState.set((current) => ({ ...current, lastSyncAt }));
}

export function useManifestSummary(): Manifest['counts'] | undefined {
  return useLiveQuery(async () => kvGet<Manifest['counts']>(MANIFEST_KEY), []);
}

class ManifestUnavailable extends Error {}

async function fetchManifest(): Promise<Manifest> {
  // El parámetro salta la caché de 10 minutos del CDN de Pages (comprobado: max-age=600).
  const response = await fetch(`${config.communityUrl('manifest.json')}?t=${Math.floor(Date.now() / 30_000)}`, { cache: 'no-store' });
  if (response.status === 404) throw new ManifestUnavailable();
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
  // En desarrollo, una ruta inexistente devuelve el HTML de la app.
  if (!(response.headers.get('content-type') ?? '').includes('json')) throw new ManifestUnavailable();
  const parsed = Manifest.safeParse(await response.json());
  if (!parsed.success) throw new Error('El manifiesto no tiene el formato esperado: quizá haya que actualizar la app.');
  return parsed.data;
}

async function fetchShard(shard: ManifestShard): Promise<unknown> {
  const response = await fetch(config.communityUrl(shard.path));
  if (!response.ok) throw new Error(`No se ha podido descargar ${shard.id} (${response.status})`);
  const text = await response.text();
  // El CDN puede servir una copia vieja de un fichero: el hash lo destapa.
  if ((await sha256Hex(text)) !== shard.hash) throw new Error(`El fragmento ${shard.id} no coincide con su hash`);
  return JSON.parse(text);
}

function validDocs<T>(docs: unknown, schema: { safeParse(data: unknown): { success: true; data: T } | { success: false } }, onInvalid: () => void): T[] {
  if (!Array.isArray(docs)) return [];
  const out: T[] = [];
  for (const doc of docs) {
    try {
      const parsed = schema.safeParse(migrateDocument(doc));
      if (parsed.success) {
        out.push(parsed.data);
        continue;
      }
    } catch (error) {
      if (!(error instanceof FutureSchemaError)) throw error;
    }
    onInvalid();
  }
  return out;
}

const STORES = () => [db.cSubjects, db.cQuestions, db.dProfiles, db.dLeaderboards, db.dCompetitions, db.dQuestionStats, db.shards];

async function applyShard(shard: ManifestShard, data: unknown, onInvalid: () => void): Promise<void> {
  const save = () => db.shards.put({ id: shard.id, kind: shard.kind, hash: shard.hash, appliedAt: Date.now() });
  switch (shard.kind) {
    case 'questions': {
      const docs = validDocs(data, Question, onInvalid);
      await db.transaction('rw', db.cQuestions, db.shards, async () => {
        await db.cQuestions.where('shardId').equals(shard.id).delete();
        await db.cQuestions.bulkPut(docs.map((q) => ({ ...q, shardId: shard.id })));
        await save();
      });
      break;
    }
    case 'taxonomy': {
      const docs = validDocs(data, SubjectDoc, onInvalid);
      await db.transaction('rw', db.cSubjects, db.shards, async () => {
        await db.cSubjects.clear();
        await db.cSubjects.bulkPut(docs);
        await save();
      });
      break;
    }
    case 'profiles': {
      const docs = validDocs(data, DerivedProfile, onInvalid);
      await db.transaction('rw', db.dProfiles, db.shards, async () => {
        await db.dProfiles.clear();
        await db.dProfiles.bulkPut(docs);
        await save();
      });
      break;
    }
    case 'leaderboards': {
      const docs = validDocs(data, Leaderboard, onInvalid);
      await db.transaction('rw', db.dLeaderboards, db.shards, async () => {
        await db.dLeaderboards.clear();
        await db.dLeaderboards.bulkPut(docs);
        await save();
      });
      break;
    }
    case 'competitions': {
      const docs = validDocs(data, DerivedCompetition, onInvalid);
      await db.transaction('rw', db.dCompetitions, db.shards, async () => {
        await db.dCompetitions.clear();
        await db.dCompetitions.bulkPut(docs);
        await save();
      });
      break;
    }
    case 'question-stats': {
      const docs = validDocs(data, QuestionStats, onInvalid);
      await db.transaction('rw', db.dQuestionStats, db.shards, async () => {
        await db.dQuestionStats.clear();
        await db.dQuestionStats.bulkPut(docs);
        await save();
      });
      break;
    }
    case 'moderation':
      await save();
      break;
  }
}

/** Reparte el trabajo entre unos pocos a la vez. */
async function pool<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        await worker(next);
      }
    }),
  );
}

let running: Promise<SyncReport | null> | null = null;

export function syncCommunity(options: { force?: boolean } = {}): Promise<SyncReport | null> {
  running ??= run(options).finally(() => {
    running = null;
  });
  return running;
}

async function run({ force = false }: { force?: boolean }): Promise<SyncReport | null> {
  syncState.set((s) => ({ ...s, status: 'syncing', message: null, done: 0, total: 0 }));
  try {
    const manifest = await fetchManifest();
    const stored = new Map((await db.shards.toArray()).map((s) => [s.id, s.hash]));
    const wanted = new Set(manifest.shards.map((s) => s.id));
    const changed = manifest.shards.filter((s) => force || stored.get(s.id) !== s.hash);
    const removed = [...stored.keys()].filter((id) => !wanted.has(id));
    let invalid = 0;
    let done = 0;
    syncState.set((s) => ({ ...s, total: changed.length, noCommunity: false }));

    await pool(changed, async (shard) => {
      await applyShard(shard, await fetchShard(shard), () => {
        invalid += 1;
      });
      done += 1;
      syncState.set((s) => ({ ...s, done }));
    });

    if (removed.length > 0) {
      // Un cubo que desaparece: se fue su última pregunta.
      await db.transaction('rw', STORES(), async () => {
        for (const id of removed) {
          await db.cQuestions.where('shardId').equals(id).delete();
          await db.shards.delete(id);
        }
      });
    }

    const reconciled = await reconcileLocal();
    const now = Date.now();
    await kvSet(LAST_SYNC_KEY, now);
    await kvSet(MANIFEST_KEY, manifest.counts);
    syncState.set((s) => ({ ...s, status: 'idle', lastSyncAt: now, message: null, noCommunity: false }));
    online.set(true);

    const report: SyncReport = { changed: changed.length, skipped: manifest.shards.length - changed.length, invalid, promoted: reconciled.promoted, conflicts: reconciled.conflicts };
    if (changed.length > 0 || invalid > 0 || removed.length > 0) {
      await logSync(invalid > 0 ? 'warn' : 'info', `Descargados ${changed.length} de ${manifest.shards.length} fragmentos${invalid > 0 ? `; ${invalid} documentos descartados por no ser válidos` : ''}.`);
    }
    if (reconciled.conflicts > 0) await logSync('warn', `${reconciled.conflicts} preguntas con conflicto: hay que decidir qué versión queda.`);
    return report;
  } catch (error) {
    if (error instanceof ManifestUnavailable) {
      syncState.set((s) => ({ ...s, status: 'idle', noCommunity: true, message: null }));
      return null;
    }
    reportNetworkFailure();
    const message = navigator.onLine ? (error as Error).message : 'Sin conexión.';
    syncState.set((s) => ({ ...s, status: 'error', message }));
    await logSync('error', `Sincronización fallida: ${message}`);
    return null;
  }
}

