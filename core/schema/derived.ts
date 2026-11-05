import { z } from 'zod';
import { IsoDate, Login, Sha256, Uuid } from './common.ts';
import { Competition } from './competition.ts';
import { UserDoc } from './profile.ts';

/** Ficheros generados en cada despliegue. Nadie los edita: son función de los eventos. */

export const SHARD_KINDS = [
  'taxonomy',
  'questions',
  'profiles',
  'leaderboards',
  'competitions',
  'question-stats',
  'moderation',
] as const;
export type ShardKind = (typeof SHARD_KINDS)[number];

export const ManifestShard = z.strictObject({
  id: z.string().min(1).max(200),
  kind: z.enum(SHARD_KINDS),
  /** Relativa a `community/`. Lleva el hash en el nombre. */
  path: z.string().regex(/^[A-Za-z0-9/_.-]+$/).max(300),
  hash: Sha256,
  count: z.number().int().min(0),
  subjectId: Uuid.optional(),
});
export type ManifestShard = z.infer<typeof ManifestShard>;

export const Manifest = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: IsoDate,
  dataCommit: z.string().max(64),
  shards: z.array(ManifestShard),
  counts: z.strictObject({
    questions: z.number().int().min(0),
    subjects: z.number().int().min(0),
    users: z.number().int().min(0),
    answers: z.number().int().min(0),
    competitions: z.number().int().min(0),
  }),
  /** Documentos descartados al compilar: no se ocultan, se cuentan. */
  quarantined: z.number().int().min(0),
});
export type Manifest = z.infer<typeof Manifest>;

export const AchievementId = z.string().max(40);

export const ProfileStats = z.strictObject({
  points: z.number().int().min(0),
  level: z.number().int().min(1),
  answers: z.number().int().min(0),
  mcqAnswers: z.number().int().min(0),
  mcqCorrect: z.number().int().min(0),
  accuracy: z.number().min(0).max(1).nullable(),
  sessions: z.number().int().min(0),
  questionsApproved: z.number().int().min(0),
  questionUses: z.number().int().min(0),
  competitions: z.number().int().min(0),
  competitionWins: z.number().int().min(0),
  currentStreak: z.number().int().min(0),
  longestStreak: z.number().int().min(0),
  lastActiveAt: IsoDate.nullable(),
});
export type ProfileStats = z.infer<typeof ProfileStats>;

export const DerivedProfile = z.strictObject({
  ...UserDoc.shape,
  stats: ProfileStats,
  achievements: z.array(AchievementId),
  ranks: z.record(z.string(), z.number().int().positive()),
  suspect: z.boolean(),
});
export type DerivedProfile = z.infer<typeof DerivedProfile>;

export const LeaderboardEntry = z.strictObject({
  rank: z.number().int().positive(),
  login: Login,
  value: z.number(),
  /** Dato de contexto: por ejemplo, número de respuestas tras un porcentaje. */
  detail: z.number().optional(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const Leaderboard = z.strictObject({
  id: z.string().max(80),
  /** Clave del periodo, si lo tiene: `2026-W45`, `2026-11`. */
  period: z.string().max(16).nullable(),
  unit: z.enum(['points', 'questions', 'wilson', 'competitions']),
  entries: z.array(LeaderboardEntry),
  total: z.number().int().min(0),
});
export type Leaderboard = z.infer<typeof Leaderboard>;

export const QuestionStats = z.strictObject({
  questionId: Uuid,
  answers: z.number().int().min(0),
  uniqueUsers: z.number().int().min(0),
  correctRate: z.number().min(0).max(1).nullable(),
});
export type QuestionStats = z.infer<typeof QuestionStats>;

export const StandingRow = z.strictObject({
  rank: z.number().int().positive(),
  login: Login,
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  /** Declarada por el cliente. */
  durationMs: z.number().int().min(0),
  submittedAt: IsoDate,
});
export type StandingRow = z.infer<typeof StandingRow>;

export const BracketMatch = z.strictObject({
  a: Login.nullable(),
  b: Login.nullable(),
  winner: Login.nullable(),
  correctA: z.number().int().min(0).nullable(),
  correctB: z.number().int().min(0).nullable(),
  /** Por qué se decidió así: importa para no presentar una incomparecencia como victoria. */
  decidedBy: z.enum(['pending', 'score', 'time', 'submission', 'walkover', 'bye', 'seed']),
});
export type BracketMatch = z.infer<typeof BracketMatch>;

export const BracketRound = z.strictObject({
  index: z.number().int().min(0),
  opensAt: IsoDate,
  closesAt: IsoDate,
  matches: z.array(BracketMatch),
});
export type BracketRound = z.infer<typeof BracketRound>;

export const DerivedCompetition = z.strictObject({
  ...Competition.shape,
  participants: z.array(Login),
  standings: z.array(StandingRow),
  bracket: z.array(BracketRound).nullable(),
  champion: Login.nullable(),
});
export type DerivedCompetition = z.infer<typeof DerivedCompetition>;

export const ModerationData = z.strictObject({
  hiddenQuestions: z.array(Uuid),
  retiredQuestions: z.array(Uuid),
});
export type ModerationData = z.infer<typeof ModerationData>;

/** Detalle por usuario que se pide sólo al abrir un perfil. */
export const ActivityItem = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('study'),
    day: z.string(),
    answers: z.number().int().min(0),
    correct: z.number().int().min(0),
    points: z.number().int().min(0),
  }),
  z.strictObject({ kind: z.literal('question'), at: IsoDate, questionId: Uuid }),
  z.strictObject({ kind: z.literal('competition'), at: IsoDate, competitionId: z.string(), title: z.string(), rank: z.number().int().positive().nullable() }),
]);
export type ActivityItem = z.infer<typeof ActivityItem>;

export const UserDetail = z.strictObject({
  login: Login,
  activity: z.array(ActivityItem),
  contributed: z.array(Uuid),
  pointsBySubject: z.record(z.string(), z.number()),
});
export type UserDetail = z.infer<typeof UserDetail>;
