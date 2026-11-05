import type { Submission, SubmissionKind } from '../schema/submission.ts';
import { base64UrlToBytes, bytesToBase64Url, gunzip, gzip } from '../util/encoding.ts';

/**
 * Sobre de un envío: cómo viaja una propuesta dentro de un issue.
 *
 *     [QB:results] 42 respuestas · x7f3k2a1
 *     <resumen legible para quien vea el issue>
 *     ```qb1
 *     <JSON → gzip → base64url>
 *     ```
 *
 * Va comprimido porque la URL prellenada tiene un límite estricto. El resumen no se usa para
 * nada: es para que quien pulse «Create» sepa qué está enviando.
 */

/** Medido contra GitHub: 6 500 funciona, 7 000 da error 500. Se deja margen. */
export const MAX_ISSUE_URL_LENGTH = 6000;
/** Límite del cuerpo de un issue en la API de GitHub, con margen para el resumen. */
export const MAX_ISSUE_BODY_LENGTH = 65000;

const TITLE_PATTERN = /^\[QB:([a-z-]+)\]/;
const PAYLOAD_PATTERN = /```qb1\s*\n?([A-Za-z0-9_-]+)\s*\n?```/;

export function isSubmissionTitle(title: string): boolean {
  return TITLE_PATTERN.test(title);
}

export function kindFromTitle(title: string): SubmissionKind | null {
  return (TITLE_PATTERN.exec(title)?.[1] as SubmissionKind | undefined) ?? null;
}

export async function encodePayload(submission: Submission): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(submission));
  return bytesToBase64Url(await gzip(json));
}

export interface EncodedSubmission {
  title: string;
  body: string;
}

export async function encodeSubmission(submission: Submission, summary: string): Promise<EncodedSubmission> {
  const payload = await encodePayload(submission);
  const safeSummary = summary.replace(/`/g, "'").slice(0, 500);
  return {
    title: `[QB:${submission.kind}] ${titleFor(submission)} · ${submission.nonce}`,
    body: `${safeSummary}\n\n<!-- Lo procesa una Action. No edites este bloque. -->\n\`\`\`qb1\n${payload}\n\`\`\``,
  };
}

function titleFor(submission: Submission): string {
  switch (submission.kind) {
    case 'connect':
      return 'Conectar cuenta';
    case 'profile':
      return 'Actualizar perfil';
    case 'questions':
      return `${submission.questions.length} ${submission.questions.length === 1 ? 'pregunta' : 'preguntas'}`;
    case 'results':
      return `${submission.answers.length} respuestas`;
    case 'competition-create':
      return submission.title.slice(0, 60).replace(/[\r\n]+/g, ' ');
    case 'competition-join':
      return `Inscripción en ${submission.competitionId}`;
    case 'competition-entry':
      return `Entrega en ${submission.competitionId}`;
    case 'report':
      return `Reporte de ${submission.questionId.slice(0, 8)}`;
    case 'retire':
      return `Retirar ${submission.questionId.slice(0, 8)}`;
  }
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

/** Extrae el JSON del cuerpo. Devuelve `unknown`: quien llama debe validarlo. */
export async function decodeIssueBody(body: string | null | undefined): Promise<unknown> {
  const match = PAYLOAD_PATTERN.exec(body ?? '');
  if (!match?.[1]) throw new EnvelopeError('No se encuentra el bloque de datos en el issue');
  let text: string;
  try {
    text = new TextDecoder().decode(await gunzip(base64UrlToBytes(match[1])));
  } catch (error) {
    throw new EnvelopeError(`El bloque de datos no se puede leer: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EnvelopeError('El bloque de datos no es JSON válido');
  }
}

export function buildIssueUrl(repo: string, encoded: EncodedSubmission): string {
  const params = new URLSearchParams({ title: encoded.title, body: encoded.body });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

export type IssueTransport =
  /** Cabe en la URL: la app abre GitHub con todo escrito. */
  | { mode: 'url'; url: string }
  /** No cabe: se copia al portapapeles y el usuario lo pega. */
  | { mode: 'clipboard'; url: string; body: string }
  /** Ni pegándolo: hay que partir el envío. */
  | { mode: 'too-large'; bodyLength: number };

export function chooseIssueTransport(repo: string, encoded: EncodedSubmission): IssueTransport {
  const url = buildIssueUrl(repo, encoded);
  if (url.length <= MAX_ISSUE_URL_LENGTH) return { mode: 'url', url };
  if (encoded.body.length > MAX_ISSUE_BODY_LENGTH) return { mode: 'too-large', bodyLength: encoded.body.length };
  return {
    mode: 'clipboard',
    url: buildIssueUrl(repo, { title: encoded.title, body: '' }),
    body: encoded.body,
  };
}
