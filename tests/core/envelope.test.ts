import { describe, expect, it } from 'vitest';
import type { AnswerEvent } from '@core/schema/events';
import { Submission } from '@core/schema/submission';
import {
  buildIssueUrl,
  chooseIssueTransport,
  decodeIssueBody,
  encodeSubmission,
  EnvelopeError,
  isSubmissionTitle,
  kindFromTitle,
  MAX_ISSUE_URL_LENGTH,
} from '@core/submissions/envelope';
import { uuid } from '../fixtures';

const REPO = 'owner/questionbank';
const NONCE = 'abcd1234efgh';

function answers(count: number): AnswerEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `attempt${String(i).padStart(4, '0')}`,
    q: crypto.randomUUID(),
    sel: ['a'],
    ms: 5000 + i,
    at: 1793880000 + i * 30,
    m: 'practice' as const,
  }));
}

describe('sobre del envío', () => {
  it('ida y vuelta de un envío válido', async () => {
    const submission: Submission = { v: 1, kind: 'results', nonce: NONCE, answers: answers(3) };
    const encoded = await encodeSubmission(submission, 'Tres respuestas');
    expect(encoded.title).toContain('[QB:results]');
    expect(encoded.title).toContain(NONCE);
    expect(encoded.body).toContain('Tres respuestas');
    const decoded = await decodeIssueBody(encoded.body);
    expect(Submission.parse(decoded)).toEqual(submission);
  });

  it('reconoce el tipo por el título', () => {
    expect(isSubmissionTitle('[QB:connect] Conectar cuenta · x')).toBe(true);
    expect(isSubmissionTitle('Un issue normal')).toBe(false);
    expect(kindFromTitle('[QB:results] 3 respuestas')).toBe('results');
    expect(kindFromTitle('Otro')).toBeNull();
  });

  it('el resumen no puede romper el bloque de datos', async () => {
    const submission: Submission = { v: 1, kind: 'connect', nonce: NONCE };
    const encoded = await encodeSubmission(submission, 'malicioso ``` qb1\nZm9v\n```');
    expect(await decodeIssueBody(encoded.body)).toEqual(submission);
  });

  it('rechaza cuerpos sin datos o corruptos', async () => {
    await expect(decodeIssueBody('hola')).rejects.toBeInstanceOf(EnvelopeError);
    await expect(decodeIssueBody(null)).rejects.toBeInstanceOf(EnvelopeError);
    await expect(decodeIssueBody('```qb1\nnoesgzip\n```')).rejects.toBeInstanceOf(EnvelopeError);
  });

  it('un JSON con forma incorrecta se detecta al validar', () => {
    expect(Submission.safeParse({ v: 1, kind: 'results', nonce: NONCE, answers: [] }).success).toBe(false);
    expect(Submission.safeParse({ v: 1, kind: 'inventado', nonce: NONCE }).success).toBe(false);
    expect(Submission.safeParse({ v: 2, kind: 'connect', nonce: NONCE }).success).toBe(false);
  });

  it('un envío nunca puede declarar su autor ni sus puntos', () => {
    const forged = { v: 1, kind: 'connect', nonce: NONCE, author: 'otro' };
    expect(Submission.safeParse(forged).success).toBe(false);
    const points = { v: 1, kind: 'results', nonce: NONCE, answers: [{ ...answers(1)[0], points: 100 }] };
    expect(Submission.safeParse(points).success).toBe(false);
    const correct = { v: 1, kind: 'results', nonce: NONCE, answers: [{ ...answers(1)[0], correct: true }] };
    expect(Submission.safeParse(correct).success).toBe(false);
  });
});

describe('elección de transporte', () => {
  it('lo pequeño viaja en la URL, dentro del presupuesto medido contra GitHub', async () => {
    const encoded = await encodeSubmission({ v: 1, kind: 'connect', nonce: NONCE }, 'Conectar');
    const transport = chooseIssueTransport(REPO, encoded);
    expect(transport.mode).toBe('url');
    if (transport.mode === 'url') {
      expect(transport.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
      expect(transport.url.startsWith(`https://github.com/${REPO}/issues/new?`)).toBe(true);
    }
  });

  it('una sesión de estudio típica cabe en la URL', async () => {
    const encoded = await encodeSubmission({ v: 1, kind: 'results', nonce: NONCE, answers: answers(60) }, 'Sesión');
    expect(chooseIssueTransport(REPO, encoded).mode).toBe('url');
  });

  it('lo mediano pasa al portapapeles, con la URL sin cuerpo', async () => {
    const encoded = await encodeSubmission({ v: 1, kind: 'results', nonce: NONCE, answers: answers(500) }, 'Mucho');
    const transport = chooseIssueTransport(REPO, encoded);
    expect(transport.mode).toBe('clipboard');
    if (transport.mode === 'clipboard') {
      expect(transport.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
      expect(await decodeIssueBody(transport.body)).toBeTruthy();
    }
  });

  it('lo enorme se señala para partirlo', async () => {
    const encoded = await encodeSubmission({ v: 1, kind: 'results', nonce: NONCE, answers: answers(2000) }, 'Enorme');
    expect(chooseIssueTransport(REPO, encoded).mode).toBe('too-large');
  });

  it('la URL escapa bien título y cuerpo', () => {
    const url = buildIssueUrl(REPO, { title: 'a&b=c', body: 'x y\n#z' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('title')).toBe('a&b=c');
    expect(parsed.searchParams.get('body')).toBe('x y\n#z');
  });

  it('acepta reportes con id de pregunta válido', () => {
    const report = { v: 1, kind: 'report', nonce: NONCE, questionId: uuid(5), reason: 'copyright', detail: 'Copiado de un examen' };
    expect(Submission.safeParse(report).success).toBe(true);
  });
});
