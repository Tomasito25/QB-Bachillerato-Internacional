import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAnswer, startSession } from '@/features/study/sessions';
import { createPairing, deviceSync, disableDeviceSync, enableDeviceSync, ExistingCopyError, linkThisDevice, mergeProgress, pickSession, syncDevices } from '@/features/sync/deviceSync';
import { newPairingCode, normalizeCode, openLink, PairingError, sealedFromInput, sealLink } from '@/features/sync/pairing';
import { preferences, updatePreferences } from '@/features/settings/preferences';
import { emptyProgress } from '@/features/study/progressRepo';
import { db } from '@/infra/db/db';
import type { AttemptRow, ExamRow, ProgressRow, SessionRow } from '@/infra/db/types';
import { makeMcq, makeSubject } from '../fixtures';

/** Un GitHub en memoria: lo que importa de su API de gists. */
class FakeGitHub {
  gists = new Map<string, { id: string; files: Record<string, { content: string; rev: number }>; rev: number }>();
  patches = 0;
  scopes = 'gist';
  nextId = 1;

  private view(gist: { id: string; files: Record<string, { content: string; rev: number }> }) {
    return { id: gist.id, files: Object.fromEntries(Object.entries(gist.files).map(([name, file]) => [name, { filename: name, raw_url: `https://gist.example/${gist.id}/${file.rev}/${name}`, truncated: false, content: file.content }])) };
  }

  install() {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = url.replace('https://api.github.com', '').replace(/\?.*$/, '');
      const method = init.method ?? 'GET';
      const headers = init.headers as Record<string, string>;
      if (headers.Authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
      if (path === '/user') return new Response(JSON.stringify({ login: 'ana', id: 1, avatar_url: '', name: null }), { headers: { 'x-oauth-scopes': this.scopes } });
      if (path === '/gists' && method === 'GET') return new Response(JSON.stringify([...this.gists.values()].map((g) => this.view(g))));
      if (path === '/gists' && method === 'POST') {
        const body = JSON.parse(init.body as string) as { files: Record<string, { content: string }>; public: boolean };
        expect(body.public).toBe(false);
        const id = `g${this.nextId++}`;
        this.gists.set(id, { id, rev: 1, files: Object.fromEntries(Object.entries(body.files).map(([name, f]) => [name, { content: f.content, rev: 1 }])) });
        return new Response(JSON.stringify(this.view(this.gists.get(id) as never)), { status: 201 });
      }
      const gist = this.gists.get(path.replace('/gists/', ''));
      if (!gist) return new Response('{}', { status: 404 });
      if (method === 'DELETE') {
        this.gists.delete(gist.id);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        this.patches += 1;
        gist.rev += 1;
        const body = JSON.parse(init.body as string) as { files: Record<string, { content: string }> };
        for (const [name, f] of Object.entries(body.files)) gist.files[name] = { content: f.content, rev: gist.rev };
        return new Response(JSON.stringify(this.view(gist)));
      }
      const etag = `"${gist.rev}"`;
      if (headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(this.view(gist)), { headers: { etag } });
    });
  }
}

/** Cada dispositivo es una base de datos: se guarda y se restaura para simular varios en uno. */
const STORES = ['attempts', 'progress', 'sessions', 'drafts', 'lQuestions', 'lSubjects', 'exams', 'kv', 'localImages'] as const;
const devices = new Map<string, Record<string, unknown[]>>();
let currentDevice: string | null = null;

async function switchDevice(name: string) {
  if (currentDevice) devices.set(currentDevice, Object.fromEntries(await Promise.all(STORES.map(async (store) => [store, await db[store].toArray()]))));
  await Promise.all(STORES.map((store) => db[store].clear()));
  const saved = devices.get(name);
  if (saved) for (const store of STORES) await (db[store] as unknown as { bulkPut(rows: unknown[]): Promise<unknown> }).bulkPut(saved[store] as unknown[]);
  currentDevice = name;
}

function attempt(id: string, questionId: string, at: number, correct = true): AttemptRow {
  return { id, questionId, questionRev: 1, sessionId: null, mode: 'practice', selected: ['a'], selfGrade: null, correct, score: correct ? 1 : 0, durationMs: 4000, at, subjectId: 's', difficulty: 2, published: 0 };
}

const exam = (id: string, updatedAt: number): ExamRow => ({ id, kind: 'mock', title: `Mock ${id}`, date: '2027-01-20', subjectId: 's', paperId: null, topicIds: [], createdAt: 1, updatedAt });

async function pairSecondDevice(name: string) {
  const { url, code } = await createPairing();
  await switchDevice(name);
  await linkThisDevice(sealedFromInput(url), code);
}

describe('sincronización entre dispositivos', () => {
  let github: FakeGitHub;

  beforeEach(async () => {
    devices.clear();
    currentDevice = null;
    await Promise.all(db.tables.map((table) => table.clear()));
    github = new FakeGitHub();
    github.install();
    vi.stubGlobal('navigator', { onLine: true });
    deviceSync.set({ enabled: false, status: 'idle', message: null, lastSyncAt: null });
  });

  it('lleva el progreso de un dispositivo a otro y nada viaja en claro', async () => {
    await switchDevice('pc');
    await db.lSubjects.put({ ...makeSubject(), local: { baseRev: null } });
    const question = makeMcq();
    await db.lQuestions.put({ ...question, local: { baseRev: null, syncState: 'local', outboxId: null, note: null } });
    const session = await startSession({ mode: 'practice', title: 'x', config: { count: 1 }, questionIds: [question.id] });
    await commitAnswer(session, question, { selected: [question.answers.find((a) => a.correct)?.id ?? ''], durationMs: 5000, answeredAt: 1 });

    await enableDeviceSync(' tok ');
    expect(deviceSync.get().status).toBe('idle');
    const stored = [...github.gists.values()][0];
    expect(stored?.files['core.enc']?.content.startsWith('qb1:')).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(question.statement);

    await pairSecondDevice('movil');
    expect(await db.attempts.count()).toBe(1);
    expect((await db.progress.toArray())[0]?.attempts).toBe(1);
    expect(await db.lQuestions.count()).toBe(1);
  });

  it('no sube nada si no ha cambiado nada', async () => {
    await switchDevice('pc');
    await db.exams.put(exam('e1', 10));
    await enableDeviceSync('tok');
    const patches = github.patches;
    await syncDevices();
    await syncDevices();
    expect(github.patches).toBe(patches);
  });

  it('un examen creado en el móvil llega al PC, y borrarlo se propaga', async () => {
    await switchDevice('pc');
    await enableDeviceSync('tok');
    await pairSecondDevice('movil');
    await db.exams.put(exam('e1', 10));
    await syncDevices();

    await switchDevice('pc');
    await syncDevices();
    expect(await db.exams.get('e1')).toBeDefined();

    await db.exams.delete('e1');
    await syncDevices();
    await switchDevice('movil');
    await syncDevices();
    expect(await db.exams.get('e1')).toBeUndefined();
  });

  it('si dos dispositivos estudian sin conexión, se suman los dos repasos', async () => {
    await switchDevice('pc');
    await enableDeviceSync('tok');
    await pairSecondDevice('movil');
    const q = 'q1';
    await db.attempts.put(attempt('m1', q, 2000));
    await db.progress.put({ ...emptyProgress(q, 2000), attempts: 1, correct: 1, lastAt: 2000, lastCorrect: true });

    await switchDevice('pc');
    await db.attempts.put(attempt('p1', q, 1000, false));
    await db.progress.put({ ...emptyProgress(q, 1000), attempts: 1, correct: 0, lastAt: 1000, lastCorrect: false });
    await syncDevices();

    await switchDevice('movil');
    await syncDevices();
    const row = await db.progress.get(q);
    expect(await db.attempts.count()).toBe(2);
    expect(row).toMatchObject({ attempts: 2, correct: 1, lastAt: 2000, lastCorrect: true });
  });

  it('las preferencias de estudio viajan; el tema de la pantalla, no', async () => {
    await switchDevice('pc');
    await enableDeviceSync('tok');
    await pairSecondDevice('movil');
    await updatePreferences({ planMinutes: 90, theme: 'dark' });
    await syncDevices();
    preferences.set({ ...preferences.get(), planMinutes: 45, theme: 'light', syncedAt: 0 });

    await switchDevice('pc');
    await syncDevices();
    expect(preferences.get().planMinutes).toBe(90);
    expect(preferences.get().theme).toBe('light');
  });

  it('un token sin permiso de gist no se guarda', async () => {
    github.scopes = 'public_repo';
    await switchDevice('pc');
    await expect(enableDeviceSync('tok')).rejects.toThrow(/gist/);
    expect(deviceSync.get().enabled).toBe(false);
  });

  it('con una copia anterior hay que vincular o empezar de cero: no se pisa sin avisar', async () => {
    await switchDevice('pc');
    await enableDeviceSync('tok');
    await switchDevice('otro');
    await expect(enableDeviceSync('tok')).rejects.toBeInstanceOf(ExistingCopyError);
    expect(github.gists.size).toBe(1);
    await enableDeviceSync('tok', true);
    expect(github.gists.size).toBe(1);
    expect(deviceSync.get().enabled).toBe(true);
  });

  it('si el token deja de valer, avisa y conserva los datos', async () => {
    await switchDevice('pc');
    await db.exams.put(exam('e1', 10));
    await enableDeviceSync('tok');
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    await syncDevices();
    expect(deviceSync.get().status).toBe('error');
    expect(deviceSync.get().message).toMatch(/token/);
    expect(await db.exams.count()).toBe(1);
  });

  it('desactivar puede borrar la copia de GitHub sin tocar lo de aquí', async () => {
    await switchDevice('pc');
    await db.exams.put(exam('e1', 10));
    await enableDeviceSync('tok');
    await disableDeviceSync(true);
    expect(github.gists.size).toBe(0);
    expect(await db.exams.count()).toBe(1);
    expect(deviceSync.get().enabled).toBe(false);
  });
});

describe('reglas de fusión', () => {
  const session = (over: Partial<SessionRow>): SessionRow => ({ id: 's', mode: 'exam', title: '', config: { count: 1 }, questionIds: [], cursor: 0, answers: {}, state: 'active', startedAt: 0, finishedAt: null, timeLimitSec: null, questionShownAt: null, competitionId: null, competitionRound: null, ...over });

  it('una sesión terminada no vuelve a estar abierta', () => {
    const done = session({ state: 'finished' });
    const open = session({ answers: { q: { committed: true, durationMs: 1, answeredAt: 1 } } });
    expect(pickSession(open, done)).toBe(done);
    expect(pickSession(done, open)).toBe(done);
  });

  it('sin historial completo se queda con lo más reciente en vez de rehacer mal', () => {
    const mine: ProgressRow = { ...emptyProgress('q', 1), attempts: 3, lastAt: 500 };
    const theirs: ProgressRow = { ...emptyProgress('q', 1), attempts: 2, lastAt: 900 };
    expect(mergeProgress([mine], [theirs], [attempt('a', 'q', 900)], 0.9)[0]?.lastAt).toBe(900);
  });

  it('favorita: gana el último que la tocó; sin fecha, se conserva si alguno la marcó', () => {
    const base = emptyProgress('q', 1);
    expect(mergeProgress([{ ...base, favorite: 1 }], [{ ...base }], [], 0.9)[0]?.favorite).toBe(1);
    expect(mergeProgress([{ ...base, favorite: 1, flagsAt: 5 }], [{ ...base, favorite: 0, flagsAt: 9 }], [], 0.9)[0]?.favorite).toBe(0);
  });
});

describe('vincular dispositivos', () => {
  const link = { token: 'tok', gistId: 'g', key: 'k' };

  it('el enlace se abre con su código y con ningún otro', async () => {
    const code = newPairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const sealed = await sealLink(link, code);
    expect(sealed).not.toContain('tok');
    expect(await openLink(sealed, code.toLowerCase())).toEqual(link);
    await expect(openLink(sealed, 'AAAAAAAA')).rejects.toBeInstanceOf(PairingError);
  });

  it('acepta el enlace entero o sólo lo cifrado, y el código con guiones', () => {
    expect(sealedFromInput('https://x.github.io/a/sync#pair=abc')).toBe('abc');
    expect(sealedFromInput(' abc ')).toBe('abc');
    expect(normalizeCode('ab-cd 23')).toBe('ABCD23');
  });
});
