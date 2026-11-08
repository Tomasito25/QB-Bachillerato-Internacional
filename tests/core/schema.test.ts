import { describe, expect, it } from 'vitest';
import { LIMITS, Question } from '@core/schema/question';
import { Login } from '@core/schema/common';
import { FutureSchemaError, migrateDocument } from '@core/schema/migrations';
import { makeMcq, makeOpen, uuid } from '../fixtures';

const errorsOf = (doc: unknown) => {
  const result = Question.safeParse(doc);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('esquema de pregunta', () => {
  it('acepta preguntas válidas de los dos tipos', () => {
    expect(errorsOf(makeMcq())).toEqual([]);
    expect(errorsOf(makeOpen())).toEqual([]);
  });

  it('exige al menos cuatro opciones', () => {
    const q = makeMcq();
    q.answers = q.answers.slice(0, 3);
    expect(errorsOf(q).length).toBeGreaterThan(0);
  });

  it('exige alguna respuesta correcta', () => {
    const q = makeMcq();
    q.answers = q.answers.map((a) => ({ ...a, correct: false }));
    expect(errorsOf(q)).toContain('Marca al menos una respuesta correcta');
  });

  it('con respuesta única no admite dos correctas, con múltiple sí', () => {
    const answers = makeMcq().answers.map((a, i) => ({ ...a, correct: i < 2 }));
    expect(errorsOf(makeMcq({ answers, multiple: false }))).toContain('Con respuesta única sólo puede haber una correcta');
    expect(errorsOf(makeMcq({ answers, multiple: true }))).toEqual([]);
  });

  it('no admite identificadores de opción repetidos', () => {
    const answers = makeMcq().answers.map((a) => ({ ...a, id: 'a' }));
    expect(errorsOf(makeMcq({ answers }))).toContain('Hay identificadores de respuesta repetidos');
  });

  it('rechaza campos desconocidos: no se puede colar nada en un documento', () => {
    expect(errorsOf({ ...makeMcq(), points: 9999 }).length).toBeGreaterThan(0);
  });

  it('rechaza un id que no sea UUID', () => {
    expect(errorsOf(makeMcq({ id: 'no-soy-uuid' })).length).toBeGreaterThan(0);
  });

  it('rechaza una referencia con enlace peligroso', () => {
    const q = makeMcq({ references: [{ title: 'x', url: 'javascript:alert(1)' }] });
    expect(errorsOf(q).length).toBeGreaterThan(0);
    const data = makeMcq({ references: [{ title: 'x', url: 'data:text/html,hola' }] });
    expect(errorsOf(data).length).toBeGreaterThan(0);
  });

  it('acepta una referencia con enlace normal', () => {
    expect(errorsOf(makeMcq({ references: [{ title: 'Gray', url: 'https://example.org/gray' }] }))).toEqual([]);
  });

  it('limita el tamaño del enunciado', () => {
    expect(errorsOf(makeMcq({ statement: 'a'.repeat(LIMITS.statement + 1) })).length).toBeGreaterThan(0);
  });

  it('una pregunta debe pertenecer al menos a un tema', () => {
    expect(errorsOf(makeMcq({ topicIds: [] })).length).toBeGreaterThan(0);
    expect(errorsOf(makeMcq({ topicIds: [uuid(1), uuid(2)] }))).toEqual([]);
  });

  it('el desarrollo admite apartados; sin ellos, sigue exigiendo la respuesta modelo', () => {
    const parts = [
      { id: 'a', statement: 'Calcula la velocidad.', modelAnswer: '$v = 3\\,\\text{m s}^{-1}$', marks: 2 },
      { id: 'b', statement: 'Explica el resultado.', modelAnswer: 'Porque…' },
    ];
    expect(errorsOf(makeOpen({ modelAnswer: '', parts }))).toEqual([]);
    expect(errorsOf(makeOpen({ modelAnswer: '' })).length).toBeGreaterThan(0);
    expect(errorsOf(makeOpen({ parts: [] })).length).toBeGreaterThan(0);
    expect(errorsOf(makeOpen({ parts: [parts[0], { ...parts[1], id: 'a' }] as typeof parts })).length).toBeGreaterThan(0);
    expect(errorsOf(makeOpen({ parts: [{ ...parts[0], marks: 0 }] as typeof parts })).length).toBeGreaterThan(0);
  });

  it('un apartado puede dividirse en subapartados; sin ellos necesita enunciado y solución', () => {
    const sub = { id: 'a', statement: 'Calcula', modelAnswer: '3', marks: 2 };
    expect(errorsOf(makeOpen({ modelAnswer: '', parts: [{ id: 'a', statement: '', modelAnswer: '', subparts: [sub] }] }))).toEqual([]);
    expect(errorsOf(makeOpen({ modelAnswer: '', parts: [{ id: 'a', statement: '', modelAnswer: '' }] })).length).toBeGreaterThan(0);
    expect(errorsOf(makeOpen({ modelAnswer: '', parts: [{ id: 'a', statement: 'Texto', modelAnswer: '', marks: 1, subparts: [sub] }] }))).toContain('Con subapartados, los puntos van en cada uno');
    expect(errorsOf(makeOpen({ modelAnswer: '', parts: [{ id: 'a', statement: '', modelAnswer: '', subparts: [sub, sub] }] }))).toContain('Hay subapartados repetidos');
    expect(errorsOf(makeOpen({ modelAnswer: '', parts: [{ id: 'a', statement: '', modelAnswer: '', subparts: [] }] })).length).toBeGreaterThan(0);
  });
});

describe('login', () => {
  it('acepta minúsculas y guiones, rechaza lo demás', () => {
    expect(Login.safeParse('ana-garcia').success).toBe(true);
    expect(Login.safeParse('Ana').success).toBe(false);
    expect(Login.safeParse('../etc/passwd').success).toBe(false);
    expect(Login.safeParse('a/b').success).toBe(false);
    expect(Login.safeParse('-ana').success).toBe(false);
  });
});

describe('migraciones', () => {
  it('deja intacto un documento de la versión actual', () => {
    const doc = makeMcq();
    expect(migrateDocument(doc)).toBe(doc);
  });

  it('rechaza documentos de una versión futura', () => {
    expect(() => migrateDocument({ ...makeMcq(), schemaVersion: 99 })).toThrow(FutureSchemaError);
  });
});
