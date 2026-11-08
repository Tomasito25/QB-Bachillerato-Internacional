import { z } from 'zod';
import { Login, Sha256, Uuid } from './common.ts';
import { CompetitionFilters, COMPETITION_TYPES } from './competition.ts';
import { AnswerEvent } from './events.ts';
import { CompetitionEntryAnswer } from './competition.ts';

/**
 * Lo que viaja en un issue. Todo es entrada no confiable: nada de aquí decide quién es el
 * autor ni qué hora es, porque eso sale del propio issue (`issue.user`, `issue.created_at`).
 */

export const SUBMISSION_VERSION = 1;

/** Topes de seguridad: lo que manda en la práctica es que el envío quepa en el cuerpo de un issue. */
export const MAX_QUESTIONS_PER_SUBMISSION = 500;
export const MAX_ANSWERS_PER_SUBMISSION = 2000;
export const MAX_IMAGES_PER_SUBMISSION = 40;

const head = {
  v: z.literal(SUBMISSION_VERSION),
  /** Aleatorio. Permite al cliente reconocer su issue y hace idempotente el reenvío. */
  nonce: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/),
};

export const InlineImage = z.strictObject({
  hash: Sha256,
  ext: z.enum(['webp', 'png', 'jpg']),
  base64: z.string().max(1024 * 1024),
});
export type InlineImage = z.infer<typeof InlineImage>;

export const ConnectSubmission = z.strictObject({ ...head, kind: z.literal('connect') });

export const ProfileSubmission = z.strictObject({
  ...head,
  kind: z.literal('profile'),
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(280).optional(),
});

export const QuestionsSubmission = z.strictObject({
  ...head,
  kind: z.literal('questions'),
  /** Se validan después con su propio esquema, para dar errores por pregunta. */
  questions: z.array(z.unknown()).min(1).max(MAX_QUESTIONS_PER_SUBMISSION),
  subjects: z.array(z.unknown()).max(MAX_QUESTIONS_PER_SUBMISSION),
  images: z.array(InlineImage).max(MAX_IMAGES_PER_SUBMISSION),
  /** Licencia aceptada y procedencia declarada por quien publica. */
  licenseAccepted: z.literal(true),
  origin: z.enum(['own', 'open-licensed', 'public-domain']),
});

export const ResultsSubmission = z.strictObject({
  ...head,
  kind: z.literal('results'),
  answers: z.array(AnswerEvent).min(1).max(MAX_ANSWERS_PER_SUBMISSION),
});

export const CompetitionCreateSubmission = z.strictObject({
  ...head,
  kind: z.literal('competition-create'),
  type: z.enum(COMPETITION_TYPES).exclude(['daily', 'weekly']),
  title: z.string().trim().min(1).max(120),
  filters: CompetitionFilters,
  questionCount: z.number().int().min(1).max(50),
  durationSec: z.number().int().min(30).max(4 * 60 * 60),
  /** Cuánto tiempo queda abierta para entregar. */
  windowHours: z.number().int().min(1).max(24 * 30),
  invited: z.array(Login).max(50),
  maxParticipants: z.number().int().min(2).max(1024).nullable(),
  /** Sólo torneos. */
  registrationHours: z.number().int().min(1).max(24 * 14).optional(),
  roundHours: z.number().int().min(1).max(24 * 14).optional(),
});

export const CompetitionJoinSubmission = z.strictObject({
  ...head,
  kind: z.literal('competition-join'),
  competitionId: z.string().regex(/^[a-z0-9-]{4,64}$/),
});

export const CompetitionEntrySubmission = z.strictObject({
  ...head,
  kind: z.literal('competition-entry'),
  competitionId: z.string().regex(/^[a-z0-9-]{4,64}$/),
  round: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0),
  answers: z.array(CompetitionEntryAnswer).min(1).max(100),
});

export const ReportSubmission = z.strictObject({
  ...head,
  kind: z.literal('report'),
  questionId: Uuid,
  reason: z.enum(['wrong-answer', 'copyright', 'duplicate', 'offensive', 'other']),
  detail: z.string().trim().max(2000),
});

export const RetireSubmission = z.strictObject({
  ...head,
  kind: z.literal('retire'),
  questionId: Uuid,
});

export const Submission = z.discriminatedUnion('kind', [
  ConnectSubmission,
  ProfileSubmission,
  QuestionsSubmission,
  ResultsSubmission,
  CompetitionCreateSubmission,
  CompetitionJoinSubmission,
  CompetitionEntrySubmission,
  ReportSubmission,
  RetireSubmission,
]);
export type Submission = z.infer<typeof Submission>;
export type SubmissionKind = Submission['kind'];

export const SUBMISSION_KIND_LABELS: Record<SubmissionKind, string> = {
  connect: 'Conexión de cuenta',
  profile: 'Perfil',
  questions: 'Preguntas',
  results: 'Resultados de estudio',
  'competition-create': 'Nueva competición',
  'competition-join': 'Inscripción',
  'competition-entry': 'Entrega de competición',
  report: 'Reporte',
  retire: 'Retirada de pregunta',
};
