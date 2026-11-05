import type { McqQuestion, OpenQuestion } from '@core/schema/question';
import type { SubjectDoc } from '@core/schema/taxonomy';

let counter = 0;

/** UUID v4 válido y determinista, para que los fallos se puedan reproducir. */
export function uuid(n?: number): string {
  const value = (n ?? ++counter).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${value}`;
}

export const SUBJECT_ID = uuid(9001);
export const UNIT_ID = uuid(9002);
export const TOPIC_ID = uuid(9003);
export const AT = '2026-11-01T10:00:00.000Z';

export function makeMcq(overrides: Partial<McqQuestion> = {}): McqQuestion {
  return {
    schemaVersion: 1,
    id: uuid(),
    rev: 1,
    type: 'mcq',
    statement: '¿Cuál es el hueso más largo del cuerpo humano adulto?',
    explanation: 'El fémur es el hueso más largo y resistente.',
    images: [],
    difficulty: 2,
    subjectId: SUBJECT_ID,
    topicIds: [TOPIC_ID],
    tags: [],
    references: [],
    author: { login: 'ana', id: 1 },
    createdAt: AT,
    updatedAt: AT,
    license: 'CC-BY-SA-4.0',
    answers: [
      { id: 'a', text: 'Fémur', correct: true },
      { id: 'b', text: 'Tibia', correct: false },
      { id: 'c', text: 'Húmero', correct: false },
      { id: 'd', text: 'Peroné', correct: false },
    ],
    multiple: false,
    reveal: { explanationAfterAnswer: true, solutionsAtExamEnd: true },
    ...overrides,
  };
}

export function makeOpen(overrides: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    schemaVersion: 1,
    id: uuid(),
    rev: 1,
    type: 'open',
    statement: 'Describe las fases del ciclo cardíaco.',
    images: [],
    difficulty: 3,
    subjectId: SUBJECT_ID,
    topicIds: [TOPIC_ID],
    tags: [],
    references: [],
    author: { login: 'ana', id: 1 },
    createdAt: AT,
    updatedAt: AT,
    license: 'CC-BY-SA-4.0',
    modelAnswer: 'Sístole auricular, sístole ventricular y diástole.',
    criteria: [
      { id: 'c1', text: 'Nombra las tres fases', weight: 2 },
      { id: 'c2', text: 'Las ordena correctamente', weight: 1 },
    ],
    keywords: ['sístole', 'diástole'],
    ...overrides,
  };
}

export function makeSubject(overrides: Partial<SubjectDoc> = {}): SubjectDoc {
  return {
    schemaVersion: 1,
    id: SUBJECT_ID,
    name: 'Anatomía',
    rev: 1,
    createdBy: { login: 'ana', id: 1 },
    createdAt: AT,
    updatedAt: AT,
    units: [
      {
        id: UNIT_ID,
        name: 'Sistema locomotor',
        order: 0,
        topics: [{ id: TOPIC_ID, name: 'Huesos', order: 0 }],
      },
    ],
    ...overrides,
  };
}
