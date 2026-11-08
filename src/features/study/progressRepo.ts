import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_PARAMS, gradeFromResult, newCard, review } from '@core/srs/fsrs';
import { db } from '@/infra/db/db';
import type { AttemptRow, ProgressRow } from '@/infra/db/types';

export function emptyProgress(questionId: string, now: number): ProgressRow {
  const card = newCard(now);
  return { questionId, card, due: card.due, attempts: 0, correct: 0, lastCorrect: null, lastAt: 0, favorite: 0, hard: 0 };
}

/** El estado tras una respuesta. Es pura: también sirve para rehacer el historial al sincronizar. */
export function applyAttempt(row: ProgressRow, attempt: AttemptRow, retention: number): ProgressRow {
  const card = review(row.card, gradeFromResult({ correct: attempt.correct, selfGrade: attempt.selfGrade ?? undefined }), attempt.at, { ...DEFAULT_PARAMS, retention });
  return {
    ...row,
    card,
    due: card.due,
    attempts: row.attempts + 1,
    correct: row.correct + (attempt.correct === true || attempt.selfGrade === 2 ? 1 : 0),
    lastCorrect: attempt.correct ?? attempt.selfGrade === 2,
    lastAt: attempt.at,
  };
}

async function toggleFlag(questionId: string, flag: 'favorite' | 'hard'): Promise<boolean> {
  return db.transaction('rw', db.progress, async () => {
    const row = (await db.progress.get(questionId)) ?? emptyProgress(questionId, Date.now());
    const value = row[flag] === 1 ? 0 : 1;
    await db.progress.put({ ...row, [flag]: value, flagsAt: Date.now() });
    return value === 1;
  });
}

export const toggleFavorite = (questionId: string) => toggleFlag(questionId, 'favorite');
export const toggleHard = (questionId: string) => toggleFlag(questionId, 'hard');

export function useProgress(questionId: string | undefined): ProgressRow | undefined {
  return useLiveQuery(async () => (questionId ? db.progress.get(questionId) : undefined), [questionId]);
}

export function useProgressMap(): Map<string, ProgressRow> | undefined {
  return useLiveQuery(async () => new Map((await db.progress.toArray()).map((row) => [row.questionId, row])), []);
}
