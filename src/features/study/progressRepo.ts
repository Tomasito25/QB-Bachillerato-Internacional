import { useLiveQuery } from 'dexie-react-hooks';
import { newCard } from '@core/srs/fsrs';
import { db } from '@/infra/db/db';
import type { ProgressRow } from '@/infra/db/types';

export function emptyProgress(questionId: string, now: number): ProgressRow {
  const card = newCard(now);
  return { questionId, card, due: card.due, attempts: 0, correct: 0, lastCorrect: null, lastAt: 0, favorite: 0, hard: 0 };
}

async function toggleFlag(questionId: string, flag: 'favorite' | 'hard'): Promise<boolean> {
  return db.transaction('rw', db.progress, async () => {
    const row = (await db.progress.get(questionId)) ?? emptyProgress(questionId, Date.now());
    const value = row[flag] === 1 ? 0 : 1;
    await db.progress.put({ ...row, [flag]: value });
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
