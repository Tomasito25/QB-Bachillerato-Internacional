import { describe, expect, it } from 'vitest';
import type { SubjectDoc } from '@core/schema/taxonomy';
import { computeSyllabusProgress, nodeScore, weakestTopics } from '@/features/study/syllabusProgress';
import type { AttemptRow, ProgressRow } from '@/infra/db/types';
import { uuid } from '../fixtures';

const NOW = Date.UTC(2026, 10, 8, 12);
const SUBJECT = uuid(901);
const [U1, U2, T1, T2, T3, EMPTY] = [uuid(902), uuid(903), uuid(904), uuid(905), uuid(906), uuid(907)];

const subject: SubjectDoc = {
  schemaVersion: 1,
  id: SUBJECT,
  name: 'Física',
  rev: 1,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  units: [
    { id: U1 as string, name: 'A', order: 0, topics: [{ id: T1 as string, name: 'Uno', order: 0 }, { id: T2 as string, name: 'Dos', order: 1 }] },
    { id: U2 as string, name: 'B', order: 1, topics: [{ id: T3 as string, name: 'Tres', order: 0 }, { id: EMPTY as string, name: 'Sin preguntas', order: 1 }] },
  ],
};

let counter = 0;
const attempt = (questionId: string, correct: boolean | null, score = correct ? 1 : 0): AttemptRow => ({ id: `a${++counter}`, questionId, questionRev: 1, sessionId: null, mode: 'practice', selected: null, selfGrade: null, correct, score, durationMs: 1000, at: NOW - counter, subjectId: SUBJECT, difficulty: 3, published: 0 });
const state = (questionId: string, overrides: Partial<ProgressRow> = {}): ProgressRow => ({ questionId, card: { stability: 1, difficulty: 5, reps: 1, lapses: 0, due: NOW + 1000, last: NOW } as unknown as ProgressRow['card'], due: NOW + 1000, attempts: 1, correct: 1, lastCorrect: true, lastAt: NOW, favorite: 0, hard: 0, ...overrides });

const q = (id: string, ...topicIds: (string | undefined)[]) => ({ id, subjectId: SUBJECT, topicIds: topicIds as string[] });

describe('progreso por temario', () => {
  it('una pregunta en dos temas cuenta en los dos, pero una vez en la unidad y la asignatura', () => {
    const [tree] = computeSyllabusProgress([subject], [q('q1', T1, T2)], [attempt('q1', true)], [state('q1')], NOW);
    expect(tree).toMatchObject({ total: 1, seen: 1, answers: 1 });
    expect(tree?.units[0]).toMatchObject({ total: 1, answers: 1 });
    expect(tree?.units[0]?.topics.map((t) => t.total)).toEqual([1, 1]);
  });

  it('no muestra unidades ni temas sin preguntas', () => {
    const [tree] = computeSyllabusProgress([subject], [q('q1', T3)], [], [], NOW);
    expect(tree?.units.map((u) => u.name)).toEqual(['B']);
    expect(tree?.units[0]?.topics.map((t) => t.name)).toEqual(['Tres']);
    expect(computeSyllabusProgress([subject], [], [], [], NOW)).toEqual([]);
  });

  it('junta aciertos de test y nota de desarrollo, y distingue visto, pendiente y sin ver', () => {
    const questions = [q('q1', T1), q('q2', T1), q('q3', T1)];
    const attempts = [attempt('q1', true), attempt('q1', false), attempt('q2', null, 0.5)];
    const progress = [state('q1', { due: NOW - 1 }), state('q2')];
    const [tree] = computeSyllabusProgress([subject], questions, attempts, progress, NOW);
    const topic = tree?.units[0]?.topics[0];
    expect(topic).toMatchObject({ total: 3, seen: 2, due: 1, answers: 3, mcq: 2, correct: 1, open: 1, openScore: 0.5 });
    expect(nodeScore(topic as NonNullable<typeof topic>)).toBe(0.5);
  });

  it('los temas a reforzar: los peores, con respuestas suficientes y por debajo del 80 %', () => {
    const questions = [q('bad', T1), q('good', T2), q('few', T3)];
    const attempts = [attempt('bad', false), attempt('bad', false), attempt('bad', true), attempt('good', true), attempt('good', true), attempt('good', true), attempt('few', false)];
    const tree = computeSyllabusProgress([subject], questions, attempts, [], NOW);
    const weak = weakestTopics(tree);
    expect(weak.map((t) => t.name)).toEqual(['Uno']);
    expect(weak[0]?.path).toBe('Física › A');
    expect(weak[0]?.score).toBeCloseTo(1 / 3);
  });
});
