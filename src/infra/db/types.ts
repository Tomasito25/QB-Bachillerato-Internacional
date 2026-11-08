import type { DerivedCompetition, DerivedProfile, Leaderboard, QuestionStats } from '@core/schema/derived';
import type { StudyMode } from '@core/schema/events';
import type { Question, QuestionImage } from '@core/schema/question';
import type { Submission, SubmissionKind } from '@core/schema/submission';
import type { SubjectDoc } from '@core/schema/taxonomy';
import type { Difficulty } from '@core/schema/common';
import type { QuestionType } from '@core/schema/question';
import type { FsrsCard } from '@core/srs/fsrs';
import type { SelfGrade } from '@core/questions/grading';

/**
 * Filas de IndexedDB. Tres familias que no se mezclan:
 *   l*        Local: lo escribe el usuario y la sincronización nunca lo pisa.
 *   c*        Comunitaria: réplica de la rama `data`. Se puede borrar y volver a bajar.
 *   d*        Derivada: lo calculado en Actions. Tampoco es del usuario.
 */

/** Estado de una pregunta local respecto a la comunidad. */
export type LocalSyncState =
  /** Sólo en este dispositivo. */
  | 'local'
  /** En la cola de publicación. */
  | 'queued'
  /** Enviada; a la espera de Actions. */
  | 'submitted'
  /** La comunitaria cambió mientras tanto. Hay que decidir. */
  | 'conflict'
  /** Rechazada. El motivo está en `note`. */
  | 'rejected';

export interface LocalMeta {
  /** Revisión comunitaria de la que parte esta edición. `null` si es nueva. */
  baseRev: number | null;
  syncState: LocalSyncState;
  outboxId: string | null;
  note: string | null;
}

export type LocalQuestionRow = Question & { local: LocalMeta };
export type CommunityQuestionRow = Question & { shardId: string };

export interface LocalSubjectRow extends SubjectDoc {
  local: { baseRev: number | null };
}

export interface DraftRow {
  /** Id que tendrá la pregunta. */
  id: string;
  /** Se guarda tal cual el formulario: un borrador puede estar incompleto. */
  form: unknown;
  /** Revisión comunitaria de partida si es una edición de algo publicado. */
  baseRev: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalImageRow extends QuestionImage {
  blob: Blob;
  createdAt: number;
}

export interface AttemptRow {
  id: string;
  questionId: string;
  questionRev: number;
  sessionId: string | null;
  mode: StudyMode;
  selected: string[] | null;
  selfGrade: SelfGrade | null;
  correct: boolean | null;
  score: number;
  durationMs: number;
  at: number;
  subjectId: string;
  difficulty: Difficulty;
  /** 0 sin publicar, 1 publicado. IndexedDB no indexa booleanos. */
  published: 0 | 1;
}

export interface SessionConfig {
  subjectId?: string;
  unitIds?: string[];
  topicIds?: string[];
  difficulties?: Difficulty[];
  types?: QuestionType[];
  count: number;
  order?: 'random' | 'selected';
  /** Sólo repaso. */
  source?: 'due' | 'failed' | 'hard' | 'favorites';
  /** Cuántas de cada tipo: para hacer justo lo que falta del objetivo diario. */
  mix?: { mcq: number; open: number };
}

export interface SessionAnswer {
  selected?: string[];
  selfGrade?: SelfGrade;
  metCriteria?: string[];
  /** Ya corregida y registrada como intento. En examen ocurre al terminar. */
  committed: boolean;
  durationMs: number;
  answeredAt: number;
}

export interface SessionRow {
  id: string;
  mode: StudyMode;
  title: string;
  config: SessionConfig;
  questionIds: string[];
  cursor: number;
  answers: Record<string, SessionAnswer>;
  state: 'active' | 'finished';
  startedAt: number;
  finishedAt: number | null;
  /** Límite de tiempo; el reloj sigue corriendo aunque se cierre la app. */
  timeLimitSec: number | null;
  /** Permite reanudar el cálculo del tiempo por pregunta. */
  questionShownAt: number | null;
  competitionId: string | null;
  competitionRound: number | null;
}

export interface ProgressRow {
  questionId: string;
  card: FsrsCard;
  /** Copia de `card.due`, para poder indexarla. */
  due: number;
  attempts: number;
  correct: number;
  lastCorrect: boolean | null;
  lastAt: number;
  favorite: 0 | 1;
  hard: 0 | 1;
}

export type OutboxStatus =
  /** Esperando a que haya conexión o a que el usuario lo envíe. */
  | 'queued'
  /** Se abrió GitHub; falta que el usuario pulse «Create». */
  | 'awaiting-user'
  /** El issue o PR existe; falta que Actions lo procese. */
  | 'sent'
  | 'accepted'
  /** Requiere revisión humana. */
  | 'review'
  | 'rejected'
  | 'failed';

export interface OutboxRow {
  id: string;
  kind: SubmissionKind;
  nonce: string;
  summary: string;
  payload: Submission;
  status: OutboxStatus;
  createdAt: number;
  updatedAt: number;
  /** Título y cuerpo ya codificados. Se calculan al encolar: abrir GitHub debe ser instantáneo. */
  issueTitle: string;
  issueBody: string;
  /** `issue`: se envía por issue. `pull`: rama en el fork y PR, sólo con token. */
  channel: 'issue' | 'pull';
  issueNumber: number | null;
  url: string | null;
  error: string | null;
  attempts: number;
  /** Qué objetos locales cierra este envío. */
  related: { questions?: string[]; subjects?: string[]; attempts?: string[]; sessionId?: string };
}

export interface ShardRow {
  id: string;
  kind: string;
  hash: string;
  appliedAt: number;
}

export interface SyncLogRow {
  seq?: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface KvRow {
  key: string;
  value: unknown;
}

export type DerivedProfileRow = DerivedProfile;
export type LeaderboardRow = Leaderboard;
export type DerivedCompetitionRow = DerivedCompetition;
export type QuestionStatsRow = QuestionStats;
