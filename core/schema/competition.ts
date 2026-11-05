import { z } from 'zod';
import { Difficulty, IsoDate, Login, Sha256, UserRef, Uuid } from './common.ts';

export const COMPETITION_TYPES = ['duel', 'group', 'tournament', 'daily', 'weekly'] as const;
export type CompetitionType = (typeof COMPETITION_TYPES)[number];

export const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  duel: 'Duelo',
  group: 'Grupal',
  tournament: 'Torneo',
  daily: 'Reto diario',
  weekly: 'Reto semanal',
};

export const CompetitionFilters = z.strictObject({
  subjectId: Uuid.optional(),
  unitIds: z.array(Uuid).max(50).optional(),
  topicIds: z.array(Uuid).max(100).optional(),
  difficulties: z.array(Difficulty).max(5).optional(),
});
export type CompetitionFilters = z.infer<typeof CompetitionFilters>;

export const CompetitionRound = z.strictObject({
  index: z.number().int().min(0),
  opensAt: IsoDate,
  closesAt: IsoDate,
  questionIds: z.array(Uuid).min(1).max(100),
});
export type CompetitionRound = z.infer<typeof CompetitionRound>;

export const Competition = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]{4,64}$/),
  /** Código corto para unirse. */
  code: z.string().regex(/^[A-Z0-9-]{4,16}$/),
  type: z.enum(COMPETITION_TYPES),
  title: z.string().trim().min(1).max(120),
  createdBy: UserRef.nullable(),
  createdAt: IsoDate,
  filters: CompetitionFilters,
  questionCount: z.number().int().min(1).max(100),
  durationSec: z.number().int().min(30).max(4 * 60 * 60),
  /** Elegidas por Actions con esta semilla, que el creador no podía conocer. */
  seed: Sha256,
  questionIds: z.array(Uuid).max(100),
  opensAt: IsoDate,
  closesAt: IsoDate,
  maxParticipants: z.number().int().min(2).max(1024).nullable(),
  invited: z.array(Login).max(50),
  /** Sólo torneos: inscripción hasta aquí; luego rondas. */
  registrationClosesAt: IsoDate.optional(),
  rounds: z.array(CompetitionRound).max(10).optional(),
  issue: z.number().int().positive().optional(),
});
export type Competition = z.infer<typeof Competition>;

export const CompetitionEntryAnswer = z.strictObject({
  q: Uuid,
  sel: z.array(z.string().regex(/^[a-z0-9]{1,8}$/)).max(12),
  ms: z.number().int().min(0).max(6 * 60 * 60 * 1000),
});
export type CompetitionEntryAnswer = z.infer<typeof CompetitionEntryAnswer>;

export const CompetitionEntry = z.strictObject({
  schemaVersion: z.literal(1),
  competitionId: z.string(),
  user: UserRef,
  round: z.number().int().min(0).optional(),
  /** Hora de GitHub al crear el issue: es el dato verificable. */
  submittedAt: IsoDate,
  /** Declarada por el cliente y sin verificar. La UI la muestra como tal. */
  durationMs: z.number().int().min(0),
  answers: z.array(CompetitionEntryAnswer).max(100),
  issue: z.number().int().positive(),
});
export type CompetitionEntry = z.infer<typeof CompetitionEntry>;

/** Inscripción en un torneo. */
export const CompetitionRegistration = z.strictObject({
  schemaVersion: z.literal(1),
  competitionId: z.string(),
  user: UserRef,
  registeredAt: IsoDate,
  issue: z.number().int().positive(),
});
export type CompetitionRegistration = z.infer<typeof CompetitionRegistration>;
