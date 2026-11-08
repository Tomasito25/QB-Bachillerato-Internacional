import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest, ManifestShard } from '@core/schema/derived';
import { sha256Hex } from '@core/util/encoding';
import { loadQuestions, saveLocalQuestion } from '@/features/bank/questionsRepo';
import { statusInterval, syncInterval } from '@/features/sync/background';
import { syncCommunity, syncState } from '@/features/sync/communitySync';
import { classifyLocal, reconcileLocal, resolveConflict } from '@/features/sync/reconcile';
import { loadSubjects, addTopic } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { makeMcq, makeSubject, SUBJECT_ID, TOPIC_ID, UNIT_ID, uuid } from '../fixtures';

/** Sirve un «Pages» en memoria y cuenta qué se descarga. */
class FakePages {
  files = new Map<string, string>();
  fetched: string[] = [];
  shards: ManifestShard[] = [];
  failing = new Set<string>();
  tampered = new Set<string>();

  async put(id: string, kind: ManifestShard['kind'], value: unknown, subjectId?: string) {
    const text = JSON.stringify(value);
    const hash = await sha256Hex(text);
    const path = `${id}.${hash.slice(0, 12)}.json`;
    this.files.set(path, text);
    this.shards = [...this.shards.filter((s) => s.id !== id), { id, kind, path, hash, count: Array.isArray(value) ? value.length : 0, ...(subjectId ? { subjectId } : {}) }];
  }

  manifest(): Manifest {
    return { schemaVersion: 1, generatedAt: '2026-11-05T12:00:00.000Z', dataCommit: 'abc', shards: this.shards, counts: { questions: 0, subjects: 0, users: 0, answers: 0, competitions: 0 }, quarantined: 0 };
  }

  install() {
    vi.stubGlobal('fetch', async (input: string) => {
      const url = input.replace(/\?.*$/, '').replace(/^.*community\//, '');
      if (url === 'manifest.json') return new Response(JSON.stringify(this.manifest()), { headers: { 'content-type': 'application/json' } });
      this.fetched.push(url);
      if (this.failing.has(url)) return new Response('', { status: 500 });
      const body = this.files.get(url);
      if (body === undefined) return new Response('', { status: 404 });
      return new Response(this.tampered.has(url) ? `${body} ` : body);
    });
  }
}

let pages: FakePages;

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  pages = new FakePages();
  pages.install();
  await pages.put('taxonomy', 'taxonomy', [makeSubject()]);
});

describe('descarga incremental', () => {
  it('baja y guarda lo que hay', async () => {
    const question = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [question], SUBJECT_ID);
    const report = await syncCommunity();
    expect(report).toMatchObject({ changed: 2, skipped: 0, invalid: 0 });
    expect(await db.cQuestions.get(question.id)).toMatchObject({ id: question.id, shardId: `q/${SUBJECT_ID}/0` });
    expect((await loadSubjects()).map((s) => s.name)).toEqual(['Anatomía']);
    expect(syncState.get()).toMatchObject({ status: 'idle', noCommunity: false });
    expect(syncState.get().lastSyncAt).toBeGreaterThan(0);
  });

  it('la segunda vez no baja nada si nada cambió', async () => {
    await syncCommunity();
    pages.fetched = [];
    expect(await syncCommunity()).toMatchObject({ changed: 0 });
    expect(pages.fetched).toEqual([]);
  });

  it('sólo baja el fragmento que cambió', async () => {
    const a = makeMcq();
    const b = makeMcq({ statement: 'Otra pregunta distinta del mismo banco' });
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [a], SUBJECT_ID);
    await pages.put(`q/${SUBJECT_ID}/1`, 'questions', [b], SUBJECT_ID);
    await syncCommunity();
    pages.fetched = [];
    await pages.put(`q/${SUBJECT_ID}/1`, 'questions', [{ ...b, rev: 2, statement: 'Enunciado actualizado' }], SUBJECT_ID);
    expect(await syncCommunity()).toMatchObject({ changed: 1, skipped: 2 });
    expect(pages.fetched).toHaveLength(1);
    expect((await db.cQuestions.get(b.id))?.rev).toBe(2);
  });

  it('una pregunta que desaparece de un fragmento se borra', async () => {
    const a = makeMcq();
    const b = makeMcq({ statement: 'Otra pregunta distinta del mismo banco' });
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [a, b], SUBJECT_ID);
    await syncCommunity();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [a], SUBJECT_ID);
    await syncCommunity();
    expect(await db.cQuestions.get(b.id)).toBeUndefined();
  });

  it('un fragmento que desaparece se elimina', async () => {
    const a = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [a], SUBJECT_ID);
    await syncCommunity();
    pages.shards = pages.shards.filter((s) => s.kind !== 'questions');
    await syncCommunity();
    expect(await db.cQuestions.count()).toBe(0);
    expect(await db.shards.get(`q/${SUBJECT_ID}/0`)).toBeUndefined();
  });

  it('descarta documentos inválidos sin perder los demás, y lo cuenta', async () => {
    const good = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [good, { basura: true }, { ...makeMcq(), schemaVersion: 99 }], SUBJECT_ID);
    expect(await syncCommunity()).toMatchObject({ invalid: 2 });
    expect(await db.cQuestions.count()).toBe(1);
  });

  it('detecta un fragmento alterado por su hash y no lo aplica', async () => {
    const question = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [question], SUBJECT_ID);
    pages.tampered.add(pages.shards.find((s) => s.kind === 'questions')?.path as string);
    expect(await syncCommunity()).toBeNull();
    expect(syncState.get().status).toBe('error');
    expect(await db.cQuestions.count()).toBe(0);
  });

  it('un fallo a medias no deja nada roto y se reintenta', async () => {
    const question = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [question], SUBJECT_ID);
    const path = pages.shards.find((s) => s.kind === 'questions')?.path as string;
    pages.failing.add(path);
    expect(await syncCommunity()).toBeNull();
    expect(await db.cQuestions.count()).toBe(0);
    expect(await db.shards.get(`q/${SUBJECT_ID}/0`)).toBeUndefined();
    pages.failing.clear();
    await syncCommunity();
    expect(await db.cQuestions.count()).toBe(1);
  });

  it('un fallo pasajero se reintenta solo, sin molestar a nadie', async () => {
    const question = makeMcq();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [question], SUBJECT_ID);
    const path = (pages.shards.find((s) => s.kind === 'questions') as ManifestShard).path;
    pages.failing.add(path);
    setTimeout(() => pages.failing.delete(path), 100);
    expect(await syncCommunity()).toMatchObject({ changed: 2 });
    expect(await db.cQuestions.get(question.id)).toBeDefined();
    expect(syncState.get().status).toBe('idle');
  });

  it('un fragmento que falla no impide aplicar los demás, y sólo él se pide otra vez', async () => {
    const good = makeMcq();
    const bad = makeMcq({ statement: 'La que no llega en el primer intento' });
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [good], SUBJECT_ID);
    await pages.put(`q/${SUBJECT_ID}/1`, 'questions', [bad], SUBJECT_ID);
    const path = (pages.shards.find((s) => s.id.endsWith('/1')) as ManifestShard).path;
    pages.failing.add(path);
    expect(await syncCommunity()).toBeNull();
    expect(syncState.get().status).toBe('error');
    expect(syncState.get().message).toMatch(/Faltan 1 de 3/);
    expect(await db.cQuestions.get(good.id)).toBeDefined();
    pages.failing.clear();
    pages.fetched = [];
    expect(await syncCommunity()).toMatchObject({ changed: 1 });
    expect(pages.fetched).toEqual([path]);
    expect(await db.cQuestions.get(bad.id)).toBeDefined();
  });

  it('sin datos publicados no es un error', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await syncCommunity()).toBeNull();
    expect(syncState.get()).toMatchObject({ status: 'idle', noCommunity: true });
    // En desarrollo, Vite responde con el HTML de la app.
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    await syncCommunity();
    expect(syncState.get().noCommunity).toBe(true);
  });

  it('nunca toca lo local', async () => {
    const mine = makeMcq({ author: null, statement: 'Mi pregunta local, que no está publicada' });
    await saveLocalQuestion(mine, null);
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [makeMcq()], SUBJECT_ID);
    await syncCommunity();
    await pages.put(`q/${SUBJECT_ID}/0`, 'questions', [], SUBJECT_ID);
    await syncCommunity();
    expect(await db.lQuestions.get(mine.id)).toBeDefined();
  });
});

describe('frecuencia de la sincronización automática', () => {
  const now = 1_000_000_000_000;
  const MINUTE = 60_000;

  it('sin nada a la espera, cada 10 minutos', () => {
    expect(syncInterval([], now)).toBe(10 * MINUTE);
    expect(syncInterval([{ status: 'queued', updatedAt: now }, { status: 'rejected', updatedAt: now }, { status: 'review', updatedAt: now }], now)).toBe(10 * MINUTE);
  });

  it('tras un envío, cada minuto durante un rato: lo aceptado tarda poco en publicarse', () => {
    for (const status of ['awaiting-user', 'sent', 'accepted'] as const) {
      expect(syncInterval([{ status, updatedAt: now - MINUTE }], now)).toBe(MINUTE);
      expect(syncInterval([{ status, updatedAt: now - 16 * MINUTE }], now)).toBe(10 * MINUTE);
    }
  });

  it('sin token, sólo pregunta a GitHub justo después de enviar: hay 60 consultas por hora', () => {
    expect(statusInterval([], now, false)).toBeNull();
    expect(statusInterval([{ status: 'review', updatedAt: now }], now, false)).toBeNull();
    expect(statusInterval([{ status: 'sent', updatedAt: now - MINUTE }], now, false)).toBe(2 * MINUTE);
    expect(statusInterval([{ status: 'awaiting-user', updatedAt: now - 16 * MINUTE }], now, false)).toBeNull();
    expect(statusInterval([], now, true)).toBe(5 * MINUTE);
  });
});

describe('reconciliación', () => {
  const local = (rev: number, baseRev: number | null, syncState: 'local' | 'queued' | 'submitted' | 'conflict' = 'local') => ({ rev, local: { baseRev, syncState, outboxId: null, note: null } });

  it('sin versión comunitaria no hay nada que decidir', () => {
    expect(classifyLocal(local(1, null), undefined, false)).toBe('keep');
  });

  it('si el contenido ya es el mismo, la copia local sobra', () => {
    expect(classifyLocal(local(2, 1, 'submitted'), { rev: 2 }, true)).toBe('promoted');
    expect(classifyLocal(local(1, null), { rev: 1 }, true)).toBe('promoted');
    expect(classifyLocal(local(2, 1, 'conflict'), { rev: 5 }, true)).toBe('promoted');
  });

  it('lo enviado espera mientras la comunidad no alcanza su revisión', () => {
    expect(classifyLocal(local(3, 2, 'submitted'), { rev: 2 }, false)).toBe('keep');
  });

  it('lo enviado choca si la comunidad avanzó con otro contenido', () => {
    expect(classifyLocal(local(3, 2, 'submitted'), { rev: 3 }, false)).toBe('conflict');
  });

  it('una edición choca si la base se ha quedado atrás', () => {
    expect(classifyLocal(local(3, 2), { rev: 3 }, false)).toBe('conflict');
    expect(classifyLocal(local(3, 2), { rev: 2 }, false)).toBe('keep');
  });

  it('dos preguntas distintas con el mismo id chocan', () => {
    expect(classifyLocal(local(1, null), { rev: 1 }, false)).toBe('conflict');
  });

  it('un conflicto se queda como está hasta que alguien decida', () => {
    expect(classifyLocal(local(3, 2, 'conflict'), { rev: 9 }, false)).toBe('keep');
  });

  it('al llegar lo publicado, la copia local desaparece sin perder nada', async () => {
    const question = makeMcq({ author: null });
    await saveLocalQuestion(question, null);
    await db.lQuestions.update(question.id, { 'local.syncState': 'submitted' });
    await db.cQuestions.put({ ...question, author: { login: 'ana', id: 1 }, shardId: 's' });
    expect(await reconcileLocal()).toMatchObject({ promoted: 1, conflicts: 0 });
    expect(await db.lQuestions.get(question.id)).toBeUndefined();
    expect((await loadQuestions())[0]?.origin).toBe('community');
  });

  it('un conflicto se señala, y lo local se conserva', async () => {
    const base = makeMcq({ rev: 2 });
    await db.cQuestions.put({ ...base, rev: 3, statement: 'La comunidad lo cambió así', shardId: 's' });
    await saveLocalQuestion({ ...base, rev: 3, statement: 'Yo lo cambié de otra forma' }, 2);
    expect(await reconcileLocal()).toMatchObject({ conflicts: 1 });
    const row = await db.lQuestions.get(base.id);
    expect(row?.local.syncState).toBe('conflict');
    expect(row?.statement).toBe('Yo lo cambié de otra forma');
  });

  it('la capa de temario se elimina cuando la comunidad ya lo incluye', async () => {
    await db.cSubjects.put(makeSubject());
    await addTopic(SUBJECT_ID, UNIT_ID, 'Articulaciones');
    expect((await loadSubjects())[0]?.units[0]?.topics).toHaveLength(2);
    expect(await reconcileLocal()).toMatchObject({ overlaysRemoved: 0 });
    const merged = (await loadSubjects())[0];
    await db.cSubjects.put({ ...(merged as NonNullable<typeof merged>), rev: 2 });
    expect(await reconcileLocal()).toMatchObject({ overlaysRemoved: 1 });
    expect(await db.lSubjects.count()).toBe(0);
    expect((await loadSubjects())[0]?.units[0]?.topics).toHaveLength(2);
  });
});

describe('alineación de temario al sincronizar', () => {
  it('«Fisica» local y «Física» comunitaria acaban siendo la misma, con preguntas e intentos', async () => {
    await db.cSubjects.put(makeSubject({ name: 'Física' }));
    const mine = uuid();
    const myUnit = uuid();
    const myTopic = uuid();
    const extraTopic = uuid();
    await db.lSubjects.put({
      ...makeSubject({ id: mine, name: 'Fisica', createdBy: null, units: [{ id: myUnit, name: 'SISTEMA LOCOMOTOR', order: 0, topics: [{ id: myTopic, name: 'huesos', order: 0 }, { id: extraTopic, name: 'Cartílagos', order: 1 }] }] }),
      local: { baseRev: null },
    });
    const question = makeMcq({ author: null, subjectId: mine, topicIds: [myTopic, extraTopic] });
    await saveLocalQuestion(question, null);
    await db.attempts.put({ id: 'attempt0001', questionId: question.id, questionRev: 1, sessionId: null, mode: 'practice', selected: ['a'], selfGrade: null, correct: true, score: 1, durationMs: 1000, at: 1, subjectId: mine, difficulty: 2, published: 0 });

    await reconcileLocal();

    const subjects = await loadSubjects();
    expect(subjects.map((s) => s.id)).toEqual([SUBJECT_ID]);
    // Conserva el nombre comunitario y añade lo que sólo estaba aquí.
    expect(subjects[0]?.name).toBe('Física');
    expect(subjects[0]?.units[0]?.topics.map((t) => t.name)).toEqual(['Huesos', 'Cartílagos']);
    const stored = await db.lQuestions.get(question.id);
    expect(stored?.subjectId).toBe(SUBJECT_ID);
    expect(stored?.topicIds).toEqual([TOPIC_ID, extraTopic]);
    expect((await db.attempts.get('attempt0001'))?.subjectId).toBe(SUBJECT_ID);
  });

  it('una asignatura que sólo existe aquí se queda como está', async () => {
    await db.lSubjects.put({ ...makeSubject({ id: uuid(), name: 'Bioquímica', createdBy: null, units: [] }), local: { baseRev: null } });
    await reconcileLocal();
    expect(await db.lSubjects.count()).toBe(1);
    expect((await loadSubjects()).map((s) => s.name)).toEqual(['Anatomía', 'Bioquímica'].filter((n) => n === 'Bioquímica'));
  });
});

describe('resolver conflictos', () => {
  async function conflict() {
    const base = makeMcq({ rev: 2 });
    await db.cQuestions.put({ ...base, rev: 3, statement: 'Versión de la comunidad', shardId: 's' });
    await saveLocalQuestion({ ...base, rev: 3, statement: 'Mi versión' }, 2);
    await reconcileLocal();
    return base.id;
  }

  it('usar la comunitaria descarta la local', async () => {
    const id = await conflict();
    await resolveConflict(id, 'use-community');
    expect(await db.lQuestions.get(id)).toBeUndefined();
    expect((await loadQuestions())[0]?.statement).toBe('Versión de la comunidad');
  });

  it('reescribir encima deja mi texto como la siguiente revisión', async () => {
    const id = await conflict();
    await resolveConflict(id, 'rebase-mine');
    const row = await db.lQuestions.get(id);
    expect(row).toMatchObject({ rev: 4, statement: 'Mi versión' });
    expect(row?.local).toMatchObject({ baseRev: 3, syncState: 'local' });
    expect(await reconcileLocal()).toMatchObject({ conflicts: 0 });
  });

  it('guardar como nueva crea otra pregunta y libera la original', async () => {
    const id = await conflict();
    await resolveConflict(id, 'keep-as-new');
    expect(await db.lQuestions.get(id)).toBeUndefined();
    const [copy] = await db.lQuestions.toArray();
    expect(copy).toMatchObject({ rev: 1, author: null, derivedFrom: id, statement: 'Mi versión' });
    expect(copy?.id).not.toBe(id);
    expect(await loadQuestions()).toHaveLength(2);
  });
});
