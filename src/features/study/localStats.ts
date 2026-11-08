import { useLiveQuery } from 'dexie-react-hooks';
import { scopePredicate } from '@core/questions/filter';
import { isMastered } from '@core/srs/fsrs';
import { loadQuestions } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
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
  todayMcq: number;
  todayOpen: number;
  mcqTotal: number;
  mcqCorrect: number;
  accuracy: number | null;
  openTotal: number;
  /** Media de la autoevaluación en desarrollo, de 0 a 1. */
  openAverage: number | null;
  studyMs: number;
  /** Los últimos 7 días, hoy incluido, y los 7 anteriores. */
  weekAnswers: number;
  previousWeekAnswers: number;
  weekMs: number;
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

/** Más de diez minutos en una pregunta es que se dejó abierta, no que se estuviera estudiando. */
const MAX_ATTEMPT_MS = 10 * 60 * 1000;

/** `inScope` limita lo que cuenta como pendiente de repasar: no se promete lo que no va a salir. */
export function computeLocalStats(attempts: readonly AttemptRow[], progress: readonly ProgressRow[], now: number, daysBack = 28, inScope: (questionId: string) => boolean = () => true): LocalStats {
  const today = localDay(now);
  const weekStart = addDays(today, -6);
  const previousWeekStart = addDays(today, -13);
  let todayMcq = 0;
  let todayOpen = 0;
  let openTotal = 0;
  let openScore = 0;
  let studyMs = 0;
  let weekAnswers = 0;
  let previousWeekAnswers = 0;
  let weekMs = 0;
  const days = new Map<string, number>();
  const bySubject: LocalStats['bySubject'] = new Map();
  let mcqTotal = 0;
  let mcqCorrect = 0;
  let unpublished = 0;
  let lastAttemptAt: number | null = null;

  for (const attempt of attempts) {
    const day = localDay(attempt.at);
    days.set(day, (days.get(day) ?? 0) + 1);
    const spent = Math.min(attempt.durationMs, MAX_ATTEMPT_MS);
    studyMs += spent;
    if (day >= weekStart) {
      weekAnswers += 1;
      weekMs += spent;
    } else if (day >= previousWeekStart) {
      previousWeekAnswers += 1;
    }
    if (attempt.correct !== null) {
      mcqTotal += 1;
      if (attempt.correct) mcqCorrect += 1;
      if (day === today) todayMcq += 1;
    } else {
      openTotal += 1;
      openScore += attempt.score;
      if (day === today) todayOpen += 1;
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
    todayMcq,
    todayOpen,
    mcqTotal,
    mcqCorrect,
    accuracy: mcqTotal > 0 ? mcqCorrect / mcqTotal : null,
    openTotal,
    openAverage: openTotal > 0 ? openScore / openTotal : null,
    studyMs,
    weekAnswers,
    previousWeekAnswers,
    weekMs,
    streak: current,
    longestStreak: longest,
    due: progress.filter((p) => p.attempts > 0 && p.due <= now && inScope(p.questionId)).length,
    mastered: progress.filter((p) => p.attempts > 0 && isMastered(p.card)).length,
    seen: progress.filter((p) => p.attempts > 0).length,
    lastAttemptAt,
    unpublished,
    bySubject,
    recentDays,
  };
}

export function useLocalStats(): LocalStats | undefined {
  const { studyScope } = preferences.use();
  return useLiveQuery(async () => {
    const [attempts, progress, questions] = await Promise.all([db.attempts.toArray(), db.progress.toArray(), loadQuestions()]);
    const scoped = new Set(questions.filter(scopePredicate(studyScope)).map((q) => q.id));
    return computeLocalStats(attempts, progress, Date.now(), 28, (id) => scoped.has(id));
  }, [studyScope]);
}
