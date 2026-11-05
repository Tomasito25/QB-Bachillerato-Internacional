import { isCorrectSelection } from '../questions/grading.ts';
import type { ActivityItem, DerivedProfile, Leaderboard, LeaderboardEntry, ProfileStats, QuestionStats, UserDetail } from '../schema/derived.ts';
import type { StoredAnswerEvent, SystemEvent } from '../schema/events.ts';
import type { UserDoc } from '../schema/profile.ts';
import type { Question } from '../schema/question.ts';
import { HOUR, dayIndex, dayKey, monthKey, toIso, weekKey } from '../util/time.ts';
import { POLICY } from '../validation/policy.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { levelFromPoints, RULES, wilsonLowerBound } from './rules.ts';

/**
 * De los eventos a las clasificaciones.
 *
 * Es una función pura: mismos eventos, mismo resultado, en cualquier máquina. Por eso nadie
 * tiene que fiarse de lo publicado: cualquiera puede clonar la rama `data` y recalcularlo. Y
 * por eso no hay ningún fichero de puntos que manipular: los puntos no se guardan, se deducen.
 */

export interface CompetitionAward {
  login: string;
  competitionId: string;
  title: string;
  points: number;
  at: number;
  rank: number | null;
  won: boolean;
  tournamentWon: boolean;
  /** Primera vez que este usuario aparece en esta competición. */
  participation: boolean;
}

export interface AggregateInput {
  now: number;
  users: readonly UserDoc[];
  answers: ReadonlyMap<string, readonly StoredAnswerEvent[]>;
  questions: readonly Question[];
  /** Ocultas por moderación: lo ganado con ellas no cuenta. */
  excludedQuestions: ReadonlySet<string>;
  system: readonly SystemEvent[];
  awards: readonly CompetitionAward[];
  banned: ReadonlySet<string>;
  trusted: ReadonlySet<string>;
}

export interface SuspectReport {
  login: string;
  answers: number;
  medianMs: number;
  accuracy: number;
}

export interface AggregateOutput {
  profiles: DerivedProfile[];
  leaderboards: Leaderboard[];
  questionStats: QuestionStats[];
  details: UserDetail[];
  suspects: SuspectReport[];
}

interface LedgerEntry {
  points: number;
  /** Hora de recepción: es la que decide el periodo del ranking, y no la declara el cliente. */
  at: number;
  subjectId: string | null;
  kind: 'answer' | 'self' | 'session' | 'streak' | 'approved' | 'used' | 'competition';
}

interface UserState {
  login: string;
  ledger: LedgerEntry[];
  answers: number;
  mcqAnswers: number;
  mcqCorrect: number;
  sessions: number;
  approved: string[];
  uses: number;
  competitions: Set<string>;
  competitionWins: number;
  tournamentsWon: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveAt: number | null;
  speeds: number[];
  byDay: Map<string, { answers: number; correct: number; points: number }>;
  activity: ActivityItem[];
}

function newState(login: string): UserState {
  return {
    login,
    ledger: [],
    answers: 0,
    mcqAnswers: 0,
    mcqCorrect: 0,
    sessions: 0,
    approved: [],
    uses: 0,
    competitions: new Set(),
    competitionWins: 0,
    tournamentsWon: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveAt: null,
    speeds: [],
    byDay: new Map(),
    activity: [],
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2 : (sorted[middle] as number);
}

/** Una respuesta sólo cuenta si es creíble: ni instantánea, ni del futuro, ni demasiado vieja. */
function isCredible(event: StoredAnswerEvent): boolean {
  if (event.ms < RULES.minAnswerMs) return false;
  const delay = event.rcv - event.at;
  return delay >= -60 && delay <= POLICY.maxAnswerAgeDays * 86_400;
}

function bump<K>(map: Map<K, number>, key: K, by = 1): number {
  const value = (map.get(key) ?? 0) + by;
  map.set(key, value);
  return value;
}

export function aggregate(input: AggregateInput): AggregateOutput {
  const questions = new Map(input.questions.map((q) => [q.id, q]));
  const states = new Map<string, UserState>();
  const state = (login: string) => {
    let current = states.get(login);
    if (!current) {
      current = newState(login);
      states.set(login, current);
    }
    return current;
  };

  const questionAnswers = new Map<string, { answers: number; correct: number; mcq: number; users: Set<string> }>();
  const firstUses: { questionId: string; author: string; rcv: number; at: number }[] = [];

  for (const [login, rawEvents] of input.answers) {
    if (input.banned.has(login)) continue;
    const user = state(login);
    const seen = new Set<string>();
    const events = [...rawEvents]
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

    const awarded = new Map<string, { count: number; lastAt: number }>();
    const dailyAnswerPoints = new Map<string, number>();
    const dailySelf = new Map<string, number>();
    const sessions = new Map<string, { count: number; lastAt: number; lastRcv: number }>();
    const days = new Map<string, { count: number; lastRcv: number }>();
    const answeredByUser = new Set<string>();

    for (const event of events) {
      const question = questions.get(event.q);
      if (!question || input.excludedQuestions.has(event.q) || !isCredible(event)) continue;
      const atMs = event.at * 1000;
      const rcvMs = event.rcv * 1000;
      const day = dayKey(atMs);
      const own = question.author?.login === login;

      user.answers += 1;
      user.lastActiveAt = Math.max(user.lastActiveAt ?? 0, rcvMs);
      const dayRow = days.get(day) ?? { count: 0, lastRcv: 0 };
      dayRow.count += 1;
      dayRow.lastRcv = Math.max(dayRow.lastRcv, rcvMs);
      days.set(day, dayRow);
      const activity = user.byDay.get(day) ?? { answers: 0, correct: 0, points: 0 };
      activity.answers += 1;
      user.byDay.set(day, activity);

      if (event.s) {
        const session = sessions.get(event.s) ?? { count: 0, lastAt: 0, lastRcv: 0 };
        session.count += 1;
        session.lastAt = Math.max(session.lastAt, atMs);
        session.lastRcv = Math.max(session.lastRcv, rcvMs);
        sessions.set(event.s, session);
      }

      const stats = questionAnswers.get(event.q) ?? { answers: 0, correct: 0, mcq: 0, users: new Set<string>() };
      stats.answers += 1;
      stats.users.add(login);
      questionAnswers.set(event.q, stats);

      if (!own && question.author && !answeredByUser.has(event.q)) {
        answeredByUser.add(event.q);
        firstUses.push({ questionId: event.q, author: question.author.login, rcv: rcvMs, at: atMs });
      }

      if (question.type === 'mcq') {
        const correct = isCorrectSelection(question, event.sel ?? []);
        stats.mcq += 1;
        if (correct) stats.correct += 1;
        // Tus propias preguntas no cuentan: conoces la respuesta.
        if (own) continue;
        user.mcqAnswers += 1;
        user.speeds.push(event.ms);
        if (correct) {
          user.mcqCorrect += 1;
          activity.correct += 1;
          const award = awarded.get(event.q) ?? { count: 0, lastAt: 0 };
          const factor = RULES.repeatFactors[award.count];
          if (factor !== undefined && (award.count === 0 || atMs - award.lastAt >= RULES.minHoursBetweenAwards * HOUR)) {
            const base = Math.round((RULES.correctByDifficulty[question.difficulty] as number) * factor);
            const room = RULES.dailyAnswerCap - (dailyAnswerPoints.get(day) ?? 0);
            const points = Math.min(base, Math.max(0, room));
            if (points > 0) {
              bump(dailyAnswerPoints, day, points);
              user.ledger.push({ points, at: rcvMs, subjectId: question.subjectId, kind: 'answer' });
              activity.points += points;
            }
            awarded.set(event.q, { count: award.count + 1, lastAt: atMs });
          }
        }
      } else if (!own && event.g === 2) {
        const award = awarded.get(event.q) ?? { count: 0, lastAt: 0 };
        if (award.count < RULES.repeatFactors.length && (award.count === 0 || atMs - award.lastAt >= RULES.minHoursBetweenAwards * HOUR)) {
          if (bump(dailySelf, day) <= RULES.selfGradedDailyCap) {
            user.ledger.push({ points: RULES.selfGraded, at: rcvMs, subjectId: question.subjectId, kind: 'self' });
            activity.points += RULES.selfGraded;
          }
          awarded.set(event.q, { count: award.count + 1, lastAt: atMs });
        }
      }
    }

    // Sesiones completas
    const dailySessions = new Map<string, number>();
    for (const session of [...sessions.values()].sort((a, b) => a.lastAt - b.lastAt)) {
      if (session.count < RULES.sessionMinAnswers) continue;
      user.sessions += 1;
      if (bump(dailySessions, dayKey(session.lastAt)) <= RULES.sessionsPerDay) {
        user.ledger.push({ points: RULES.sessionComplete, at: session.lastRcv, subjectId: null, kind: 'session' });
      }
    }

    // Rachas: días consecutivos (UTC) con actividad suficiente.
    const streakDays = [...days.entries()]
      .filter(([, row]) => row.count >= RULES.streakDayMinAnswers)
      .map(([day, row]) => ({ index: dayIndex(Date.parse(`${day}T00:00:00Z`)), lastRcv: row.lastRcv }))
      .sort((a, b) => a.index - b.index);
    let run = 0;
    let previous: number | null = null;
    for (const day of streakDays) {
      run = previous !== null && day.index === previous + 1 ? run + 1 : 1;
      previous = day.index;
      user.longestStreak = Math.max(user.longestStreak, run);
      const bonus = RULES.streakBonuses[run];
      if (bonus) user.ledger.push({ points: bonus, at: day.lastRcv, subjectId: null, kind: 'streak' });
    }
    const today = dayIndex(input.now);
    user.currentStreak = previous !== null && today - previous <= 1 ? run : 0;
  }

  // Preguntas aprobadas
  const dailyApproved = new Map<string, number>();
  const seenApproved = new Set<string>();
  for (const event of [...input.system].sort((a, b) => a.at - b.at)) {
    if (event.t !== 'question-approved') continue;
    if (seenApproved.has(event.q) || input.banned.has(event.by)) continue;
    seenApproved.add(event.q);
    const question = questions.get(event.q);
    // Una pregunta retirada u oculta deja de sumar: si no, se podría publicar basura y retirarla.
    if (!question || input.excludedQuestions.has(event.q)) continue;
    const user = state(event.by);
    const atMs = event.at * 1000;
    user.approved.push(event.q);
    user.lastActiveAt = Math.max(user.lastActiveAt ?? 0, atMs);
    user.activity.push({ kind: 'question', at: toIso(atMs), questionId: event.q });
    if (bump(dailyApproved, `${event.by}:${dayKey(atMs)}`) <= RULES.approvedPerDay) {
      user.ledger.push({ points: RULES.questionApproved, at: atMs, subjectId: question.subjectId, kind: 'approved' });
    }
  }

  // Otras personas usan tus preguntas
  const perQuestion = new Map<string, number>();
  const perAuthorDay = new Map<string, number>();
  for (const use of firstUses.sort((a, b) => a.rcv - b.rcv || a.questionId.localeCompare(b.questionId))) {
    if (input.banned.has(use.author)) continue;
    const user = state(use.author);
    user.uses += 1;
    if (bump(perQuestion, use.questionId) > RULES.usedPerQuestion) continue;
    if (bump(perAuthorDay, `${use.author}:${dayKey(use.rcv)}`) > RULES.usedPerDay) continue;
    user.ledger.push({ points: RULES.questionUsed, at: use.rcv, subjectId: questions.get(use.questionId)?.subjectId ?? null, kind: 'used' });
  }

  // Competiciones
  for (const award of input.awards) {
    if (input.banned.has(award.login)) continue;
    const user = state(award.login);
    if (award.points > 0) user.ledger.push({ points: award.points, at: award.at, subjectId: null, kind: 'competition' });
    user.competitions.add(award.competitionId);
    user.lastActiveAt = Math.max(user.lastActiveAt ?? 0, award.at);
    if (award.won) user.competitionWins += 1;
    if (award.tournamentWon) user.tournamentsWon += 1;
    if (award.participation) user.activity.push({ kind: 'competition', at: toIso(award.at), competitionId: award.competitionId, title: award.title, rank: award.rank });
  }

  // Integridad
  const suspects: SuspectReport[] = [];
  const suspectLogins = new Set<string>();
  for (const user of states.values()) {
    if (input.trusted.has(user.login) || user.mcqAnswers < RULES.suspectMinAnswers) continue;
    const accuracy = user.mcqCorrect / user.mcqAnswers;
    const medianMs = median(user.speeds);
    if (accuracy >= RULES.suspectAccuracy && medianMs < RULES.suspectMedianMs) {
      suspectLogins.add(user.login);
      suspects.push({ login: user.login, answers: user.mcqAnswers, medianMs, accuracy });
    }
  }

  // Perfiles
  const docs = new Map(input.users.map((u) => [u.login, u]));
  const totals = new Map<string, number>();
  for (const user of states.values()) totals.set(user.login, user.ledger.reduce((sum, entry) => sum + entry.points, 0));
  const ranked = [...states.values()].filter((user) => docs.has(user.login) && !suspectLogins.has(user.login) && !input.banned.has(user.login));

  const board = (id: string, period: string | null, unit: Leaderboard['unit'], rows: { login: string; value: number; detail?: number }[]): Leaderboard => {
    const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value || a.login.localeCompare(b.login));
    const entries: LeaderboardEntry[] = sorted.map((r, i) => ({ rank: i + 1, login: r.login, value: r.value, ...(r.detail !== undefined ? { detail: r.detail } : {}) }));
    // Sin fecha de generación: el hash del fragmento sólo cambia si cambian los datos, y el
    // cliente no vuelve a bajar lo que ya tiene. La fecha está en el manifiesto.
    return { id, period, unit, entries: entries.slice(0, RULES.leaderboardSize), total: entries.length };
  };

  const sumWhere = (user: UserState, predicate: (entry: LedgerEntry) => boolean) => user.ledger.reduce((sum, entry) => sum + (predicate(entry) ? entry.points : 0), 0);
  const currentWeek = weekKey(input.now);
  const currentMonth = monthKey(input.now);

  const full: Leaderboard[] = [
    board('global', null, 'points', ranked.map((u) => ({ login: u.login, value: totals.get(u.login) ?? 0 }))),
    board('week', currentWeek, 'points', ranked.map((u) => ({ login: u.login, value: sumWhere(u, (e) => weekKey(e.at) === currentWeek) }))),
    board('month', currentMonth, 'points', ranked.map((u) => ({ login: u.login, value: sumWhere(u, (e) => monthKey(e.at) === currentMonth) }))),
    board('contributors', null, 'questions', ranked.map((u) => ({ login: u.login, value: u.approved.length, detail: u.uses }))),
    board(
      'performance',
      null,
      'wilson',
      ranked.filter((u) => u.mcqAnswers >= RULES.performanceMinAnswers).map((u) => ({ login: u.login, value: Math.round(wilsonLowerBound(u.mcqCorrect, u.mcqAnswers) * 1000) / 10, detail: u.mcqAnswers })),
    ),
    board('competitions', null, 'competitions', ranked.map((u) => ({ login: u.login, value: sumWhere(u, (e) => e.kind === 'competition'), detail: u.competitions.size }))),
  ];

  const subjectIds = new Set(input.questions.map((q) => q.subjectId));
  for (const subjectId of [...subjectIds].sort()) {
    const subjectBoard = board(`subject:${subjectId}`, null, 'points', ranked.map((u) => ({ login: u.login, value: sumWhere(u, (e) => e.subjectId === subjectId) })));
    if (subjectBoard.entries.length > 0) full.push(subjectBoard);
  }

  const rankOf = new Map<string, Map<string, number>>();
  for (const leaderboard of full) {
    if (leaderboard.id.startsWith('subject:')) continue;
    rankOf.set(leaderboard.id, new Map(leaderboard.entries.map((e) => [e.login, e.rank])));
  }

  const profiles: DerivedProfile[] = [];
  const details: UserDetail[] = [];
  for (const doc of input.users) {
    if (input.banned.has(doc.login)) continue;
    const user = states.get(doc.login) ?? newState(doc.login);
    const points = totals.get(doc.login) ?? 0;
    const stats: ProfileStats = {
      points,
      level: levelFromPoints(points),
      answers: user.answers,
      mcqAnswers: user.mcqAnswers,
      mcqCorrect: user.mcqCorrect,
      accuracy: user.mcqAnswers > 0 ? user.mcqCorrect / user.mcqAnswers : null,
      sessions: user.sessions,
      questionsApproved: user.approved.length,
      questionUses: user.uses,
      competitions: user.competitions.size,
      competitionWins: user.competitionWins,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastActiveAt: user.lastActiveAt === null ? null : toIso(user.lastActiveAt),
    };
    const ranks: Record<string, number> = {};
    for (const [id, map] of rankOf) {
      const rank = map.get(doc.login);
      if (rank) ranks[id] = rank;
    }
    profiles.push({
      ...doc,
      stats,
      achievements: ACHIEVEMENTS.filter((a) => a.unlocked({ stats, tournamentsWon: user.tournamentsWon })).map((a) => a.id),
      ranks,
      suspect: suspectLogins.has(doc.login),
    });

    const pointsBySubject: Record<string, number> = {};
    for (const entry of user.ledger) if (entry.subjectId) pointsBySubject[entry.subjectId] = (pointsBySubject[entry.subjectId] ?? 0) + entry.points;
    const study: ActivityItem[] = [...user.byDay.entries()].map(([day, row]) => ({ kind: 'study', day, answers: row.answers, correct: row.correct, points: row.points }));
    const when = (item: ActivityItem) => (item.kind === 'study' ? `${item.day}T23:59:59.999Z` : item.at);
    details.push({
      login: doc.login,
      activity: [...study, ...user.activity].sort((a, b) => when(b).localeCompare(when(a))).slice(0, 40),
      contributed: user.approved,
      pointsBySubject,
    });
  }

  const questionStats: QuestionStats[] = [...questionAnswers.entries()]
    .map(([questionId, row]) => ({ questionId, answers: row.answers, uniqueUsers: row.users.size, correctRate: row.mcq > 0 ? row.correct / row.mcq : null }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));

  return { profiles, leaderboards: full, questionStats, details, suspects };
}

