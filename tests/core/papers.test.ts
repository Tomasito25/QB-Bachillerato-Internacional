import { describe, expect, it } from 'vitest';
import { assemblePaper, questionMarks } from '@core/exams/assemble';
import { detectFormat, EXAM_FORMATS, findPaper, paperMarks } from '@core/exams/papers';
import { seededRandom } from '@core/util/rng';
import { makeMcq, makeOpen, uuid } from '../fixtures';

const physicsSl1 = () => findPaper('physics-sl-1')?.paper ?? (() => { throw new Error('falta'); })();

describe('formatos de examen', () => {
  it.each([
    ['Fisica SL IB', 'physics-sl'],
    ['Física HL', 'physics-hl'],
    ['Química NM', 'chemistry-sl'],
    ['Biology HL', 'biology-hl'],
    ['MAE SL', 'math-aa-sl'],
    ['MAI SL', 'math-ai-sl'],
    ['Business Management HL', 'business-hl'],
  ])('reconoce %s', (name, id) => {
    expect(detectFormat(name)?.id).toBe(id);
  });

  it('si no sabe el nivel o la asignatura, no adivina', () => {
    expect(detectFormat('Física')).toBeNull();
    expect(detectFormat('Historia SL')).toBeNull();
  });

  it('Física SL: Paper 1 de 90 min con 25 de test y 20 puntos de datos', () => {
    const paper = physicsSl1();
    expect(paper.minutes).toBe(90);
    expect(paper.parts.map((part) => [part.kind, part.count, part.marks])).toEqual([['mcq', 25, 25], ['open', undefined, 20]]);
    expect(paperMarks(paper)).toBe(45);
  });

  it('todos los identificadores son únicos', () => {
    const ids = EXAM_FORMATS.flatMap((format) => format.papers.map((paper) => paper.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('montar un simulacro', () => {
  const open = (marks: number, tags: string[] = [], topic = uuid()) => makeOpen({ id: uuid(), tags, topicIds: [topic], parts: [{ id: 'a', statement: 'x', modelAnswer: 'y', marks }] });

  it('cuenta los puntos de apartados y subapartados', () => {
    expect(questionMarks(makeMcq())).toBe(1);
    expect(questionMarks(open(7))).toBe(7);
    expect(questionMarks(makeOpen({ parts: [{ id: 'a', statement: '', modelAnswer: '', subparts: [{ id: 'i', statement: 'x', modelAnswer: 'y', marks: 2 }, { id: 'ii', statement: 'x', modelAnswer: 'y', marks: 3 }] }] }))).toBe(5);
  });

  it('pone el número justo de preguntas y no se pasa de los puntos', () => {
    const pool = [...Array.from({ length: 40 }, () => makeMcq({ id: uuid() })), ...Array.from({ length: 12 }, () => open(6))];
    const [mcq, data] = assemblePaper(physicsSl1(), pool, seededRandom('x'));
    expect(mcq?.ids).toHaveLength(25);
    expect(data?.got).toBeLessThanOrEqual(20);
    expect(data?.got).toBe(18);
  });

  it('el test va primero y no se repite ninguna pregunta', () => {
    const pool = [...Array.from({ length: 30 }, () => makeMcq({ id: uuid() })), ...Array.from({ length: 6 }, () => open(5))];
    const parts = assemblePaper(physicsSl1(), pool, seededRandom('y'));
    const ids = parts.flatMap((part) => part.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parts[0]?.kind).toBe('mcq');
  });

  it('en la parte de datos prefiere las preguntas etiquetadas así', () => {
    const data = open(10, ['datos']);
    const pool = [data, ...Array.from({ length: 10 }, () => open(10))];
    const [, part] = assemblePaper(physicsSl1(), pool, seededRandom('z'));
    expect(part?.ids).toContain(data.id);
  });

  it('dice cuánto falta si el banco no llega', () => {
    const [mcq] = assemblePaper(physicsSl1(), [makeMcq({ id: uuid() })], seededRandom('w'));
    expect(mcq).toMatchObject({ got: 1, wanted: 25 });
  });
});
