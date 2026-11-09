import { useLiveQuery } from 'dexie-react-hooks';
import type { StudyMode } from '@core/schema/events';
import { questionMarks } from '@core/exams/assemble';
import { gradeAnswer, type SelfGrade } from '@core/questions/grading';
import { filterQuestions, scopePredicate, type QuestionFilter, type StudyScope } from '@core/questions/filter';
import type { Question } from '@core/schema/question';
import { selectBalanced, selectDue, selectPractice, type SelectionProgress } from '@core/study/select';
import { buildTaxonomyIndex } from '@core/taxonomy/merge';
import { bytesToBase64Url } from '@core/util/encoding';
import { shuffle } from '@core/util/rng';
import { loadQuestions, toQuestion } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
import { loadSubjects } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { AttemptRow, SessionAnswer, SessionConfig, SessionRow } from '@/infra/db/types';
import { syncDevices } from '@/features/sync/deviceSync';
import { applyAttempt, emptyProgress } from './progressRepo';

export const MODE_LABELS: Record<StudyMode, string> = {
  practice: 'Práctica',
  exam: 'Examen',
  review: 'Repaso',
  custom: 'Personalizado',
  competition: 'Competición',
};

/** Modos en los que no se corrige nada hasta terminar. */
export const isDeferredMode = (mode: StudyMode): boolean => mode === 'exam' || mode === 'competition';

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/** Identificador corto de intento: viaja en cada resultado publicado, así que importa su tamaño. */
export function attemptId(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(9)));
}

function toFilter(config: SessionConfig): QuestionFilter {
  return {
    subjectId: config.subjectId,
    unitIds: config.unitIds,
    topicIds: config.topicIds,
    difficulties: config.difficulties,
    types: config.types,
  };
}

/** Resumen del temario elegido, o `null` si entra todo. */
export function scopeLabel(scope: StudyScope): string | null {
  if (scope.mode === 'all' || scope.topicIds.length === 0) return null;
  const topics = `${scope.topicIds.length} ${scope.topicIds.length === 1 ? 'tema' : 'temas'}`;
  return scope.mode === 'only' ? `Sólo ${topics}` : `Todo menos ${topics}`;
}

export async function matchingQuestions(config: SessionConfig): Promise<Question[]> {
  const [questions, subjects] = await Promise.all([loadQuestions(), loadSubjects()]);
  return filterQuestions(questions, toFilter(config), buildTaxonomyIndex(subjects))
    .filter(config.ignoreScope ? () => true : scopePredicate(preferences.get().studyScope))
    .map(toQuestion);
}

async function progressMap(): Promise<Map<string, SelectionProgress>> {
  return new Map((await db.progress.toArray()).map((row) => [row.questionId, row]));
}

/** Elige las preguntas según el modo. */
export async function pickQuestionIds(mode: StudyMode, config: SessionConfig): Promise<string[]> {
  const pool = await matchingQuestions(config);
  const now = Date.now();
  if (mode === 'review') {
    const rows = await db.progress.toArray();
    const ids = new Set(
      rows
        .filter((row) => {
          if (row.attempts === 0 && config.source !== 'favorites' && config.source !== 'hard') return false;
          switch (config.source) {
            case 'failed':
              return row.lastCorrect === false;
            case 'hard':
              return row.hard === 1;
            case 'favorites':
              return row.favorite === 1;
            default:
              return row.due <= now;
          }
        })
        .map((row) => row.questionId),
    );
    const eligible = pool.filter((q) => ids.has(q.id));
    if (config.source === 'due' || !config.source) return selectDue(eligible, config.count, await progressMap(), now).map((q) => q.id);
    return selectPractice(eligible, config.count, await progressMap(), now).map((q) => q.id);
  }
  if (mode === 'exam') {
    if (!config.mix) return selectBalanced(pool, config.count).map((q) => q.id);
    const ofType = (type: Question['type'], count: number) => selectBalanced(pool.filter((q) => q.type === type), count);
    // El test primero, como en una prueba real.
    return [...ofType('mcq', config.mix.mcq), ...ofType('open', config.mix.open)].map((q) => q.id);
  }
  if (config.source === 'new') {
    const progress = await progressMap();
    return selectPractice(pool.filter((q) => !progress.get(q.id)?.attempts), config.count, progress, now).map((q) => q.id);
  }
  if (config.mix) {
    const { mcq, open } = config.mix;
    const progress = await progressMap();
    const ofType = (type: Question['type'], count: number) => selectPractice(pool.filter((q) => q.type === type), count, progress, now);
    return shuffle([...ofType('mcq', mcq), ...ofType('open', open)]).map((q) => q.id);
  }
  return selectPractice(pool, config.count, await progressMap(), now).map((q) => q.id);
}

export interface StartSessionInput {
  mode: StudyMode;
  title: string;
  config: SessionConfig;
  timeLimitSec?: number | null;
  questionIds?: string[];
  competitionId?: string;
  competitionRound?: number;
}

export async function startSession(input: StartSessionInput): Promise<string> {
  const questionIds = input.questionIds ?? (await pickQuestionIds(input.mode, input.config));
  if (questionIds.length === 0) throw new SessionError(scopeLabel(preferences.get().studyScope) ? 'No hay preguntas que cumplan estas condiciones dentro del temario que has elegido en Estudiar.' : 'No hay preguntas que cumplan estas condiciones.');
  const id = crypto.randomUUID();
  const row: SessionRow = {
    id,
    mode: input.mode,
    title: input.title,
    config: input.config,
    questionIds,
    cursor: 0,
    answers: {},
    state: 'active',
    startedAt: Date.now(),
    finishedAt: null,
    timeLimitSec: input.timeLimitSec ?? null,
    questionShownAt: null,
    competitionId: input.competitionId ?? null,
    competitionRound: input.competitionRound ?? null,
  };
  await db.sessions.put(row);
  return id;
}

export function useSession(id: string | undefined): SessionRow | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.sessions.get(id)) ?? null) : null), [id]);
}

export function useActiveSessions(): SessionRow[] | undefined {
  return useLiveQuery(() => db.sessions.where('state').equals('active').reverse().sortBy('startedAt'), []);
}

export async function setCursor(sessionId: string, cursor: number): Promise<void> {
  await db.sessions.update(sessionId, { cursor });
}

/** Guarda lo marcado sin corregir: en un examen, la solución aún no se puede ver. */
export async function saveDeferredAnswer(sessionId: string, questionId: string, answer: Omit<SessionAnswer, 'committed'>): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.state !== 'active') return;
    session.answers[questionId] = { ...answer, committed: false };
    await db.sessions.put(session);
  });
}

/** Lo escrito en un examen. No corrige nada: se enseña junto a la solución al autoevaluarse. */
export async function saveWritten(sessionId: string, questionId: string, written: Record<string, string>): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.state !== 'active') return;
    const previous = session.answers[questionId];
    session.answers[questionId] = { durationMs: previous?.durationMs ?? 0, answeredAt: previous?.answeredAt ?? Date.now(), ...previous, written, committed: false };
    await db.sessions.put(session);
  });
}

export async function toggleMarked(sessionId: string, questionId: string): Promise<void> {
  await db.sessions.where('id').equals(sessionId).modify((session) => {
    const marked = new Set(session.marked ?? []);
    if (!marked.delete(questionId)) marked.add(questionId);
    session.marked = [...marked];
  });
}

function buildAttempt(session: SessionRow, question: Question, answer: Omit<SessionAnswer, 'committed'>, now: number): AttemptRow {
  const result = gradeAnswer(question, { sel: answer.selected, g: answer.selfGrade });
  return {
    id: attemptId(),
    questionId: question.id,
    questionRev: question.rev,
    sessionId: session.id,
    mode: session.mode,
    selected: question.type === 'mcq' ? (answer.selected ?? []) : null,
    selfGrade: question.type === 'open' ? (answer.selfGrade ?? 0) : null,
    correct: result.correct,
    score: result.score,
    durationMs: Math.round(answer.durationMs),
    at: now,
    subjectId: question.subjectId,
    difficulty: question.difficulty,
    published: 0,
  };
}

/**
 * Registra una respuesta definitiva: el intento, el estado de repetición espaciada y la sesión
 * se guardan en una sola transacción. Si la app se cierra, o está todo o no está nada.
 */
export async function commitAnswer(sessionId: string, question: Question, answer: Omit<SessionAnswer, 'committed'>): Promise<AttemptRow | null> {
  return db.transaction('rw', db.sessions, db.attempts, db.progress, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return null;
    if (session.answers[question.id]?.committed) return null;
    const now = Date.now();
    const attempt = buildAttempt(session, question, answer, now);
    await db.attempts.put(attempt);
    const row = (await db.progress.get(question.id)) ?? emptyProgress(question.id, now);
    await db.progress.put(applyAttempt(row, attempt, preferences.get().retention));
    session.answers[question.id] = { ...answer, committed: true };
    await db.sessions.put(session);
    return attempt;
  });
}

/**
 * Entrega. Corrige lo que se pueda: el test queda registrado; el desarrollo se queda pendiente
 * de autoevaluar en la pantalla de resultados, porque corregirlo exige ver la solución.
 */
export async function finishSession(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session || session.state === 'finished') return;
  const questions = new Map((await loadQuestions()).map((q) => [q.id, q]));
  const now = Date.now();
  for (const questionId of session.questionIds) {
    const answer = session.answers[questionId];
    const question = questions.get(questionId);
    if (!question || answer?.committed) continue;
    // Sin responder también cuenta en un examen: es un fallo, no una pregunta que no existió.
    if (question.type === 'mcq' && isDeferredMode(session.mode)) {
      await commitAnswer(sessionId, toQuestion(question), answer ?? { selected: [], durationMs: 0, answeredAt: now });
    }
  }
  await db.sessions.update(sessionId, { state: 'finished', finishedAt: Date.now() });
  void syncDevices();
}

/**
 * Registra una autoevaluación. `elapsedMs` es lo que la pregunta ha estado a la vista. En un examen
 * no se conoce, porque se autoevalúa en los resultados: se usa la media de la sesión. Sin duración,
 * el servidor descartaría la respuesta por inverosímil.
 */
export async function commitSelfGrade(sessionId: string, question: Question, selfGrade: SelfGrade, metCriteria: string[], elapsedMs?: number): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const previous = session.answers[question.id];
  const now = Date.now();
  const average = ((session.finishedAt ?? now) - session.startedAt) / session.questionIds.length;
  // Lo escrito sin cronometrar deja la duración en 0: también ahí vale la media.
  await commitAnswer(sessionId, question, { durationMs: elapsedMs ?? (previous?.durationMs || average), answeredAt: previous?.answeredAt ?? now, selfGrade, metCriteria, ...(previous?.written ? { written: previous.written } : {}) });
}

export async function abandonSession(sessionId: string): Promise<void> {
  await db.sessions.delete(sessionId);
}

export interface SessionSummary {
  total: number;
  answered: number;
  mcqTotal: number;
  correct: number;
  pendingSelfGrade: number;
  scorePercent: number | null;
  durationMs: number;
}

export function summarizeSession(session: SessionRow, questions: ReadonlyMap<string, Question>, attempts: readonly AttemptRow[]): SessionSummary {
  const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
  let mcqTotal = 0;
  let correct = 0;
  let answered = 0;
  let pendingSelfGrade = 0;
  for (const id of session.questionIds) {
    const question = questions.get(id);
    const attempt = byQuestion.get(id);
    if (!question) continue;
    if (question.type === 'mcq') {
      mcqTotal += 1;
      if (attempt?.correct) correct += 1;
      if (attempt && (attempt.selected?.length ?? 0) > 0) answered += 1;
    } else if (attempt) {
      answered += 1;
    } else {
      pendingSelfGrade += 1;
    }
  }
  return {
    total: session.questionIds.length,
    answered,
    mcqTotal,
    correct,
    pendingSelfGrade,
    scorePercent: mcqTotal > 0 ? Math.round((correct / mcqTotal) * 100) : null,
    durationMs: (session.finishedAt ?? Date.now()) - session.startedAt,
  };
}

export interface SessionMarks {
  earned: number;
  total: number;
  /** Preguntas de desarrollo aún sin autoevaluar. */
  pending: number;
}

const earnedMarks = (question: Question, attempt: AttemptRow) => (question.type === 'mcq' ? (attempt.correct ? questionMarks(question) : 0) : Math.round(attempt.score * questionMarks(question)));

/** Puntos de una sesión. En desarrollo salen de tu autoevaluación: son una estimación. */
export function sessionMarks(session: SessionRow, questions: ReadonlyMap<string, Question>, attempts: readonly AttemptRow[]): SessionMarks {
  const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
  const marks: SessionMarks = { earned: 0, total: 0, pending: 0 };
  for (const id of session.questionIds) {
    const question = questions.get(id);
    if (!question) continue;
    const attempt = byQuestion.get(id);
    marks.total += questionMarks(question);
    if (attempt) marks.earned += earnedMarks(question, attempt);
    else if (question.type === 'open') marks.pending += 1;
  }
  return marks;
}

export interface TopicMarks {
  topicId: string;
  earned: number;
  total: number;
}

/** Puntos por tema, de peor a mejor. Lo que aún no tiene nota no cuenta: no es un fallo. */
export function marksByTopic(session: SessionRow, questions: ReadonlyMap<string, Question>, attempts: readonly AttemptRow[]): TopicMarks[] {
  const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
  const topics = new Map<string, TopicMarks>();
  for (const id of session.questionIds) {
    const question = questions.get(id);
    const attempt = byQuestion.get(id);
    const topicId = question?.topicIds[0];
    if (!question || !attempt || !topicId) continue;
    const row = topics.get(topicId) ?? { topicId, earned: 0, total: 0 };
    row.earned += earnedMarks(question, attempt);
    row.total += questionMarks(question);
    topics.set(topicId, row);
  }
  return [...topics.values()].sort((a, b) => a.earned / a.total - b.earned / b.total);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
