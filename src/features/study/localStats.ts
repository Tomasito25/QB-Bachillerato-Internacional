import { useLiveQuery } from 'dexie-react-hooks';
import { isMastered } from '@core/srs/fsrs';
import { db } from '@/infra/db/db';
import type { AttemptRow, ProgressRow } from '@/infra/db/types';

/**
 * Estadísticas del dispositivo. No son oficiales: se calculan con lo que hay aquí, incluso sin
 * publicar. Lo oficial está en el perfil, calculado por Actions. La UI nunca los mezcla.
 */

/** Día local como `2026-11-05`. Para la racha personal importa el día del usuario, no el UTC. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(y, m - 1, d + delta).getTime());
}

export function computeStreak(days: ReadonlySet<string>, today: string): { current: number; longest: number } {
  let current = 0;
  // Hoy aún se puede estudiar: que hoy esté vacío no rompe la racha de ayer.
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...days].sort()) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return { current, longest };
}

export interface DayActivity {
  day: string;
  answers: number;
}

export interface LocalStats {
  total: number;
  today: number;
  mcqTotal: number;
  mcqCorrect: number;
  accuracy: number | null;
  streak: number;
  longestStreak: number;
  due: number;
  mastered: number;
  seen: number;
  lastAttemptAt: number | null;
  unpublished: number;
  bySubject: Map<string, { answers: number; correct: number; mcq: number; lastAt: number }>;
  recentDays: DayActivity[];
}

export function computeLocalStats(attempts: readonly AttemptRow[], progress: readonly ProgressRow[], now: number, daysBack = 28): LocalStats {
  const today = localDay(now);
  const days = new Map<string, number>();
  const bySubject: LocalStats['bySubject'] = new Map();
  let mcqTotal = 0;
  let mcqCorrect = 0;
  let unpublished = 0;
  let lastAttemptAt: number | null = null;

  for (const attempt of attempts) {
    const day = localDay(attempt.at);
    days.set(day, (days.get(day) ?? 0) + 1);
    if (attempt.correct !== null) {
      mcqTotal += 1;
      if (attempt.correct) mcqCorrect += 1;
    }
    if (attempt.published === 0) unpublished += 1;
    if (lastAttemptAt === null || attempt.at > lastAttemptAt) lastAttemptAt = attempt.at;
    const subject = bySubject.get(attempt.subjectId) ?? { answers: 0, correct: 0, mcq: 0, lastAt: 0 };
    subject.answers += 1;
    if (attempt.correct !== null) subject.mcq += 1;
    if (attempt.correct) subject.correct += 1;
    subject.lastAt = Math.max(subject.lastAt, attempt.at);
    bySubject.set(attempt.subjectId, subject);
  }

  const { current, longest } = computeStreak(new Set(days.keys()), today);
  const recentDays: DayActivity[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    recentDays.push({ day, answers: days.get(day) ?? 0 });
  }

  return {
    total: attempts.length,
    today: days.get(today) ?? 0,
    mcqTotal,
    mcqCorrect,
    accuracy: mcqTotal > 0 ? mcqCorrect / mcqTotal : null,
    streak: current,
    longestStreak: longest,
    due: progress.filter((p) => p.attempts > 0 && p.due <= now).length,
    mastered: progress.filter((p) => p.attempts > 0 && isMastered(p.card)).length,
    seen: progress.filter((p) => p.attempts > 0).length,
    lastAttemptAt,
    unpublished,
    bySubject,
    recentDays,
  };
}

export function useLocalStats(): LocalStats | undefined {
  return useLiveQuery(async () => {
    const [attempts, progress] = await Promise.all([db.attempts.toArray(), db.progress.toArray()]);
    return computeLocalStats(attempts, progress, Date.now());
  }, []);
}
