import { z } from 'zod';
import { Difficulty, HttpUrl, IsoDate, Sha256, UserRef, Uuid } from './common.ts';

export const LICENSES = ['CC-BY-SA-4.0'] as const;

export const LIMITS = {
  statement: 8000,
  explanation: 8000,
  answerText: 2000,
  answerFeedback: 1000,
  modelAnswer: 12000,
  partStatement: 4000,
  maxParts: 10,
  partMarks: 20,
  criterion: 500,
  keyword: 60,
  tag: 40,
  /** Diez: una pregunta de examen con varios apartados lleva a menudo una figura en cada uno. */
  images: 10,
  imageBytes: 512 * 1024,
  minAnswers: 4,
  maxAnswers: 12,
  maxTopics: 8,
  maxTags: 12,
  maxKeywords: 20,
  maxCriteria: 12,
  maxReferences: 10,
} as const;

/** Imagen adjunta. El fichero se llama `<hash>.<ext>`: mismo contenido, mismo nombre. */
export const QuestionImage = z.strictObject({
  hash: Sha256,
  ext: z.enum(['webp', 'png', 'jpg']),
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
  bytes: z.number().int().positive().max(LIMITS.imageBytes),
  alt: z.string().max(300),
});
export type QuestionImage = z.infer<typeof QuestionImage>;

export const Reference = z
  .strictObject({
    title: z.string().min(1).max(300),
    url: HttpUrl.optional(),
  });
export type Reference = z.infer<typeof Reference>;

/**
 * Opción de respuesta. El `id` es estable y se queda aunque cambie el texto o el orden:
 * es lo que publican los resultados, de modo que corregir una errata no los invalida.
 */
export const Answer = z.strictObject({
  id: z.string().regex(/^[a-z0-9]{1,8}$/),
  text: z.string().min(1).max(LIMITS.answerText),
  correct: z.boolean(),
  feedback: z.string().max(LIMITS.answerFeedback).optional(),
});
export type Answer = z.infer<typeof Answer>;

export const Criterion = z.strictObject({
  id: z.string().regex(/^[a-z0-9]{1,8}$/),
  text: z.string().min(1).max(LIMITS.criterion),
  weight: z.number().int().min(1).max(10),
});
export type Criterion = z.infer<typeof Criterion>;

const base = {
  schemaVersion: z.literal(1),
  id: Uuid,
  /** Sube en 1 con cada versión publicada. Detecta ediciones sobre una base obsoleta. */
  rev: z.number().int().positive(),
  statement: z.string().min(1).max(LIMITS.statement),
  explanation: z.string().max(LIMITS.explanation).optional(),
  images: z.array(QuestionImage).max(LIMITS.images),
  difficulty: Difficulty,
  subjectId: Uuid,
  /** Temas a los que pertenece: pueden ser varios. La unidad se deduce de cada tema. */
  topicIds: z.array(Uuid).min(1).max(LIMITS.maxTopics),
  tags: z.array(z.string().min(1).max(LIMITS.tag)).max(LIMITS.maxTags),
  references: z.array(Reference).max(LIMITS.maxReferences),
  /** `null` mientras la pregunta sólo existe en este dispositivo. */
  author: UserRef.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  license: z.enum(LICENSES),
  derivedFrom: Uuid.optional(),
};

export const McqQuestion = z
  .strictObject({
    ...base,
    type: z.literal('mcq'),
    answers: z.array(Answer).min(LIMITS.minAnswers).max(LIMITS.maxAnswers),
    /** `false`: una única correcta. `true`: puede haber varias. */
    multiple: z.boolean(),
    reveal: z.strictObject({
      /** Mostrar la explicación nada más responder (modo práctica). */
      explanationAfterAnswer: z.boolean(),
      /** Mostrar las soluciones al terminar un examen. */
      solutionsAtExamEnd: z.boolean(),
    }),
  })
  .superRefine((q, ctx) => {
    const correct = q.answers.filter((a) => a.correct).length;
    if (correct === 0) ctx.addIssue({ code: 'custom', path: ['answers'], message: 'Marca al menos una respuesta correcta' });
    if (!q.multiple && correct > 1) {
      ctx.addIssue({ code: 'custom', path: ['answers'], message: 'Con respuesta única sólo puede haber una correcta' });
    }
    if (new Set(q.answers.map((a) => a.id)).size !== q.answers.length) {
      ctx.addIssue({ code: 'custom', path: ['answers'], message: 'Hay identificadores de respuesta repetidos' });
    }
  });
export type McqQuestion = z.infer<typeof McqQuestion>;

/** Apartado a), b)… de una pregunta de desarrollo: su enunciado, su solución y sus puntos. */
export const OpenPart = z.strictObject({
  id: z.string().regex(/^[a-z0-9]{1,8}$/),
  statement: z.string().min(1).max(LIMITS.partStatement),
  modelAnswer: z.string().min(1).max(LIMITS.modelAnswer),
  /** Como en un examen. Pesan en la nota que se sugiere al autoevaluarse. */
  marks: z.number().int().min(1).max(LIMITS.partMarks).optional(),
});
export type OpenPart = z.infer<typeof OpenPart>;

export const OpenQuestion = z
  .strictObject({
    ...base,
    type: z.literal('open'),
    /** Con apartados puede ir vacía: cada apartado lleva la suya. */
    modelAnswer: z.string().max(LIMITS.modelAnswer),
    criteria: z.array(Criterion).max(LIMITS.maxCriteria),
    keywords: z.array(z.string().min(1).max(LIMITS.keyword)).max(LIMITS.maxKeywords),
    /** Sin apartados, el campo no va: así la pregunta sigue siendo como antes para versiones viejas. */
    parts: z.array(OpenPart).min(1).max(LIMITS.maxParts).optional(),
  })
  .superRefine((q, ctx) => {
    if (!q.parts && q.modelAnswer.length === 0) ctx.addIssue({ code: 'custom', path: ['modelAnswer'], message: 'Falta la respuesta modelo' });
    if (q.parts && new Set(q.parts.map((p) => p.id)).size !== q.parts.length) {
      ctx.addIssue({ code: 'custom', path: ['parts'], message: 'Hay apartados repetidos' });
    }
  });
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/** a), b), c)… Para pocas cosas más que diez basta el abecedario. */
export function partLabel(index: number): string {
  return `${String.fromCharCode(97 + index)})`;
}

export const Question = z.discriminatedUnion('type', [McqQuestion, OpenQuestion]);
export type Question = z.infer<typeof Question>;
export type QuestionType = Question['type'];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Tipo test',
  open: 'Desarrollo',
};
