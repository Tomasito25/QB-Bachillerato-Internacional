// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aggregate, type AggregateInput, type CompetitionAward } from '@core/scoring/aggregate';
import { levelFromPoints, pointsForLevel, RULES, wilsonLowerBound } from '@core/scoring/rules';
import type { StoredAnswerEvent, SystemEvent } from '@core/schema/events';
import type { UserDoc } from '@core/schema/profile';
import type { McqQuestion, Question } from '@core/schema/question';
import { makeMcq, makeOpen, uuid } from '../fixtures';

const NOW = Date.UTC(2026, 10, 5, 12);
const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY = 24 * HOUR;

function user(login: string, id = login.length * 7): UserDoc {
  return {
    schemaVersion: 1,
    login,
    githubId: id,
    avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
    registeredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

let counter = 0;
function answer(question: Question, options: { at?: number; sel?: string[]; g?: 0 | 1 | 2; ms?: number; s?: string; rcv?: number } = {}): StoredAnswerEvent {
  const at = options.at ?? NOW - HOUR;
  return {
    id: `attempt${String(++counter).padStart(6, '0')}`,
    q: question.id,
    ...(question.type === 'mcq' ? { sel: options.sel ?? ['a'] } : { g: options.g ?? 2 }),
    ms: options.ms ?? 8000,
    at: Math.floor(at / SEC),
    ...(options.s ? { s: options.s } : {}),
    m: 'practice',
    rcv: Math.floor((options.rcv ?? at + 60_000) / SEC),
    src: 1,
  } as StoredAnswerEvent;
}

function other(difficulty: 1 | 2 | 3 | 4 | 5 = 3): McqQuestion {
  return makeMcq({ id: uuid(), statement: `Pregunta ${uuid()} de otra persona sobre un tema concreto`, difficulty, author: { login: 'autora', id: 50 } });
}

function run(overrides: Partial<AggregateInput> & { users?: UserDoc[] }): ReturnType<typeof aggregate> {
  return aggregate({
    now: NOW,
    users: [user('ana'), user('autora', 50)],
    answers: new Map(),
    questions: [],
    excludedQuestions: new Set(),
    system: [],
    awards: [],
    banned: new Set(),
    trusted: new Set(),
    ...overrides,
  });
}

const profileOf = (output: ReturnType<typeof aggregate>, login: string) => output.profiles.find((p) => p.login === login);
const pointsOf = (output: ReturnType<typeof aggregate>, login: string) => profileOf(output, login)?.stats.points ?? 0;

describe('puntos por responder', () => {
  it('el acierto puntúa según la dificultad; el fallo, nada', () => {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      const q = other(difficulty);
      expect(pointsOf(run({ questions: [q], answers: new Map([['ana', [answer(q)]]]) }), 'ana')).toBe(RULES.correctByDifficulty[difficulty]);
    }
    const q = other();
    expect(pointsOf(run({ questions: [q], answers: new Map([['ana', [answer(q, { sel: ['b'] })]]]) }), 'ana')).toBe(0);
  });

  it('la corrección se recalcula: declarar que se acertó es imposible', () => {
    const q = other();
    const output = run({ questions: [q], answers: new Map([['ana', [answer(q, { sel: ['b', 'c'] })]]]) });
    expect(profileOf(output, 'ana')?.stats.mcqCorrect).toBe(0);
  });

  it('corregir una pregunta recalcula los resultados anteriores', () => {
    const q = other();
    const fixed = { ...q, answers: q.answers.map((a) => ({ ...a, correct: a.id === 'b' })) };
    const events = new Map([['ana', [answer(q, { sel: ['b'] })]]]);
    expect(pointsOf(run({ questions: [q], answers: events }), 'ana')).toBe(0);
    expect(pointsOf(run({ questions: [fixed], answers: events }), 'ana')).toBeGreaterThan(0);
  });
});

describe('resistencia al abuso', () => {
  const base = RULES.correctByDifficulty[3] as number;

  it('repetir la misma pregunta seguida no da puntos infinitos', () => {
    const q = other();
    const events = Array.from({ length: 500 }, (_, i) => answer(q, { at: NOW - HOUR + i * SEC }));
    expect(pointsOf(run({ questions: [q], answers: new Map([['ana', events]]) }), 'ana')).toBe(base);
  });

  it('espaciando la repetición rinde 100 %, 50 %, 25 % y después nada', () => {
    const q = other(5);
    const events = [0, 1, 2, 3, 4, 5].map((i) => answer(q, { at: NOW - (6 - i) * DAY }));
    expect(pointsOf(run({ questions: [q], answers: new Map([['ana', events]]) }), 'ana')).toBe(12 + 6 + 3);
  });

  it('hay un tope diario por muchas preguntas distintas que se acierten', () => {
    const questions = Array.from({ length: 200 }, () => other(5));
    const events = questions.map((q, i) => answer(q, { at: NOW - HOUR + i * SEC }));
    expect(pointsOf(run({ questions, answers: new Map([['ana', events]]) }), 'ana')).toBeLessThanOrEqual(RULES.dailyAnswerCap);
    expect(pointsOf(run({ questions, answers: new Map([['ana', events]]) }), 'ana')).toBe(RULES.dailyAnswerCap);
  });

  it('tus propias preguntas no dan puntos ni cuentan para la precisión', () => {
    const own = makeMcq({ id: uuid(), author: { login: 'ana', id: 21 } });
    const output = run({ questions: [own], answers: new Map([['ana', [answer(own)]]]) });
    expect(pointsOf(output, 'ana')).toBe(0);
    expect(profileOf(output, 'ana')?.stats.mcqAnswers).toBe(0);
  });

  it('reenviar el mismo evento no cuenta dos veces', () => {
    const q = other();
    const event = answer(q);
    const output = run({ questions: [q], answers: new Map([['ana', [event, event, event]]]) });
    expect(profileOf(output, 'ana')?.stats.answers).toBe(1);
    expect(pointsOf(output, 'ana')).toBe(base);
  });

  it('descarta respuestas instantáneas, del futuro o demasiado viejas', () => {
    const q = other();
    const cases = [answer(q, { ms: 100 }), answer(q, { at: NOW + DAY, rcv: NOW }), answer(q, { at: NOW - 30 * DAY, rcv: NOW })];
    for (const event of cases) {
      const output = run({ questions: [q], answers: new Map([['ana', [event]]]) });
      expect(profileOf(output, 'ana')?.stats.answers).toBe(0);
      expect(pointsOf(output, 'ana')).toBe(0);
    }
  });

  it('ignora preguntas inexistentes u ocultas', () => {
    const q = other();
    expect(pointsOf(run({ questions: [], answers: new Map([['ana', [answer(q)]]]) }), 'ana')).toBe(0);
    expect(pointsOf(run({ questions: [q], excludedQuestions: new Set([q.id]), answers: new Map([['ana', [answer(q)]]]) }), 'ana')).toBe(0);
  });

  it('el desarrollo autoevaluado apenas suma y tiene su propio tope', () => {
    const questions = Array.from({ length: 50 }, () => makeOpen({ id: uuid(), statement: `Desarrollo ${uuid()}`, author: { login: 'autora', id: 50 } }));
    const events = questions.map((q, i) => answer(q, { at: NOW - HOUR + i * SEC }));
    expect(pointsOf(run({ questions, answers: new Map([['ana', events]]) }), 'ana')).toBe(RULES.selfGradedDailyCap);
  });

  it('autoevaluarse mal no da puntos, ni cuenta como acierto', () => {
    const q = makeOpen({ id: uuid(), author: { login: 'autora', id: 50 } });
    const output = run({ questions: [q], answers: new Map([['ana', [answer(q, { g: 0 }), answer(q, { g: 1, at: NOW - 2 * DAY })]]]) });
    expect(pointsOf(output, 'ana')).toBe(0);
    expect(profileOf(output, 'ana')?.stats.accuracy).toBeNull();
  });

  it('marca como sospechoso a quien acierta casi todo sin tiempo de leer, y lo saca del ranking', () => {
    const questions = Array.from({ length: 40 }, () => other());
    const events = questions.map((q, i) => answer(q, { ms: 700, at: NOW - HOUR + i * SEC }));
    const output = run({ questions, answers: new Map([['ana', events]]) });
    expect(profileOf(output, 'ana')?.suspect).toBe(true);
    expect(output.suspects[0]?.login).toBe('ana');
    expect(output.leaderboards.find((b) => b.id === 'global')?.entries.map((e) => e.login)).not.toContain('ana');
  });

  it('no marca a quien va rápido pero se equivoca, ni a quien va bien a ritmo normal', () => {
    const questions = Array.from({ length: 40 }, () => other());
    const fastWrong = questions.map((q, i) => answer(q, { ms: 700, sel: i % 2 ? ['a'] : ['b'], at: NOW - HOUR + i * SEC }));
    expect(profileOf(run({ questions, answers: new Map([['ana', fastWrong]]) }), 'ana')?.suspect).toBe(false);
    const normal = questions.map((q, i) => answer(q, { ms: 9000, at: NOW - HOUR + i * SEC }));
    expect(profileOf(run({ questions, answers: new Map([['ana', normal]]) }), 'ana')?.suspect).toBe(false);
  });

  it('un mantenedor puede rehabilitar una cuenta revisada a mano', () => {
    const questions = Array.from({ length: 40 }, () => other());
    const events = questions.map((q, i) => answer(q, { ms: 700, at: NOW - HOUR + i * SEC }));
    const output = run({ questions, trusted: new Set(['ana']), answers: new Map([['ana', events]]) });
    expect(profileOf(output, 'ana')?.suspect).toBe(false);
    expect(output.leaderboards.find((b) => b.id === 'global')?.entries.map((e) => e.login)).toContain('ana');
  });

  it('una cuenta vetada desaparece', () => {
    const q = other();
    const output = run({ questions: [q], banned: new Set(['ana']), answers: new Map([['ana', [answer(q)]]]) });
    expect(profileOf(output, 'ana')).toBeUndefined();
    expect(output.leaderboards.find((b) => b.id === 'global')?.entries).toEqual([]);
  });
});

describe('sesiones y rachas', () => {
  it('premia una sesión completa, no una a medias', () => {
    const questions = Array.from({ length: 12 }, () => other(1));
    const session = uuid();
    const full = questions.slice(0, 10).map((q, i) => answer(q, { s: session, at: NOW - HOUR + i * SEC }));
    expect(pointsOf(run({ questions, answers: new Map([['ana', full]]) }), 'ana')).toBe(10 * 2 + RULES.sessionComplete);
    const partial = questions.slice(0, 9).map((q, i) => answer(q, { s: session, at: NOW - HOUR + i * SEC }));
    expect(pointsOf(run({ questions, answers: new Map([['ana', partial]]) }), 'ana')).toBe(9 * 2);
  });

  it('limita las sesiones premiadas al día', () => {
    const questions = Array.from({ length: 60 }, () => other(1));
    const events = questions.map((q, i) => answer(q, { s: uuid(7000 + Math.floor(i / 10)), at: NOW - HOUR + i * SEC }));
    const output = run({ questions, answers: new Map([['ana', events]]) });
    expect(profileOf(output, 'ana')?.stats.sessions).toBe(6);
    expect(pointsOf(output, 'ana')).toBe(60 * 2 + RULES.sessionsPerDay * RULES.sessionComplete);
  });

  it('las rachas premian días consecutivos con actividad suficiente, una vez por racha', () => {
    const questions = Array.from({ length: 40 }, () => other(1));
    let index = 0;
    const events: StoredAnswerEvent[] = [];
    for (let day = 7; day >= 1; day--) {
      for (let i = 0; i < 5; i++) events.push(answer(questions[index++] as Question, { at: NOW - day * DAY + i * 60_000 }));
    }
    const output = run({ questions, answers: new Map([['ana', events]]) });
    const profile = profileOf(output, 'ana');
    expect(profile?.stats.longestStreak).toBe(7);
    expect(profile?.stats.currentStreak).toBe(7);
    expect(profile?.stats.points).toBe(35 * 2 + (RULES.streakBonuses[3] as number) + (RULES.streakBonuses[7] as number));
  });

  it('un día con pocas respuestas no sostiene la racha', () => {
    const questions = Array.from({ length: 20 }, () => other(1));
    let index = 0;
    const events: StoredAnswerEvent[] = [];
    for (const [day, count] of [[3, 5], [2, 4], [1, 5]] as const) {
      for (let i = 0; i < count; i++) events.push(answer(questions[index++] as Question, { at: NOW - day * DAY + i * 60_000 }));
    }
    expect(profileOf(run({ questions, answers: new Map([['ana', events]]) }), 'ana')?.stats.longestStreak).toBe(1);
  });

  it('la racha actual se pierde si dejas pasar más de un día', () => {
    const questions = Array.from({ length: 5 }, () => other(1));
    const events = questions.map((q, i) => answer(q, { at: NOW - 5 * DAY + i * 60_000 }));
    const profile = profileOf(run({ questions, answers: new Map([['ana', events]]) }), 'ana');
    expect(profile?.stats.currentStreak).toBe(0);
    expect(profile?.stats.longestStreak).toBe(1);
  });
});

describe('aportaciones', () => {
  const approved = (q: Question, by: string, at = NOW - HOUR): SystemEvent => ({ t: 'question-approved', q: q.id, by, at: Math.floor(at / SEC) });

  it('una pregunta aprobada da puntos a su autora, con tope diario', () => {
    const questions = Array.from({ length: 8 }, () => other());
    const output = run({ questions, system: questions.map((q) => approved(q, 'autora')) });
    expect(profileOf(output, 'autora')?.stats.questionsApproved).toBe(8);
    expect(pointsOf(output, 'autora')).toBe(RULES.approvedPerDay * RULES.questionApproved);
  });

  it('un evento repetido no cuenta dos veces', () => {
    const q = other();
    expect(pointsOf(run({ questions: [q], system: [approved(q, 'autora'), approved(q, 'autora')] }), 'autora')).toBe(RULES.questionApproved);
  });

  it('una pregunta retirada deja de sumar', () => {
    const q = other();
    expect(pointsOf(run({ questions: [q], excludedQuestions: new Set([q.id]), system: [approved(q, 'autora')] }), 'autora')).toBe(0);
  });

  it('el uso por otras personas da un bonus por persona distinta, con tope', () => {
    const q = other();
    const users = Array.from({ length: 40 }, (_, i) => user(`u${i}`, 100 + i));
    const answers = new Map(users.map((u) => [u.login, [answer(q), answer(q, { at: NOW - 2 * HOUR })]]));
    const output = run({ users: [...users, user('autora', 50)], questions: [q], answers });
    const profile = profileOf(output, 'autora');
    expect(profile?.stats.questionUses).toBe(40);
    expect(profile?.stats.points).toBe(RULES.usedPerQuestion * RULES.questionUsed);
  });

  it('responder tu propia pregunta no cuenta como uso', () => {
    const q = other();
    const output = run({ questions: [q], answers: new Map([['autora', [answer(q)]]]) });
    expect(profileOf(output, 'autora')?.stats.questionUses).toBe(0);
  });
});

describe('clasificaciones', () => {
  it('ordena por puntos y desempata por nombre', () => {
    const q1 = other(5);
    const q2 = other(1);
    const output = run({
      users: [user('ana'), user('bea'), user('carlos')],
      questions: [q1, q2],
      answers: new Map([
        ['carlos', [answer(q2)]],
        ['bea', [answer(q1)]],
        ['ana', [answer(q1)]],
      ]),
    });
    const global = output.leaderboards.find((b) => b.id === 'global');
    expect(global?.entries.map((e) => [e.rank, e.login, e.value])).toEqual([
      [1, 'ana', 12],
      [2, 'bea', 12],
      [3, 'carlos', 2],
    ]);
  });

  it('el periodo lo decide la hora de recepción, no la que declara el cliente', () => {
    const q = other();
    // Estudiado hace 10 días, pero recibido esta semana: cuenta para esta semana.
    const late = answer(q, { at: NOW - 10 * DAY, rcv: NOW - HOUR });
    const output = run({ questions: [q], answers: new Map([['ana', [late]]]) });
    expect(output.leaderboards.find((b) => b.id === 'week')?.entries[0]?.login).toBe('ana');
    // Recibido hace 10 días: ya no cuenta para esta semana, pero sí para el total.
    const old = answer(q, { at: NOW - 10 * DAY, rcv: NOW - 10 * DAY + HOUR });
    const previous = run({ questions: [q], answers: new Map([['ana', [old]]]) });
    expect(previous.leaderboards.find((b) => b.id === 'week')?.entries).toEqual([]);
    expect(previous.leaderboards.find((b) => b.id === 'global')?.entries.map((e) => e.login)).toContain('ana');
  });

  it('el ranking de rendimiento exige un mínimo y premia la evidencia', () => {
    const many = Array.from({ length: 100 }, () => other());
    const few = many.slice(0, 29);
    const output = run({
      users: [user('constante'), user('suerte')],
      questions: many,
      answers: new Map([
        ['constante', many.map((q, i) => answer(q, { sel: i < 95 ? ['a'] : ['b'], at: NOW - HOUR + i * SEC }))],
        ['suerte', few.map((q, i) => answer(q, { at: NOW - HOUR + i * SEC }))],
      ]),
    });
    expect(output.leaderboards.find((b) => b.id === 'performance')?.entries.map((e) => e.login)).toEqual(['constante']);
  });

  it('hay ranking por asignatura', () => {
    const q = other();
    const output = run({ questions: [q], answers: new Map([['ana', [answer(q)]]]) });
    expect(output.leaderboards.find((b) => b.id === `subject:${q.subjectId}`)?.entries[0]?.login).toBe('ana');
  });

  it('cada perfil conoce su posición', () => {
    const q = other();
    const output = run({ questions: [q], answers: new Map([['ana', [answer(q)]]]) });
    expect(profileOf(output, 'ana')?.ranks.global).toBe(1);
  });

  it('el resultado es determinista: no depende del orden de entrada', () => {
    const questions = Array.from({ length: 10 }, () => other());
    const a = questions.map((q, i) => answer(q, { at: NOW - HOUR + i * SEC }));
    const b = questions.map((q, i) => answer(q, { at: NOW - HOUR + i * SEC, sel: i % 2 ? ['a'] : ['b'] }));
    const first = run({ users: [user('ana'), user('bea')], questions, answers: new Map([['ana', a], ['bea', b]]) });
    const second = run({ users: [user('bea'), user('ana')], questions: [...questions].reverse(), answers: new Map([['bea', [...b].reverse()], ['ana', [...a].reverse()]]) });
    const key = (o: typeof first) => JSON.stringify([o.leaderboards.find((x) => x.id === 'global'), [...o.profiles].sort((x, y) => x.login.localeCompare(y.login)).map((p) => p.stats)]);
    expect(key(first)).toBe(key(second));
  });
});

describe('logros y nivel', () => {
  it('los logros se deducen de los datos', () => {
    const q = other();
    const output = run({ questions: [q], answers: new Map([['ana', [answer(q)]]]) });
    expect(profileOf(output, 'ana')?.achievements).toContain('first-answer');
    expect(profileOf(output, 'ana')?.achievements).not.toContain('answers-100');
  });

  it('los premios de competición cuentan', () => {
    const award: CompetitionAward = { login: 'ana', competitionId: 'c-1', title: 'Duelo', points: 25, at: NOW - HOUR, rank: 1, won: true, tournamentWon: false, participation: true };
    const output = run({ awards: [award] });
    const profile = profileOf(output, 'ana');
    expect(profile?.stats.points).toBe(25);
    expect(profile?.stats.competitions).toBe(1);
    expect(profile?.stats.competitionWins).toBe(1);
    expect(profile?.achievements).toEqual(expect.arrayContaining(['competitor', 'winner']));
    expect(output.leaderboards.find((b) => b.id === 'competitions')?.entries[0]).toMatchObject({ login: 'ana', value: 25, detail: 1 });
  });

  it('el nivel crece con la raíz de los puntos', () => {
    expect(levelFromPoints(0)).toBe(1);
    expect(levelFromPoints(24)).toBe(1);
    expect(levelFromPoints(25)).toBe(2);
    expect(levelFromPoints(100)).toBe(3);
    expect(levelFromPoints(10000)).toBe(21);
    expect(pointsForLevel(levelFromPoints(400))).toBe(400);
  });

  it('Wilson prefiere la evidencia al porcentaje', () => {
    expect(wilsonLowerBound(950, 1000)).toBeGreaterThan(wilsonLowerBound(10, 10));
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(0, 10)).toBeCloseTo(0, 5);
  });

  it('un perfil sin actividad existe y está a cero', () => {
    const output = run({});
    expect(profileOf(output, 'ana')?.stats).toMatchObject({ points: 0, level: 1, accuracy: null });
  });

  it('el historial de actividad mezcla estudio, aportaciones y competiciones', () => {
    const q = other();
    const award: CompetitionAward = { login: 'ana', competitionId: 'c-1', title: 'Duelo', points: 10, at: NOW - 3 * HOUR, rank: 1, won: false, tournamentWon: false, participation: true };
    const output = run({ questions: [q], awards: [award], answers: new Map([['ana', [answer(q)]]]), system: [{ t: 'question-approved', q: q.id, by: 'ana', at: Math.floor((NOW - 2 * DAY) / SEC) }] });
    const kinds = output.details.find((d) => d.login === 'ana')?.activity.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['study', 'question', 'competition']));
  });
});
