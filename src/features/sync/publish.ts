import { MAX_ANSWERS_PER_SUBMISSION, MAX_QUESTIONS_PER_SUBMISSION, type Submission } from '@core/schema/submission';
import type { AnswerEvent } from '@core/schema/events';
import type { UserRef } from '@core/schema/common';
import type { Question, QuestionImage } from '@core/schema/question';
import type { SubjectDoc } from '@core/schema/taxonomy';
import { MAX_ISSUE_BODY_LENGTH } from '@core/submissions/envelope';
import { mergeSubject } from '@core/taxonomy/merge';
import { bytesToBase64 } from '@core/util/encoding';
import { toIso } from '@core/util/time';
import { identity, newNonce } from '@/features/account/identity';
import { toQuestion } from '@/features/bank/questionsRepo';
import { getToken } from '@/infra/crypto/tokenVault';
import { db } from '@/infra/db/db';
import type { LocalQuestionRow, OutboxRow } from '@/infra/db/types';
import { openContributionPull, type PullFileWrite } from '@/infra/github/client';
import { processImage, saveLocalImage } from '@/infra/images/process';
import { enqueue, markSent } from './outbox';
import { logSync } from './log';
import { alignLocalTaxonomy } from './reconcile';

/** Marca que busca la revisión de un PR. Se mantiene igual en `tools/actions/review-pr.ts`. */
const LICENSE_MARKER = '<!-- qb:license-accepted -->';

export type ContentOrigin = 'own' | 'open-licensed' | 'public-domain';

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

/** Imágenes por issue: el cuerpo admite 65 000 caracteres y lleva JSON, gzip y base64url. */
const INLINE_BUDGET_BYTES = 38 * 1024;
const INLINE_ATTEMPTS = [
  { maxDimension: 1024, maxBytes: 34 * 1024 },
  { maxDimension: 768, maxBytes: 24 * 1024 },
  { maxDimension: 512, maxBytes: 14 * 1024 },
];

function replaceImageRefs(text: string | undefined, from: string, to: string): string | undefined {
  return text?.replaceAll(`qbimg:${from}`, `qbimg:${to}`);
}

function swapImage(question: Question, from: QuestionImage, to: QuestionImage): Question {
  const images = question.images.map((i) => (i.hash === from.hash ? to : i));
  const common = { ...question, images, statement: replaceImageRefs(question.statement, from.hash, to.hash) as string, explanation: replaceImageRefs(question.explanation, from.hash, to.hash) };
  if (question.type === 'mcq') {
    return { ...common, type: 'mcq', answers: question.answers.map((a) => ({ ...a, text: replaceImageRefs(a.text, from.hash, to.hash) as string })) } as Question;
  }
  return { ...common, type: 'open', modelAnswer: replaceImageRefs(question.modelAnswer, from.hash, to.hash) as string } as Question;
}

interface Prepared {
  questions: Question[];
  subjects: SubjectDoc[];
  rows: LocalQuestionRow[];
}

/** Reúne lo que hay que publicar: las preguntas y la parte local del temario que usan. */
async function prepare(questionIds: readonly string[]): Promise<Prepared> {
  // Si el temario ya existe en la comunidad con otro id, se adoptan sus identificadores.
  await alignLocalTaxonomy();
  const rows = (await db.lQuestions.bulkGet([...questionIds])).filter((row): row is LocalQuestionRow => Boolean(row));
  if (rows.length === 0) throw new PublishError('No hay preguntas que publicar.');
  const community = await db.cSubjects.toArray();
  const overlays = await db.lSubjects.toArray();
  const used = new Set(rows.map((row) => row.subjectId));
  const allTopics = new Set(rows.flatMap((row) => row.topicIds));
  for (const overlay of overlays) {
    if (overlay.units.some((u) => u.topics.some((t) => allTopics.has(t.id)))) used.add(overlay.id);
  }

  const subjects: SubjectDoc[] = [];
  const now = toIso(Date.now());
  for (const overlay of overlays) {
    if (!used.has(overlay.id)) continue;
    const { local: _local, ...doc } = overlay;
    const base = community.find((s) => s.id === doc.id);
    subjects.push(base ? mergeSubject(base, doc, now).doc : doc);
  }
  return { questions: rows.map((row) => toQuestion(row)), subjects, rows };
}

async function communityImageHashes(): Promise<Set<string>> {
  const hashes = new Set<string>();
  await db.cQuestions.each((q) => {
    for (const image of q.images) hashes.add(image.hash);
  });
  return hashes;
}

/** Sin token, las imágenes viajan dentro del issue: si no caben, se reducen más. */
async function fitImagesForIssue(prepared: Prepared): Promise<{ questions: Question[]; images: { hash: string; ext: QuestionImage['ext']; base64: string }[] }> {
  const known = await communityImageHashes();
  let questions = prepared.questions;
  const pending = () => {
    const seen = new Map<string, QuestionImage>();
    for (const image of questions.flatMap((q) => q.images)) if (!known.has(image.hash)) seen.set(image.hash, image);
    return [...seen.values()];
  };
  const total = () => pending().reduce((sum, image) => sum + image.bytes, 0);

  for (const options of INLINE_ATTEMPTS) {
    if (total() <= INLINE_BUDGET_BYTES) break;
    for (const image of pending()) {
      if (image.bytes <= options.maxBytes) continue;
      const stored = await db.localImages.get(image.hash);
      if (!stored) continue;
      const smaller = await saveLocalImage(await processImage(stored.blob, options), image.alt);
      const replacement: QuestionImage = { hash: smaller.hash, ext: smaller.ext, width: smaller.width, height: smaller.height, bytes: smaller.bytes, alt: image.alt };
      questions = questions.map((q) => (q.images.some((i) => i.hash === image.hash) ? swapImage(q, image, replacement) : q));
    }
  }
  if (total() > INLINE_BUDGET_BYTES) {
    throw new PublishError('Las imágenes no caben en un issue ni reducidas. Publica menos de golpe, quita alguna imagen o conecta un token.');
  }
  const images = [];
  for (const image of pending()) {
    const stored = await db.localImages.get(image.hash);
    if (!stored) throw new PublishError('Falta una imagen en este dispositivo. Vuelve a subirla editando la pregunta.');
    images.push({ hash: image.hash, ext: image.ext, base64: bytesToBase64(new Uint8Array(await stored.blob.arrayBuffer())) });
  }
  return { questions, images };
}

function summaryFor(count: number): string {
  return `Publico ${count} ${count === 1 ? 'pregunta' : 'preguntas'} en el banco comunitario.`;
}

async function saveRewritten(prepared: Prepared, questions: readonly Question[]): Promise<void> {
  const byId = new Map(prepared.rows.map((row) => [row.id, row]));
  await db.lQuestions.bulkPut(questions.map((q) => ({ ...q, local: (byId.get(q.id) as LocalQuestionRow).local }) as LocalQuestionRow));
}

/** Parte en lotes hasta que cada uno cabe en un issue. */
async function buildIssueSubmissions(questions: readonly Question[], subjects: readonly SubjectDoc[], images: Extract<Submission, { kind: 'questions' }>['images'], origin: ContentOrigin): Promise<Extract<Submission, { kind: 'questions' }>[]> {
  const build = (batch: readonly Question[], batchSubjects: readonly SubjectDoc[]): Extract<Submission, { kind: 'questions' }> => {
    const hashes = new Set(batch.flatMap((q) => q.images.map((i) => i.hash)));
    return { v: 1, kind: 'questions', nonce: newNonce(), questions: [...batch], subjects: [...batchSubjects], images: images.filter((i) => hashes.has(i.hash)), licenseAccepted: true, origin };
  };
  const out: Extract<Submission, { kind: 'questions' }>[] = [];
  const queue: { batch: readonly Question[]; subjects: readonly SubjectDoc[] }[] = [];
  for (let i = 0; i < questions.length; i += MAX_QUESTIONS_PER_SUBMISSION) {
    queue.push({ batch: questions.slice(i, i + MAX_QUESTIONS_PER_SUBMISSION), subjects: i === 0 ? subjects : [] });
  }
  while (queue.length > 0) {
    const item = queue.shift() as (typeof queue)[number];
    const submission = build(item.batch, item.subjects);
    const size = JSON.stringify(submission).length;
    // Estimación prudente antes de comprimir: si es muy grande, se parte directamente.
    if (size > MAX_ISSUE_BODY_LENGTH * 3 && item.batch.length > 1) {
      const middle = Math.ceil(item.batch.length / 2);
      queue.unshift({ batch: item.batch.slice(0, middle), subjects: item.subjects }, { batch: item.batch.slice(middle), subjects: [] });
      continue;
    }
    out.push(submission);
  }
  return out;
}

/** Vía sin token: encola para que el usuario lo confirme en GitHub. */
export async function publishViaIssue(questionIds: readonly string[], origin: ContentOrigin): Promise<OutboxRow[]> {
  const prepared = await prepare(questionIds);
  const fitted = await fitImagesForIssue(prepared);
  await saveRewritten(prepared, fitted.questions);
  const submissions = await buildIssueSubmissions(fitted.questions, prepared.subjects, fitted.images, origin);
  const rows: OutboxRow[] = [];
  for (const submission of submissions) {
    const ids = (submission.questions as Question[]).map((q) => q.id);
    const row = await enqueue(submission, summaryFor(ids.length), { questions: ids, subjects: submission.subjects.map((s) => (s as SubjectDoc).id) });
    await db.lQuestions.where('id').anyOf(ids).modify((q) => {
      q.local = { ...q.local, syncState: 'queued', outboxId: row.id, note: null };
    });
    rows.push(row);
  }
  return rows;
}

const utf8 = (value: unknown): PullFileWrite['content'] => `${JSON.stringify(value, null, 2)}\n`;

/** Vía con token: fork, commit y PR, sin clics y sin límite práctico de imágenes. */
export async function publishViaPull(questionIds: readonly string[], origin: ContentOrigin): Promise<OutboxRow> {
  const token = await getToken();
  const user = identity.get();
  if (!token || !user) throw new PublishError('Hace falta conectar un token para publicar así.');
  const prepared = await prepare(questionIds);
  const author: UserRef = { login: user.login, id: user.id };
  const now = toIso(Date.now());
  const communitySubjects = new Map((await db.cSubjects.toArray()).map((s) => [s.id, s]));
  const files: PullFileWrite[] = [];

  for (const subject of prepared.subjects) {
    const doc = communitySubjects.has(subject.id) ? subject : { ...subject, createdBy: author, updatedAt: now };
    files.push({ path: `taxonomy/${doc.id}.json`, content: utf8(doc), encoding: 'utf-8' });
  }

  const known = await communityImageHashes();
  const communityQuestions = new Map((await db.cQuestions.bulkGet(prepared.questions.map((q) => q.id))).filter(Boolean).map((q) => [q?.id as string, q]));
  const written = new Set<string>();
  for (const question of prepared.questions) {
    const existing = communityQuestions.get(question.id);
    const doc = { ...question, author: existing?.author ?? author, createdAt: existing?.createdAt ?? question.createdAt, updatedAt: now };
    files.push({ path: `questions/${doc.subjectId}/${doc.id}.json`, content: utf8(doc), encoding: 'utf-8' });
    for (const image of doc.images) {
      if (known.has(image.hash) || written.has(image.hash)) continue;
      const stored = await db.localImages.get(image.hash);
      if (!stored) throw new PublishError('Falta una imagen en este dispositivo. Vuelve a subirla editando la pregunta.');
      files.push({ path: `images/${image.hash}.${image.ext}`, content: bytesToBase64(new Uint8Array(await stored.blob.arrayBuffer())), encoding: 'base64' });
      written.add(image.hash);
    }
  }

  const nonce = newNonce();
  const count = prepared.questions.length;
  const title = `${count} ${count === 1 ? 'pregunta' : 'preguntas'} de @${user.login}`;
  const body = `${summaryFor(count)}\n\nOrigen declarado: \`${origin}\`. Acepto publicarlas con licencia CC BY-SA 4.0.\n\n${LICENSE_MARKER}`;
  const ids = prepared.questions.map((q) => q.id);
  const row = await enqueue({ v: 1, kind: 'questions', nonce, questions: [], subjects: [], images: [], licenseAccepted: true, origin } as unknown as Submission, summaryFor(count), { questions: ids }, 'pull');
  let pull: { number: number; html_url: string };
  try {
    pull = await openContributionPull(token, user.login, `qb/${nonce}`, title, body, files);
  } catch (error) {
    // Sin PR no hay nada que seguir: las preguntas siguen como estaban y se puede reintentar.
    await db.outbox.delete(row.id);
    throw new PublishError(`GitHub no ha aceptado el pull request: ${(error as Error).message}`);
  }
  await markSent(row, { url: pull.html_url, issueNumber: pull.number, attempts: 1 });
  await logSync('info', `Abierto el PR #${pull.number} con ${count} preguntas.`);
  return row;
}

/** Respuestas sin publicar, listas para enviar. El cliente nunca declara si acertó. */
export async function publishResults(): Promise<OutboxRow[]> {
  const attempts = await db.attempts.where('published').equals(0).sortBy('at');
  const publishedQuestions = new Set(await db.cQuestions.toCollection().primaryKeys());
  // Lo respondido en preguntas sin publicar no tiene sentido fuera de este dispositivo.
  const eligible = attempts.filter((a) => publishedQuestions.has(a.questionId));
  // Las de una competición ya viajan en su propia entrega.
  const answers = eligible.filter((a) => a.mode !== 'competition');
  if (answers.length === 0) throw new PublishError('No hay respuestas nuevas de preguntas publicadas.');

  const toEvent = (a: (typeof answers)[number]): AnswerEvent => ({
    id: a.id,
    q: a.questionId,
    ...(a.selected !== null ? { sel: a.selected } : {}),
    ...(a.selfGrade !== null ? { g: a.selfGrade } : {}),
    ms: Math.min(a.durationMs, 6 * 60 * 60 * 1000),
    at: Math.floor(a.at / 1000),
    ...(a.sessionId ? { s: a.sessionId } : {}),
    m: a.mode,
  });

  const rows: OutboxRow[] = [];
  // Se trocea con margen: cada lote debe caber en un issue una vez comprimido.
  const chunk = Math.min(MAX_ANSWERS_PER_SUBMISSION, 900);
  for (let i = 0; i < answers.length; i += chunk) {
    const batch = answers.slice(i, i + chunk);
    const summary = `Publico ${batch.length} ${batch.length === 1 ? 'respuesta' : 'respuestas'} de estudio para los rankings. Son públicas: quedan en el registro de este repositorio.`;
    rows.push(await enqueue({ v: 1, kind: 'results', nonce: newNonce(), answers: batch.map(toEvent) }, summary, { attempts: batch.map((a) => a.id) }));
  }
  return rows;
}

export async function unpublishedAnswerCount(): Promise<number> {
  const inQueue = new Set((await db.outbox.toArray()).filter((r) => r.status !== 'rejected' && r.status !== 'failed').flatMap((r) => r.related.attempts ?? []));
  const publishedQuestions = new Set(await db.cQuestions.toCollection().primaryKeys());
  return (await db.attempts.where('published').equals(0).toArray()).filter((a) => publishedQuestions.has(a.questionId) && a.mode !== 'competition' && !inQueue.has(a.id)).length;
}
