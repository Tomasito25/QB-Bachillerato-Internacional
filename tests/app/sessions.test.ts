import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULES } from '@core/scoring/rules';
import { discardLocalQuestion, loadQuestions, saveLocalQuestion } from '@/features/bank/questionsRepo';
import { db } from '@/infra/db/db';
import { commitAnswer, commitSelfGrade, finishSession, saveDeferredAnswer, startSession, summarizeSession } from '@/features/study/sessions';
import { computeLocalStats, computeStreak, localDay } from '@/features/study/localStats';
import { toggleFavorite, toggleHard } from '@/features/study/progressRepo';
import { DEFAULT_PREFERENCES, migratePreferences, preferences } from '@/features/settings/preferences';
import type { ProgressRow } from '@/infra/db/types';
import { makeMcq, makeOpen, makeSubject, uuid } from '../fixtures';

async function reset() {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.cSubjects.put(makeSubject());
}

describe('temario elegido y objetivo por tipo', () => {
  beforeEach(reset);
  afterEach(() => preferences.set(DEFAULT_PREFERENCES));

  it('las sesiones sólo sacan preguntas del temario elegido', async () => {
    const kept = uuid();
    const a = makeMcq({ topicIds: [kept] });
    const b = makeMcq({ statement: 'Otra de un tema que queda fuera', topicIds: [uuid()] });
    await saveLocalQuestion(a, null);
    await saveLocalQuestion(b, null);
    preferences.set({ ...DEFAULT_PREFERENCES, studyScope: { mode: 'only', topicIds: [kept] } });
    const only = await startSession({ mode: 'practice', title: '', config: { count: 5 } });
    expect((await db.sessions.get(only))?.questionIds).toEqual([a.id]);
    preferences.set({ ...DEFAULT_PREFERENCES, studyScope: { mode: 'block', topicIds: [kept] } });
    const blocked = await startSession({ mode: 'exam', title: '', config: { count: 5 } });
    expect((await db.sessions.get(blocked))?.questionIds).toEqual([b.id]);
  });

  it('avisa si el temario elegido deja la sesión sin preguntas', async () => {
    await saveLocalQuestion(makeMcq({ topicIds: [uuid()] }), null);
    preferences.set({ ...DEFAULT_PREFERENCES, studyScope: { mode: 'only', topicIds: [uuid()] } });
    await expect(startSession({ mode: 'practice', title: '', config: { count: 5 } })).rejects.toThrow(/temario que has elegido/);
  });

  it('una sesión con reparto saca las de cada tipo que se piden', async () => {
    for (let i = 0; i < 3; i++) await saveLocalQuestion(makeMcq({ statement: `Tipo test ${i}` }), null);
    for (let i = 0; i < 3; i++) await saveLocalQuestion(makeOpen({ statement: `Desarrollo ${i}` }), null);
    const id = await startSession({ mode: 'practice', title: '', config: { count: 3, mix: { mcq: 1, open: 2 } } });
    const picked = (await db.sessions.get(id))?.questionIds ?? [];
    const types = (await loadQuestions()).filter((q) => picked.includes(q.id)).map((q) => q.type).sort();
    expect(types).toEqual(['mcq', 'open', 'open']);
  });

  it('el objetivo único de antes pasa a ser el de tipo test', () => {
    expect(migratePreferences({ dailyGoal: 35 })).toMatchObject({ dailyGoalMcq: 35, dailyGoalOpen: 0 });
    expect(migratePreferences({ dailyGoalMcq: 5, dailyGoalOpen: 2 })).toMatchObject({ dailyGoalMcq: 5, dailyGoalOpen: 2 });
    expect(migratePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(migratePreferences({ dailyGoal: 35 })).not.toHaveProperty('dailyGoal');
  });
});

describe('sesiones de estudio', () => {
  beforeEach(reset);

  it('corrige, guarda el intento y actualiza la repetición espaciada a la vez', async () => {
    const question = makeMcq();
    await saveLocalQuestion(question, null);
    const id = await startSession({ mode: 'practice', title: '', config: { count: 5 } });

    await commitAnswer(id, question, { selected: ['a'], durationMs: 4000, answeredAt: Date.now() });

    const attempts = await db.attempts.toArray();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ questionId: question.id, correct: true, score: 1, published: 0, durationMs: 4000 });
    const progress = await db.progress.get(question.id);
    expect(progress).toMatchObject({ attempts: 1, correct: 1, lastCorrect: true });
    expect(progress?.due).toBeGreaterThan(Date.now());
    const session = await db.sessions.get(id);
    expect(session?.answers[question.id]?.committed).toBe(true);
  });

  it('no registra dos veces la misma respuesta', async () => {
    const question = makeMcq();
    await saveLocalQuestion(question, null);
    const id = await startSession({ mode: 'practice', title: '', config: { count: 5 } });
    await commitAnswer(id, question, { selected: ['a'], durationMs: 1, answeredAt: 1 });
    await commitAnswer(id, question, { selected: ['b'], durationMs: 1, answeredAt: 1 });
    expect(await db.attempts.count()).toBe(1);
    expect((await db.attempts.toArray())[0]?.correct).toBe(true);
  });

  it('un fallo programa el repaso enseguida', async () => {
    const question = makeMcq();
    await saveLocalQuestion(question, null);
    const id = await startSession({ mode: 'practice', title: '', config: { count: 5 } });
    await commitAnswer(id, question, { selected: ['b'], durationMs: 1, answeredAt: 1 });
    const progress = await db.progress.get(question.id);
    expect(progress?.lastCorrect).toBe(false);
    expect((progress?.due ?? 0) - Date.now()).toBeLessThan(15 * 60_000);
  });

  it('en examen no se corrige nada hasta entregar', async () => {
    const q1 = makeMcq();
    const q2 = makeMcq();
    await saveLocalQuestion(q1, null);
    await saveLocalQuestion(q2, null);
    const id = await startSession({ mode: 'exam', title: '', config: { count: 2 }, timeLimitSec: 600 });

    await saveDeferredAnswer(id, q1.id, { selected: ['a'], durationMs: 1000, answeredAt: 1 });
    expect(await db.attempts.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);

    await finishSession(id);
    const attempts = await db.attempts.toArray();
    expect(attempts).toHaveLength(2);
    const byId = new Map(attempts.map((a) => [a.questionId, a]));
    expect(byId.get(q1.id)?.correct).toBe(true);
    // La no respondida cuenta como fallo.
    expect(byId.get(q2.id)?.correct).toBe(false);
    expect((await db.sessions.get(id))?.state).toBe('finished');
  });

  it('una entrega repetida no duplica intentos', async () => {
    const question = makeMcq();
    await saveLocalQuestion(question, null);
    const id = await startSession({ mode: 'exam', title: '', config: { count: 1 } });
    await finishSession(id);
    await finishSession(id);
    expect(await db.attempts.count()).toBe(1);
  });

  it('el desarrollo queda pendiente en el examen y se autoevalúa después', async () => {
    const open = makeOpen();
    await saveLocalQuestion(open, null);
    const id = await startSession({ mode: 'exam', title: '', config: { count: 1 } });
    await finishSession(id);
    expect(await db.attempts.count()).toBe(0);

    const session = await db.sessions.get(id);
    const questions = new Map([[open.id, open]]);
    expect(session && summarizeSession(session, questions, []).pendingSelfGrade).toBe(1);

    await commitSelfGrade(id, open, 2, ['c1', 'c2']);
    const [attempt] = await db.attempts.toArray();
    expect(attempt).toMatchObject({ selfGrade: 2, correct: null, score: 1 });
    expect((await db.progress.get(open.id))?.lastCorrect).toBe(true);
  });

  it('el desarrollo guarda lo que ha estado a la vista: sin duración, el servidor lo descarta', async () => {
    const open = makeOpen();
    await saveLocalQuestion(open, null);
    const id = await startSession({ mode: 'practice', title: '', config: { count: 1 } });
    await commitSelfGrade(id, open, 2, ['c1'], 12_345);
    expect((await db.attempts.toArray())[0]?.durationMs).toBe(12_345);
  });

  it('autoevaluado tras un examen, usa la media de la sesión y es una respuesta válida', async () => {
    const open = makeOpen();
    await saveLocalQuestion(open, null);
    await saveLocalQuestion(makeMcq(), null);
    const id = await startSession({ mode: 'exam', title: '', config: { count: 2 } });
    await finishSession(id);
    const session = await db.sessions.get(id);
    await db.sessions.update(id, { finishedAt: (session?.startedAt ?? 0) + 120_000 });

    await commitSelfGrade(id, open, 1, []);
    const attempt = await db.attempts.where('questionId').equals(open.id).first();
    expect(attempt?.durationMs).toBe(60_000);
    expect(attempt?.durationMs).toBeGreaterThanOrEqual(RULES.minAnswerMs);
  });

  it('el progreso sobrevive porque todo está en IndexedDB', async () => {
    const question = makeMcq();
    await saveLocalQuestion(question, null);
    const id = await startSession({ mode: 'exam', title: 't', config: { count: 1 }, timeLimitSec: 60 });
    await saveDeferredAnswer(id, question.id, { selected: ['c'], durationMs: 10, answeredAt: 1 });
    db.close();
    await db.open();
    const session = await db.sessions.get(id);
    expect(session?.answers[question.id]?.selected).toEqual(['c']);
    expect(session?.state).toBe('active');
  });

  it('rechaza crear una sesión sin preguntas', async () => {
    await expect(startSession({ mode: 'practice', title: '', config: { count: 5 } })).rejects.toThrow(/No hay preguntas/);
  });

  it('el repaso filtra por origen', async () => {
    const q1 = makeMcq();
    const q2 = makeMcq();
    await saveLocalQuestion(q1, null);
    await saveLocalQuestion(q2, null);
    await toggleFavorite(q1.id);
    await toggleHard(q2.id);
    const favorites = await startSession({ mode: 'review', title: '', config: { count: 5, source: 'favorites' } });
    expect((await db.sessions.get(favorites))?.questionIds).toEqual([q1.id]);
    const hard = await startSession({ mode: 'review', title: '', config: { count: 5, source: 'hard' } });
    expect((await db.sessions.get(hard))?.questionIds).toEqual([q2.id]);
  });
});

describe('caché de preguntas', () => {
  beforeEach(reset);

  it('se reutiliza mientras nada cambia, y se invalida al escribir', async () => {
    const first = makeMcq();
    await saveLocalQuestion(first, null);
    const before = await loadQuestions();
    expect(await loadQuestions()).toBe(before);
    expect(before.map((q) => q.id)).toEqual([first.id]);

    const second = makeMcq({ statement: 'Una segunda pregunta distinta' });
    await saveLocalQuestion(second, null);
    expect((await loadQuestions()).map((q) => q.id).sort()).toEqual([first.id, second.id].sort());

    await db.cQuestions.put({ ...makeMcq({ statement: 'Una comunitaria' }), shardId: 's' });
    expect(await loadQuestions()).toHaveLength(3);

    await discardLocalQuestion(first.id);
    expect(await loadQuestions()).toHaveLength(2);
  });
});

describe('estadísticas locales', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 10, 5, 12).getTime();

  it('la racha admite que hoy aún no se haya estudiado', () => {
    const today = localDay(now);
    const yesterday = localDay(now - DAY);
    const before = localDay(now - 2 * DAY);
    expect(computeStreak(new Set([today, yesterday, before]), today)).toEqual({ current: 3, longest: 3 });
    expect(computeStreak(new Set([yesterday, before]), today)).toEqual({ current: 2, longest: 2 });
    expect(computeStreak(new Set([before]), today)).toEqual({ current: 0, longest: 1 });
    expect(computeStreak(new Set(), today)).toEqual({ current: 0, longest: 0 });
  });

  it('la racha atraviesa cambios de mes', () => {
    expect(computeStreak(new Set(['2026-10-31', '2026-11-01']), '2026-11-01')).toEqual({ current: 2, longest: 2 });
  });

  it('la precisión sólo cuenta preguntas tipo test', () => {
    const base = { questionRev: 1, sessionId: null, mode: 'practice', selected: null, selfGrade: null, score: 1, durationMs: 1, subjectId: 's', difficulty: 3, published: 0 } as const;
    const attempts = [
      { ...base, id: 'a', questionId: 'q1', correct: true, at: now },
      { ...base, id: 'b', questionId: 'q2', correct: false, at: now },
      { ...base, id: 'c', questionId: 'q3', correct: null, selfGrade: 2 as const, at: now },
    ];
    const stats = computeLocalStats(attempts, [], now);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.total).toBe(3);
    expect(stats.today).toBe(3);
    expect(stats.unpublished).toBe(3);
    expect(stats.recentDays).toHaveLength(28);
    expect(stats.recentDays.at(-1)?.answers).toBe(3);
  });

  it('separa lo de hoy por tipo, la nota de desarrollo, la semana y el tiempo', () => {
    const base = { questionRev: 1, sessionId: null, mode: 'practice', selected: null, selfGrade: null, score: 1, durationMs: 60_000, subjectId: 's', difficulty: 3, published: 0 } as const;
    const day = 86_400_000;
    const attempts = [
      { ...base, id: 'a', questionId: 'q1', correct: true, at: now },
      { ...base, id: 'b', questionId: 'q2', correct: null, selfGrade: 1 as const, score: 0.5, at: now },
      // Una pregunta abierta durante horas no son horas de estudio.
      { ...base, id: 'c', questionId: 'q3', correct: null, selfGrade: 2 as const, durationMs: 4 * 3_600_000, at: now - 3 * day },
      { ...base, id: 'd', questionId: 'q4', correct: false, at: now - 9 * day },
      { ...base, id: 'e', questionId: 'q5', correct: true, at: now - 20 * day },
    ];
    const stats = computeLocalStats(attempts, [], now);
    expect(stats).toMatchObject({ todayMcq: 1, todayOpen: 1, openTotal: 2, openAverage: 0.75, weekAnswers: 3, previousWeekAnswers: 1 });
    expect(stats.weekMs).toBe(2 * 60_000 + 10 * 60_000);
  });

  it('lo pendiente de repasar sólo cuenta lo que entra en el temario elegido', () => {
    const card = {} as ProgressRow['card'];
    const row = (questionId: string) => ({ questionId, card, due: now - 1000, attempts: 1, correct: 1, lastCorrect: true, lastAt: now, favorite: 0, hard: 0 }) as ProgressRow;
    expect(computeLocalStats([], [row('a'), row('b')], now, 28, (id) => id === 'a').due).toBe(1);
  });
});
