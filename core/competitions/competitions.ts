import { filterQuestions } from '../questions/filter.ts';
import { isCorrectSelection } from '../questions/grading.ts';
import type { BracketMatch, BracketRound, StandingRow } from '../schema/derived.ts';
import type { Competition, CompetitionEntry, CompetitionFilters, CompetitionRound } from '../schema/competition.ts';
import type { UserRef } from '../schema/common.ts';
import type { Question } from '../schema/question.ts';
import type { TaxonomyIndex } from '../taxonomy/merge.ts';
import { RULES } from '../scoring/rules.ts';
import type { CompetitionAward } from '../scoring/aggregate.ts';
import { selectBalanced } from '../study/select.ts';
import { seededRandom, shuffle } from '../util/rng.ts';
import { DAY, HOUR, startOfIsoWeek, toIso, weekKey } from '../util/time.ts';
import { POLICY } from '../validation/policy.ts';

/** Sin caracteres que se confundan al dictar un código: ni 0/O ni 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function competitionCode(seed: string): string {
  const random = seededRandom(`code:${seed}`);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `QB-${code}`;
}

export function normalizeCode(input: string): string {
  const clean = input.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{6}$/.test(clean) ? `QB-${clean}` : clean;
}

/**
 * Elige las preguntas con una semilla que el creador no podía conocer al enviar. Sólo test:
 * el desarrollo no se puede corregir de forma objetiva. Se ordena antes de barajar para que el
 * resultado no dependa del orden en que el sistema de ficheros devuelva las preguntas.
 */
export function selectCompetitionQuestions(questions: readonly Question[], filters: CompetitionFilters, count: number, seed: string, index: TaxonomyIndex): Question[] {
  const pool = filterQuestions(questions, filters, index)
    .filter((q) => q.type === 'mcq')
    .sort((a, b) => a.id.localeCompare(b.id));
  return selectBalanced(pool, count, seededRandom(seed));
}

export interface NewCompetitionInput {
  type: Competition['type'];
  title: string;
  filters: CompetitionFilters;
  questionCount: number;
  durationSec: number;
  windowHours: number;
  invited: string[];
  maxParticipants: number | null;
  registrationHours?: number;
  roundHours?: number;
}

export class CompetitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompetitionError';
  }
}

const MIN_QUESTIONS = 3;

export function buildCompetition(input: NewCompetitionInput, creator: UserRef | null, createdAtMs: number, seed: string, questions: readonly Question[], index: TaxonomyIndex, issue?: number): Competition {
  const base = {
    schemaVersion: 1 as const,
    id: `c-${seed.slice(0, 16)}`,
    code: competitionCode(seed),
    type: input.type,
    title: input.title,
    createdBy: creator,
    createdAt: toIso(createdAtMs),
    filters: input.filters,
    durationSec: input.durationSec,
    seed,
    invited: input.invited,
    ...(issue ? { issue } : {}),
  };

  if (input.type === 'tournament') {
    const maxParticipants = input.maxParticipants ?? 8;
    const roundCount = Math.max(1, Math.ceil(Math.log2(maxParticipants)));
    const registrationHours = input.registrationHours ?? 24;
    const roundHours = input.roundHours ?? 48;
    const registrationClosesAt = createdAtMs + registrationHours * HOUR;
    const rounds: CompetitionRound[] = [];
    for (let i = 0; i < roundCount; i++) {
      const picked = selectCompetitionQuestions(questions, input.filters, input.questionCount, `${seed}:round:${i}`, index);
      if (picked.length < MIN_QUESTIONS) throw new CompetitionError(`Sólo hay ${picked.length} preguntas tipo test con esos filtros; hacen falta al menos ${MIN_QUESTIONS}.`);
      rounds.push({
        index: i,
        opensAt: toIso(registrationClosesAt + i * roundHours * HOUR),
        closesAt: toIso(registrationClosesAt + (i + 1) * roundHours * HOUR),
        questionIds: picked.map((q) => q.id),
      });
    }
    return {
      ...base,
      questionCount: rounds[0]?.questionIds.length ?? input.questionCount,
      questionIds: [],
      opensAt: toIso(createdAtMs),
      closesAt: rounds.at(-1)?.closesAt as string,
      maxParticipants,
      registrationClosesAt: toIso(registrationClosesAt),
      rounds,
    };
  }

  const picked = selectCompetitionQuestions(questions, input.filters, input.questionCount, seed, index);
  if (picked.length < MIN_QUESTIONS) throw new CompetitionError(`Sólo hay ${picked.length} preguntas tipo test con esos filtros; hacen falta al menos ${MIN_QUESTIONS}.`);
  return {
    ...base,
    questionCount: picked.length,
    questionIds: picked.map((q) => q.id),
    opensAt: toIso(createdAtMs),
    closesAt: toIso(createdAtMs + input.windowHours * HOUR),
    maxParticipants: input.type === 'duel' ? 2 : input.maxParticipants,
  };
}

/** Retos programados: los crea un cron, el mismo para todo el mundo. */
export function buildScheduledCompetition(kind: 'daily' | 'weekly', nowMs: number, seed: string, questions: readonly Question[], index: TaxonomyIndex): Competition | null {
  const isDaily = kind === 'daily';
  const day = Math.floor(nowMs / DAY) * DAY;
  const opens = isDaily ? day : startOfIsoWeek(nowMs);
  const closes = opens + (isDaily ? DAY : 7 * DAY);
  const stamp = isDaily ? toIso(day).slice(0, 10) : weekKey(nowMs);
  const count = isDaily ? 10 : 20;
  const picked = selectCompetitionQuestions(questions, {}, count, seed, index);
  if (picked.length < MIN_QUESTIONS) return null;
  return {
    schemaVersion: 1,
    id: `${kind}-${stamp.toLowerCase()}`,
    code: isDaily ? `DIA-${stamp.replace(/-/g, '')}` : `SEM-${stamp.replace('-', '')}`,
    type: kind,
    title: isDaily ? `Reto diario · ${stamp}` : `Reto semanal · ${stamp}`,
    createdBy: null,
    createdAt: toIso(nowMs),
    filters: {},
    questionCount: picked.length,
    durationSec: isDaily ? 10 * 60 : 25 * 60,
    seed,
    questionIds: picked.map((q) => q.id),
    opensAt: toIso(opens),
    closesAt: toIso(closes),
    maxParticipants: null,
    invited: [],
  };
}

export function roundOf(competition: Competition, round: number | undefined): CompetitionRound | undefined {
  return competition.rounds?.find((r) => r.index === round);
}

export function questionsFor(competition: Competition, round?: number): readonly string[] {
  return competition.type === 'tournament' ? (roundOf(competition, round)?.questionIds ?? []) : competition.questionIds;
}

export type CompetitionPhase = 'registration' | 'open' | 'closed' | 'upcoming';

export function competitionPhase(competition: Competition, now: number): CompetitionPhase {
  if (now < Date.parse(competition.opensAt)) return 'upcoming';
  if (competition.registrationClosesAt && now < Date.parse(competition.registrationClosesAt)) return 'registration';
  return now >= Date.parse(competition.closesAt) ? 'closed' : 'open';
}

export interface EntryCheck {
  competition: Competition;
  login: string;
  rcvMs: number;
  round?: number;
  durationMs: number;
  alreadyEntered: boolean;
  participantCount: number;
  registered: readonly string[];
  /** Sólo torneos: quién juega esta ronda. */
  activeInRound?: readonly string[];
}

/** Devuelve el motivo de rechazo, o null si la entrega vale. El plazo lo marca el reloj de GitHub. */
export function entryProblem(check: EntryCheck): string | null {
  const { competition, rcvMs } = check;
  if (check.alreadyEntered) return 'Ya entregaste en esta competición: sólo cuenta la primera entrega.';
  const opens = Date.parse(competition.opensAt);
  if (competition.type === 'tournament') {
    const round = roundOf(competition, check.round);
    if (!round) return 'Esa ronda no existe.';
    if (!check.registered.includes(check.login)) return 'No estás inscrito en este torneo.';
    if (check.activeInRound && !check.activeInRound.includes(check.login)) return 'No juegas esta ronda.';
    if (rcvMs < Date.parse(round.opensAt)) return 'Esa ronda aún no ha empezado.';
    if (rcvMs > Date.parse(round.closesAt) + POLICY.competitionGraceMs) return 'El plazo de esa ronda ya terminó.';
  } else {
    if (rcvMs < opens) return 'La competición aún no ha empezado.';
    if (rcvMs > Date.parse(competition.closesAt) + POLICY.competitionGraceMs) return 'El plazo de entrega ya terminó.';
    if (competition.maxParticipants !== null && check.participantCount >= competition.maxParticipants) return 'La competición está completa.';
  }
  // Generoso con la latencia del envío: no es verificable, pero sí descarta lo evidente.
  if (check.durationMs > (competition.durationSec + 120) * 1000) return 'Declara más tiempo del permitido.';
  return null;
}

export interface GradedEntry {
  login: string;
  correct: number;
  total: number;
  durationMs: number;
  submittedAt: string;
}

/** Corrige con las preguntas actuales. Sólo cuentan las de la competición, una vez cada una. */
export function gradeEntry(entry: CompetitionEntry, questionIds: readonly string[], questions: ReadonlyMap<string, Question>): GradedEntry {
  const allowed = new Set(questionIds);
  const seen = new Set<string>();
  let correct = 0;
  for (const answer of entry.answers) {
    if (!allowed.has(answer.q) || seen.has(answer.q)) continue;
    seen.add(answer.q);
    const question = questions.get(answer.q);
    if (question?.type === 'mcq' && isCorrectSelection(question, answer.sel)) correct += 1;
  }
  return { login: entry.user.login, correct, total: questionIds.length, durationMs: entry.durationMs, submittedAt: entry.submittedAt };
}

function compareGraded(a: GradedEntry, b: GradedEntry): number {
  return b.correct - a.correct || a.durationMs - b.durationMs || a.submittedAt.localeCompare(b.submittedAt) || a.login.localeCompare(b.login);
}

export function computeStandings(competition: Competition, entries: readonly CompetitionEntry[], questions: ReadonlyMap<string, Question>): StandingRow[] {
  return entries
    .map((entry) => gradeEntry(entry, questionsFor(competition, entry.round), questions))
    .sort(compareGraded)
    .map((row, i) => ({ rank: i + 1, login: row.login, correct: row.correct, total: row.total, durationMs: row.durationMs, submittedAt: row.submittedAt }));
}

/** Coloca a los participantes en orden de semilla, con exenciones para completar la potencia de 2. */
function seedPositions(size: number): number[] {
  let positions = [0];
  while (positions.length < size) {
    const next: number[] = [];
    const sum = positions.length * 2 - 1;
    for (const position of positions) next.push(position, sum - position);
    positions = next;
  }
  return positions;
}

export interface BracketResult {
  rounds: BracketRound[];
  champion: string | null;
  finalist: string | null;
}

/**
 * Cuadro de eliminatoria. Es una función pura de los inscritos, la semilla y las entregas: no
 * hay que guardarlo, y nadie puede retocarlo.
 */
export function buildBracket(competition: Competition, registered: readonly string[], entries: readonly CompetitionEntry[], questions: ReadonlyMap<string, Question>, now: number): BracketResult {
  const scheduled = competition.rounds ?? [];
  if (registered.length < 2 || scheduled.length === 0) return { rounds: [], champion: null, finalist: null };
  const seeded = shuffle([...registered].sort(), seededRandom(`${competition.seed}:bracket`));
  const size = 2 ** Math.ceil(Math.log2(seeded.length));
  const slots = seedPositions(size).map((position) => seeded[position] ?? null);

  const byRound = new Map<number, Map<string, GradedEntry>>();
  for (const entry of entries) {
    const round = entry.round ?? 0;
    const graded = gradeEntry(entry, questionsFor(competition, round), questions);
    const map = byRound.get(round) ?? new Map<string, GradedEntry>();
    map.set(entry.user.login, graded);
    byRound.set(round, map);
  }

  const rounds: BracketRound[] = [];
  let current: (string | null)[] = slots;
  /** En rondas sin resolver todavía hay huecos desconocidos, que no son exenciones. */
  let pendingSlots: boolean[] = slots.map(() => false);
  let finalist: string | null = null;
  let champion: string | null = null;

  for (let index = 0; index < scheduled.length && current.length >= 2; index++) {
    const window = scheduled[index] as CompetitionRound;
    const closed = now > Date.parse(window.closesAt) + POLICY.competitionGraceMs;
    const results = byRound.get(index) ?? new Map<string, GradedEntry>();
    const matches: BracketMatch[] = [];
    const winners: (string | null)[] = [];
    const winnersPending: boolean[] = [];

    for (let i = 0; i < current.length; i += 2) {
      const a = current[i] ?? null;
      const b = current[i + 1] ?? null;
      const aPending = pendingSlots[i] ?? false;
      const bPending = pendingSlots[i + 1] ?? false;
      const ra = a ? results.get(a) : undefined;
      const rb = b ? results.get(b) : undefined;
      let winner: string | null = null;
      let decidedBy: BracketMatch['decidedBy'] = 'pending';

      if (aPending || bPending) {
        decidedBy = 'pending';
      } else if (a && !b) {
        winner = a;
        decidedBy = 'bye';
      } else if (b && !a) {
        winner = b;
        decidedBy = 'bye';
      } else if (a && b) {
        if (ra && rb) {
          const order = compareGraded(ra, rb);
          winner = order <= 0 ? a : b;
          decidedBy = ra.correct !== rb.correct ? 'score' : ra.durationMs !== rb.durationMs ? 'time' : 'submission';
        } else if (closed) {
          if (ra) {
            winner = a;
            decidedBy = 'walkover';
          } else if (rb) {
            winner = b;
            decidedBy = 'walkover';
          } else {
            // Ninguno se presentó: pasa el primero del sorteo, para que el cuadro no se atasque.
            winner = a;
            decidedBy = 'seed';
          }
        }
      }

      matches.push({ a, b, winner, correctA: ra?.correct ?? null, correctB: rb?.correct ?? null, decidedBy });
      winners.push(winner);
      winnersPending.push(decidedBy === 'pending');
    }

    rounds.push({ index, opensAt: window.opensAt, closesAt: window.closesAt, matches });
    if (current.length === 2) {
      const final = matches[0];
      champion = final?.winner ?? null;
      if (final?.winner) finalist = final.winner === final.a ? final.b : final.a;
    }
    current = winners;
    pendingSlots = winnersPending;
  }

  return { rounds, champion, finalist };
}

/** Quién juega una ronda de un torneo, según lo resuelto hasta ahora. */
export function activeInRound(bracket: BracketResult, round: number): string[] {
  const matches = bracket.rounds.find((r) => r.index === round)?.matches ?? [];
  return matches.flatMap((m) => [m.a, m.b]).filter((login): login is string => login !== null);
}

export function competitionAwards(competition: Competition, standings: readonly StandingRow[], bracket: BracketResult | null, entries: readonly CompetitionEntry[], now: number): CompetitionAward[] {
  const awards: CompetitionAward[] = [];
  const closed = now >= Date.parse(competition.closesAt);
  const closesAt = Date.parse(competition.closesAt);
  const firstEntry = new Map<string, string>();
  for (const entry of [...entries].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (!firstEntry.has(entry.user.login)) firstEntry.set(entry.user.login, entry.submittedAt);
  }
  const base = { competitionId: competition.id, title: competition.title };
  const rankOf = new Map(standings.map((row) => [row.login, row.rank]));

  for (const [login, submittedAt] of firstEntry) {
    awards.push({ ...base, login, points: RULES.competitionParticipation, at: Date.parse(submittedAt), rank: competition.type === 'tournament' ? null : (rankOf.get(login) ?? null), won: false, tournamentWon: false, participation: true });
  }

  if (competition.type === 'tournament') {
    if (bracket?.champion) {
      awards.push({ ...base, login: bracket.champion, points: RULES.tournamentChampion, at: closesAt, rank: 1, won: true, tournamentWon: true, participation: false });
    }
    if (bracket?.finalist) {
      awards.push({ ...base, login: bracket.finalist, points: RULES.tournamentFinalist, at: closesAt, rank: 2, won: false, tournamentWon: false, participation: false });
    }
    return awards;
  }

  if (competition.type === 'duel') {
    // El duelo se decide en cuanto han jugado los dos, sin esperar al plazo.
    const winner = standings[0];
    if (winner && standings.length === 2 && standings[1] && winner.correct > 0) {
      awards.push({ ...base, login: winner.login, points: RULES.duelWin, at: Date.parse(standings.map((s) => s.submittedAt).sort().at(-1) as string), rank: 1, won: true, tournamentWon: false, participation: false });
    }
    return awards;
  }

  if (closed && standings.length >= RULES.podiumMinParticipants) {
    standings.slice(0, RULES.podium.length).forEach((row, i) => {
      if (row.correct > 0) {
        awards.push({ ...base, login: row.login, points: RULES.podium[i] as number, at: closesAt, rank: row.rank, won: i === 0, tournamentWon: false, participation: false });
      }
    });
  }
  return awards;
}
