import { z } from 'zod';
import { Uuid } from './common.ts';

export const STUDY_MODES = ['practice', 'exam', 'review', 'custom', 'competition'] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

/**
 * Lo que el cliente declara sobre una respuesta.
 *
 * Fíjate en lo que falta: ni «acerté» ni «puntos». El cliente sólo dice qué opciones marcó;
 * la corrección y los puntos los calcula Actions. Para el desarrollo no hay corrección
 * posible, de modo que `g` es una autoevaluación y por eso apenas puntúa.
 */
export const AnswerEvent = z
  .strictObject({
    /** Id del intento, generado en el cliente. Hace idempotente el reenvío. */
    id: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/),
    q: Uuid,
    sel: z.array(z.string().regex(/^[a-z0-9]{1,8}$/)).max(12).optional(),
    g: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    ms: z.number().int().min(0).max(6 * 60 * 60 * 1000),
    /** Momento declarado (epoch en segundos). Se contrasta con `rcv`. */
    at: z.number().int().positive(),
    s: Uuid.optional(),
    m: z.enum(STUDY_MODES),
  });
export type AnswerEvent = z.infer<typeof AnswerEvent>;

/** La misma respuesta una vez aceptada. `rcv` y `src` los pone Actions a partir del issue. */
export const StoredAnswerEvent = z.strictObject({
  ...AnswerEvent.shape,
  rcv: z.number().int().positive(),
  src: z.number().int().positive(),
});
export type StoredAnswerEvent = z.infer<typeof StoredAnswerEvent>;

export const SystemEvent = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('question-approved'),
    q: Uuid,
    by: z.string(),
    at: z.number().int().positive(),
    pr: z.number().int().positive().optional(),
  }),
]);
export type SystemEvent = z.infer<typeof SystemEvent>;
