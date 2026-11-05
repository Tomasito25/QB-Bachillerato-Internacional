import { beforeEach, describe, expect, it } from 'vitest';
import { discardLocalQuestion, loadQuestions, saveLocalQuestion } from '@/features/bank/questionsRepo';
import { db } from '@/infra/db/db';
import { commitAnswer, commitSelfGrade, finishSession, saveDeferredAnswer, startSession, summarizeSession } from '@/features/study/sessions';
import { computeLocalStats, computeStreak, localDay } from '@/features/study/localStats';
import { toggleFavorite, toggleHard } from '@/features/study/progressRepo';
import { makeMcq, makeOpen, makeSubject } from '../fixtures';

async function reset() {
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.cSubjects.put(makeSubject());
}

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
});
