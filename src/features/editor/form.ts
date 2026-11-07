import { DIFFICULTY_VALUES, type Difficulty, type UserRef } from '@core/schema/common';
import { LICENSES, LIMITS, Question, type QuestionImage, type QuestionType, type Reference } from '@core/schema/question';
import { scanImageReferences } from '@core/questions/refs';
import { toIso } from '@core/util/time';

/**
 * Modelo del formulario. Va aparte del documento porque un borrador puede estar a medias;
 * un documento `Question`, nunca.
 */

export interface AnswerForm {
  id: string;
  text: string;
  correct: boolean;
  feedback: string;
}

export interface PartForm {
  id: string;
  statement: string;
  modelAnswer: string;
  /** `null`: sin puntos. */
  marks: number | null;
}

export interface CriterionForm {
  id: string;
  text: string;
  weight: number;
}

export interface QuestionForm {
  id: string;
  type: QuestionType;
  statement: string;
  explanation: string;
  images: QuestionImage[];
  difficulty: Difficulty;
  subjectId: string;
  topicIds: string[];
  tags: string[];
  references: Reference[];
  answers: AnswerForm[];
  multiple: boolean;
  explanationAfterAnswer: boolean;
  solutionsAtExamEnd: boolean;
  modelAnswer: string;
  criteria: CriterionForm[];
  keywords: string[];
  /** Apartados de una pregunta de desarrollo. Vacío: es de una sola respuesta. */
  parts: PartForm[];
  rev: number;
  baseRev: number | null;
  createdAt: string | null;
  author: UserRef | null;
  derivedFrom?: string;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** Siguiente identificador libre: a, b… z, a1, b1… Nunca reutiliza uno existente. */
export function nextId(existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((item) => item.id));
  for (let round = 0; ; round++) {
    for (const letter of ID_ALPHABET) {
      const id = round === 0 ? letter : `${letter}${round}`;
      if (!used.has(id)) return id;
    }
  }
}

function emptyAnswers(): AnswerForm[] {
  return ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '', correct: false, feedback: '' }));
}

export function newForm(subjectId = '', topicIds: string[] = []): QuestionForm {
  return {
    id: crypto.randomUUID(),
    type: 'mcq',
    statement: '',
    explanation: '',
    images: [],
    difficulty: 3,
    subjectId,
    topicIds,
    tags: [],
    references: [],
    answers: emptyAnswers(),
    multiple: false,
    explanationAfterAnswer: true,
    solutionsAtExamEnd: true,
    modelAnswer: '',
    criteria: [],
    keywords: [],
    parts: [],
    rev: 1,
    baseRev: null,
    createdAt: null,
    author: null,
  };
}

export function questionToForm(question: Question): QuestionForm {
  const form = newForm(question.subjectId, [...question.topicIds]);
  const shared: QuestionForm = {
    ...form,
    id: question.id,
    type: question.type,
    statement: question.statement,
    explanation: question.explanation ?? '',
    images: [...question.images],
    difficulty: question.difficulty,
    tags: [...question.tags],
    references: question.references.map((r) => ({ ...r })),
    rev: question.rev,
    createdAt: question.createdAt,
    author: question.author,
    derivedFrom: question.derivedFrom,
  };
  if (question.type === 'mcq') {
    return {
      ...shared,
      answers: question.answers.map((a) => ({ id: a.id, text: a.text, correct: a.correct, feedback: a.feedback ?? '' })),
      multiple: question.multiple,
      explanationAfterAnswer: question.reveal.explanationAfterAnswer,
      solutionsAtExamEnd: question.reveal.solutionsAtExamEnd,
    };
  }
  return {
    ...shared,
    modelAnswer: question.modelAnswer,
    criteria: question.criteria.map((c) => ({ ...c })),
    keywords: [...question.keywords],
    parts: (question.parts ?? []).map((part) => ({ id: part.id, statement: part.statement, modelAnswer: part.modelAnswer, marks: part.marks ?? null })),
  };
}

export type FormErrors = Partial<Record<'statement' | 'answers' | 'topics' | 'modelAnswer' | 'parts' | 'explanation' | 'references' | 'images' | 'general', string>>;

export interface FormResult {
  question: Question | null;
  errors: FormErrors;
}

export const hasErrors = (errors: FormErrors): boolean => Object.keys(errors).length > 0;

/** Convierte el formulario en documento y explica en español qué falta. */
export function formToQuestion(form: QuestionForm, now: number = Date.now()): FormResult {
  const errors: FormErrors = {};
  if (!form.statement.trim()) errors.statement = 'Escribe el enunciado.';
  if (form.topicIds.length === 0 || !form.subjectId) errors.topics = 'Elige asignatura y al menos un tema.';

  const answers = form.answers.map((a) => ({ ...a, text: a.text.trim() }));
  if (form.type === 'mcq') {
    if (answers.some((a) => !a.text)) errors.answers = 'Hay opciones vacías: complétalas o elimínalas.';
    else if (answers.length < LIMITS.minAnswers) errors.answers = `Hacen falta al menos ${LIMITS.minAnswers} opciones.`;
    else if (!answers.some((a) => a.correct)) errors.answers = 'Marca cuál es la respuesta correcta.';
    else if (!form.multiple && answers.filter((a) => a.correct).length > 1) errors.answers = 'Con respuesta única sólo puede haber una correcta.';
  } else if (form.parts.length === 0 && !form.modelAnswer.trim()) {
    errors.modelAnswer = 'Escribe la respuesta modelo.';
  } else if (form.parts.some((part) => !part.statement.trim())) {
    errors.parts = 'Hay apartados sin enunciado: complétalos o elimínalos.';
  } else if (form.parts.some((part) => !part.modelAnswer.trim())) {
    errors.parts = 'Cada apartado necesita su solución.';
  }
  if (form.references.some((r) => !r.title.trim())) errors.references = 'Cada referencia necesita un título.';
  if (hasErrors(errors)) return { question: null, errors };

  const iso = toIso(now);
  const common = {
    schemaVersion: 1 as const,
    id: form.id,
    rev: form.rev,
    statement: form.statement.trim(),
    explanation: form.explanation.trim() || undefined,
    images: form.images,
    difficulty: form.difficulty,
    subjectId: form.subjectId,
    topicIds: form.topicIds,
    tags: form.tags,
    references: form.references.map((r) => ({ title: r.title.trim(), url: r.url?.trim() || undefined })),
    author: form.author,
    createdAt: form.createdAt ?? iso,
    updatedAt: iso,
    license: LICENSES[0],
    derivedFrom: form.derivedFrom,
  };
  const candidate =
    form.type === 'mcq'
      ? {
          ...common,
          type: 'mcq' as const,
          answers: answers.map((a) => ({ id: a.id, text: a.text, correct: a.correct, feedback: a.feedback.trim() || undefined })),
          multiple: form.multiple,
          reveal: { explanationAfterAnswer: form.explanationAfterAnswer, solutionsAtExamEnd: form.solutionsAtExamEnd },
        }
      : {
          ...common,
          type: 'open' as const,
          modelAnswer: form.modelAnswer.trim(),
          criteria: form.criteria.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
          keywords: form.keywords,
          ...(form.parts.length > 0 ? { parts: form.parts.map((part) => ({ id: part.id, statement: part.statement.trim(), modelAnswer: part.modelAnswer.trim(), marks: part.marks ?? undefined })) } : {}),
        };

  const parsed = Question.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    const message = issue?.message ?? 'Datos no válidos.';
    if (field === 'references') errors.references = 'Hay una referencia con un enlace no válido: debe empezar por http:// o https://.';
    else if (field === 'statement') errors.statement = `El enunciado es demasiado largo (máximo ${LIMITS.statement} caracteres).`;
    else if (field === 'explanation') errors.explanation = `La explicación es demasiado larga (máximo ${LIMITS.explanation} caracteres).`;
    else if (field === 'modelAnswer') errors.modelAnswer = `La respuesta modelo es demasiado larga (máximo ${LIMITS.modelAnswer} caracteres).`;
    else if (field === 'answers') errors.answers = message.startsWith('Invalid') ? 'Alguna opción es demasiado larga.' : message;
    else if (field === 'parts') errors.parts = message.startsWith('Too big') || message.startsWith('Invalid') ? `Algún apartado es demasiado largo, o hay más de ${LIMITS.maxParts}.` : message;
    else errors.general = `${String(field ?? 'Formulario')}: ${message}`;
    return { question: null, errors };
  }

  // Las referencias a imágenes deben corresponder a imágenes adjuntas, y no pueden ser externas.
  const report = scanImageReferences(parsed.data);
  if (report.external.length > 0) {
    return { question: null, errors: { images: 'Sólo se admiten imágenes subidas aquí: las de otras webs pueden desaparecer o rastrear a quien las ve.' } };
  }
  const attached = new Set(form.images.map((i) => i.hash));
  if ([...report.hashes].some((hash) => !attached.has(hash))) {
    return { question: null, errors: { images: 'El texto usa una imagen que ya no está adjunta. Quita esa referencia o vuelve a subirla.' } };
  }
  return { question: parsed.data, errors: {} };
}

/** Quita del texto las referencias a una imagen, para no dejar enlaces rotos. */
export function removeImageReferences(form: QuestionForm, hash: string): QuestionForm {
  const strip = (text: string) => text.replace(new RegExp(`!\\[[^\\]]*\\]\\(qbimg:${hash}\\)`, 'g'), '').replace(/\n{3,}/g, '\n\n');
  return {
    ...form,
    images: form.images.filter((i) => i.hash !== hash),
    statement: strip(form.statement),
    explanation: strip(form.explanation),
    modelAnswer: strip(form.modelAnswer),
    answers: form.answers.map((a) => ({ ...a, text: strip(a.text), feedback: strip(a.feedback) })),
    parts: form.parts.map((part) => ({ ...part, statement: strip(part.statement), modelAnswer: strip(part.modelAnswer) })),
  };
}

export const DIFFICULTIES = DIFFICULTY_VALUES;
