// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activeInRound, buildBracket, buildCompetition, buildScheduledCompetition, competitionAwards, competitionCode, competitionPhase, computeStandings, entryProblem, gradeEntry, normalizeCode, selectCompetitionQuestions, type NewCompetitionInput } from '@core/competitions/competitions';
import { Competition, type CompetitionEntry } from '@core/schema/competition';
import type { McqQuestion, Question } from '@core/schema/question';
import { buildTaxonomyIndex } from '@core/taxonomy/merge';
import { makeMcq, makeOpen, makeSubject, SUBJECT_ID, uuid } from '../fixtures';

const NOW = Date.UTC(2026, 10, 5, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SEED = 'f'.repeat(64);
const index = buildTaxonomyIndex([makeSubject()]);
const CREATOR = { login: 'ana', id: 1 };

const bank: McqQuestion[] = Array.from({ length: 30 }, (_, i) => makeMcq({ id: uuid(5000 + i), statement: `Pregunta ${i} del banco comunitario`, difficulty: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }));
const questionMap = new Map<string, Question>(bank.map((q) => [q.id, q]));

const input = (overrides: Partial<NewCompetitionInput> = {}): NewCompetitionInput => ({
  type: 'group',
  title: 'Liga',
  filters: {},
  questionCount: 10,
  durationSec: 600,
  windowHours: 48,
  invited: [],
  maxParticipants: null,
  ...overrides,
});

function entry(competition: Competition, login: string, correct: number, options: { durationMs?: number; at?: number; round?: number } = {}): CompetitionEntry {
  const ids = competition.type === 'tournament' ? (competition.rounds?.[options.round ?? 0]?.questionIds ?? []) : competition.questionIds;
  return {
    schemaVersion: 1,
    competitionId: competition.id,
    user: { login, id: login.length },
    ...(options.round !== undefined ? { round: options.round } : {}),
    submittedAt: new Date(options.at ?? NOW + HOUR).toISOString(),
    durationMs: options.durationMs ?? 60_000,
    answers: ids.map((q, i) => ({ q, sel: i < correct ? ['a'] : ['b'], ms: 5000 })),
    issue: 1,
  };
}

describe('creación', () => {
  it('produce un documento válido', () => {
    const competition = buildCompetition(input(), CREATOR, NOW, SEED, bank, index, 7);
    expect(Competition.safeParse(competition).success).toBe(true);
    expect(competition.questionIds).toHaveLength(10);
    expect(competition.issue).toBe(7);
    expect(competition.closesAt).toBe(new Date(NOW + 48 * HOUR).toISOString());
  });

  it('un duelo admite sólo dos', () => {
    expect(buildCompetition(input({ type: 'duel', maxParticipants: 50 }), CREATOR, NOW, SEED, bank, index).maxParticipants).toBe(2);
  });

  it('sólo elige preguntas tipo test y respeta los filtros', () => {
    const open = makeOpen({ id: uuid(6000) });
    const picked = selectCompetitionQuestions([...bank, open], { difficulties: [5] }, 20, SEED, index);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((q) => q.type === 'mcq' && q.difficulty === 5)).toBe(true);
    expect(selectCompetitionQuestions(bank, { subjectId: uuid(1) }, 5, SEED, index)).toEqual([]);
    expect(selectCompetitionQuestions(bank, { subjectId: SUBJECT_ID }, 5, SEED, index)).toHaveLength(5);
  });

  it('la selección depende de la semilla y no del orden de los ficheros', () => {
    const a = selectCompetitionQuestions(bank, {}, 10, SEED, index).map((q) => q.id);
    const b = selectCompetitionQuestions([...bank].reverse(), {}, 10, SEED, index).map((q) => q.id);
    const c = selectCompetitionQuestions(bank, {}, 10, 'e'.repeat(64), index).map((q) => q.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('rechaza si no hay preguntas suficientes', () => {
    expect(() => buildCompetition(input(), CREATOR, NOW, SEED, bank.slice(0, 2), index)).toThrow(/al menos 3/);
  });

  it('usa las que haya si son menos de las pedidas', () => {
    expect(buildCompetition(input({ questionCount: 50 }), CREATOR, NOW, SEED, bank.slice(0, 5), index).questionCount).toBe(5);
  });

  it('los códigos son cortos, sin caracteres ambiguos y reproducibles', () => {
    const code = competitionCode(SEED);
    expect(code).toMatch(/^QB-[A-HJKMNP-Z2-9]{6}$/);
    expect(competitionCode(SEED)).toBe(code);
    expect(competitionCode('a'.repeat(64))).not.toBe(code);
    expect(normalizeCode(' qb-abc234 ')).toBe('QB-ABC234');
    expect(normalizeCode('abc234')).toBe('QB-ABC234');
  });

  it('el reto diario es el mismo para todos y dura el día', () => {
    const daily = buildScheduledCompetition('daily', NOW, SEED, bank, index);
    expect(Competition.safeParse(daily).success).toBe(true);
    expect(daily?.id).toBe('daily-2026-11-05');
    expect(daily?.code).toBe('DIA-20261105');
    expect(daily?.opensAt).toBe('2026-11-05T00:00:00.000Z');
    expect(daily?.closesAt).toBe('2026-11-06T00:00:00.000Z');
    expect(daily?.questionIds).toEqual(buildScheduledCompetition('daily', NOW + HOUR, SEED, bank, index)?.questionIds);
  });

  it('el reto semanal va de lunes a lunes', () => {
    const weekly = buildScheduledCompetition('weekly', NOW, SEED, bank, index);
    expect(Competition.safeParse(weekly).success).toBe(true);
    expect(weekly?.id).toBe('weekly-2026-w45');
    expect(weekly?.opensAt).toBe('2026-11-02T00:00:00.000Z');
    expect(weekly?.closesAt).toBe('2026-11-09T00:00:00.000Z');
  });

  it('sin preguntas no se crea el reto', () => {
    expect(buildScheduledCompetition('daily', NOW, SEED, [], index)).toBeNull();
  });
});

describe('entregas', () => {
  const competition = buildCompetition(input({ durationSec: 600, maxParticipants: 3 }), CREATOR, NOW, SEED, bank, index);
  const check = (overrides = {}) => entryProblem({ competition, login: 'ana', rcvMs: NOW + HOUR, durationMs: 60_000, alreadyEntered: false, participantCount: 0, registered: [], ...overrides });

  it('acepta una entrega dentro de plazo', () => {
    expect(check()).toBeNull();
  });

  it('sólo cuenta la primera entrega', () => {
    expect(check({ alreadyEntered: true })).toMatch(/primera/);
  });

  it('el plazo lo marca la hora de GitHub', () => {
    expect(check({ rcvMs: NOW - HOUR })).toMatch(/no ha empezado/);
    expect(check({ rcvMs: NOW + 49 * HOUR })).toMatch(/terminó/);
    expect(check({ rcvMs: NOW + 48 * HOUR + 60_000 })).toBeNull();
  });

  it('respeta el cupo', () => {
    expect(check({ participantCount: 3 })).toMatch(/completa/);
  });

  it('rechaza declarar más tiempo del permitido', () => {
    expect(check({ durationMs: 900_000 })).toMatch(/más tiempo/);
  });
});

describe('clasificación', () => {
  const competition = buildCompetition(input(), CREATOR, NOW, SEED, bank, index);

  it('ordena por aciertos y desempata por tiempo y entrega', () => {
    const rows = computeStandings(competition, [entry(competition, 'lenta', 8, { durationMs: 90_000 }), entry(competition, 'mejor', 9), entry(competition, 'rapida', 8, { durationMs: 30_000 })], questionMap);
    expect(rows.map((r) => [r.rank, r.login, r.correct])).toEqual([
      [1, 'mejor', 9],
      [2, 'rapida', 8],
      [3, 'lenta', 8],
    ]);
  });

  it('corrige en servidor: no hay campo para declarar la nota', () => {
    const graded = gradeEntry(entry(competition, 'ana', 4), competition.questionIds, questionMap);
    expect(graded).toMatchObject({ correct: 4, total: 10 });
  });

  it('ignora respuestas a preguntas ajenas a la competición y repetidas', () => {
    const base = entry(competition, 'ana', 1);
    const q = competition.questionIds[0] as string;
    const stuffed = { ...base, answers: [{ q, sel: ['a'], ms: 1 }, { q, sel: ['a'], ms: 1 }, { q: uuid(99999), sel: ['a'], ms: 1 }] };
    expect(gradeEntry(stuffed, competition.questionIds, questionMap).correct).toBe(1);
  });

  it('una pregunta retirada no suma ni rompe', () => {
    const graded = gradeEntry(entry(competition, 'ana', 10), competition.questionIds, new Map());
    expect(graded.correct).toBe(0);
  });
});

describe('torneo', () => {
  const tournament = buildCompetition(input({ type: 'tournament', maxParticipants: 8, registrationHours: 24, roundHours: 48, questionCount: 5 }), CREATOR, NOW, SEED, bank, index);
  const regEnd = NOW + 24 * HOUR;

  it('programa las rondas tras la inscripción', () => {
    expect(Competition.safeParse(tournament).success).toBe(true);
    expect(tournament.rounds).toHaveLength(3);
    expect(tournament.rounds?.[0]?.opensAt).toBe(new Date(regEnd).toISOString());
    expect(tournament.rounds?.[2]?.closesAt).toBe(tournament.closesAt);
    expect(competitionPhase(tournament, NOW + HOUR)).toBe('registration');
    expect(competitionPhase(tournament, regEnd + HOUR)).toBe('open');
    expect(competitionPhase(tournament, Date.parse(tournament.closesAt) + 1)).toBe('closed');
  });

  it('el cuadro es reproducible y cada inscrito aparece una vez', () => {
    const players = ['ana', 'bea', 'carlos', 'dani', 'eva', 'fran', 'gema', 'hugo'];
    const a = buildBracket(tournament, players, [], questionMap, regEnd + HOUR);
    const b = buildBracket(tournament, [...players].reverse(), [], questionMap, regEnd + HOUR);
    expect(a).toEqual(b);
    const first = a.rounds[0]?.matches ?? [];
    expect(first).toHaveLength(4);
    expect(first.flatMap((m) => [m.a, m.b]).sort()).toEqual(players);
    expect(first.every((m) => m.decidedBy === 'pending')).toBe(true);
  });

  it('con número impar hay exenciones, y el exento avanza', () => {
    const players = ['ana', 'bea', 'carlos', 'dani', 'eva'];
    const { rounds } = buildBracket(tournament, players, [], questionMap, regEnd + HOUR);
    const byes = rounds[0]?.matches.filter((m) => m.decidedBy === 'bye') ?? [];
    expect(byes).toHaveLength(3);
    expect(byes.every((m) => m.winner !== null)).toBe(true);
  });

  it('avanza quien más acierta y resuelve todo el cuadro hasta el campeón', () => {
    const players = ['ana', 'bea', 'carlos', 'dani'];
    const initial = buildBracket(tournament, players, [], questionMap, regEnd + HOUR);
    expect(activeInRound(initial, 0).sort()).toEqual(players);
    const [m1, m2] = initial.rounds[0]?.matches ?? [];
    const entries = [entry(tournament, m1?.a as string, 5, { round: 0 }), entry(tournament, m1?.b as string, 1, { round: 0 }), entry(tournament, m2?.a as string, 1, { round: 0 }), entry(tournament, m2?.b as string, 4, { round: 0 })];
    const afterFirst = buildBracket(tournament, players, entries, questionMap, regEnd + HOUR);
    expect(afterFirst.rounds[0]?.matches.map((m) => m.winner)).toEqual([m1?.a, m2?.b]);
    expect(afterFirst.rounds[0]?.matches[0]?.decidedBy).toBe('score');
    expect(activeInRound(afterFirst, 1).sort()).toEqual([m1?.a, m2?.b].sort());
    expect(afterFirst.champion).toBeNull();

    const final = [...entries, entry(tournament, m1?.a as string, 2, { round: 1 }), entry(tournament, m2?.b as string, 5, { round: 1 })];
    const finished = buildBracket(tournament, players, final, questionMap, regEnd + 96 * HOUR);
    expect(finished.champion).toBe(m2?.b);
    expect(finished.finalist).toBe(m1?.a);
  });

  it('una incomparecencia se decide al cerrar la ronda, y se dice como tal', () => {
    const players = ['ana', 'bea'];
    const initial = buildBracket(tournament, players, [], questionMap, regEnd + HOUR);
    const match = initial.rounds[0]?.matches[0];
    const entries = [entry(tournament, match?.b as string, 0, { round: 0 })];
    const during = buildBracket(tournament, players, entries, questionMap, regEnd + HOUR);
    expect(during.rounds[0]?.matches[0]?.decidedBy).toBe('pending');
    const after = buildBracket(tournament, players, entries, questionMap, regEnd + 49 * HOUR);
    expect(after.rounds[0]?.matches[0]).toMatchObject({ winner: match?.b, decidedBy: 'walkover' });
  });

  it('si nadie se presenta el cuadro no se atasca', () => {
    const after = buildBracket(tournament, ['ana', 'bea'], [], questionMap, regEnd + 49 * HOUR);
    expect(after.rounds[0]?.matches[0]?.decidedBy).toBe('seed');
    expect(after.champion).not.toBeNull();
  });

  it('con menos de dos inscritos no hay cuadro', () => {
    expect(buildBracket(tournament, ['ana'], [], questionMap, NOW).rounds).toEqual([]);
  });

  it('sólo juega quien está inscrito y sigue vivo', () => {
    const base = { competition: tournament, login: 'ana', rcvMs: regEnd + HOUR, durationMs: 1000, alreadyEntered: false, participantCount: 0, round: 0 };
    expect(entryProblem({ ...base, registered: ['bea'] })).toMatch(/inscrito/);
    expect(entryProblem({ ...base, registered: ['ana'], activeInRound: ['bea'] })).toMatch(/No juegas/);
    expect(entryProblem({ ...base, registered: ['ana'], activeInRound: ['ana'] })).toBeNull();
    expect(entryProblem({ ...base, registered: ['ana'], rcvMs: NOW })).toMatch(/no ha empezado/);
    expect(entryProblem({ ...base, registered: ['ana'], round: 9 })).toMatch(/no existe/);
  });
});

describe('premios', () => {
  it('el duelo se decide cuando han jugado los dos', () => {
    const duel = buildCompetition(input({ type: 'duel' }), CREATOR, NOW, SEED, bank, index);
    const one = [entry(duel, 'ana', 5)];
    expect(competitionAwards(duel, computeStandings(duel, one, questionMap), null, one, NOW + HOUR).filter((a) => a.won)).toEqual([]);
    const both = [entry(duel, 'ana', 5), entry(duel, 'bea', 7)];
    const awards = competitionAwards(duel, computeStandings(duel, both, questionMap), null, both, NOW + 2 * HOUR);
    expect(awards.find((a) => a.won)?.login).toBe('bea');
    expect(awards.filter((a) => a.participation).map((a) => a.login).sort()).toEqual(['ana', 'bea']);
  });

  it('el podio se reparte al cerrar y con participación suficiente', () => {
    const group = buildCompetition(input(), CREATOR, NOW, SEED, bank, index);
    const entries = [entry(group, 'a', 9), entry(group, 'b', 8), entry(group, 'c', 7), entry(group, 'd', 6)];
    const standings = computeStandings(group, entries, questionMap);
    expect(competitionAwards(group, standings, null, entries, NOW + HOUR).filter((a) => !a.participation)).toEqual([]);
    const closed = competitionAwards(group, standings, null, entries, NOW + 3 * DAY).filter((a) => !a.participation);
    expect(closed.map((a) => [a.login, a.points])).toEqual([
      ['a', 30],
      ['b', 20],
      ['c', 10],
    ]);
    const two = entries.slice(0, 2);
    expect(competitionAwards(group, computeStandings(group, two, questionMap), null, two, NOW + 3 * DAY).filter((a) => !a.participation)).toEqual([]);
  });

  it('nadie gana sin acertar nada', () => {
    const group = buildCompetition(input(), CREATOR, NOW, SEED, bank, index);
    const entries = [entry(group, 'a', 0), entry(group, 'b', 0), entry(group, 'c', 0)];
    expect(competitionAwards(group, computeStandings(group, entries, questionMap), null, entries, NOW + 3 * DAY).filter((a) => !a.participation)).toEqual([]);
  });
});
