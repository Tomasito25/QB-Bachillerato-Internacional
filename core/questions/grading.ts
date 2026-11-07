import type { McqQuestion, Question } from '../schema/question.ts';

/** Autoevaluación de una pregunta de desarrollo. */
export type SelfGrade = 0 | 1 | 2;

export const SELF_GRADE_LABELS: Record<SelfGrade, string> = {
  0: 'Mal',
  1: 'A medias',
  2: 'Bien',
};

export function correctAnswerIds(question: McqQuestion): string[] {
  return question.answers.filter((a) => a.correct).map((a) => a.id);
}

/** Acierto estricto: exactamente las opciones correctas, ni una más ni una menos. */
export function isCorrectSelection(question: McqQuestion, selected: readonly string[]): boolean {
  const correct = new Set(correctAnswerIds(question));
  const chosen = new Set(selected);
  if (chosen.size !== correct.size) return false;
  for (const id of chosen) if (!correct.has(id)) return false;
  return true;
}

/**
 * Nota de 0 a 1 para respuesta múltiple: cada error resta lo que suma un acierto. Sólo se
 * usa para informar en el resultado; los puntos y las estadísticas usan el acierto estricto.
 */
export function partialScore(question: McqQuestion, selected: readonly string[]): number {
  const correct = new Set(correctAnswerIds(question));
  if (correct.size === 0) return 0;
  const chosen = new Set(selected);
  let hits = 0;
  let misses = 0;
  for (const id of chosen) {
    if (correct.has(id)) hits += 1;
    else misses += 1;
  }
  return Math.max(0, (hits - misses) / correct.size);
}

export interface GradeInput {
  sel?: readonly string[];
  g?: SelfGrade;
}

export interface GradeResult {
  /** `null`: no se puede saber objetivamente (desarrollo). */
  correct: boolean | null;
  /** Nota de 0 a 1. */
  score: number;
}

export function gradeAnswer(question: Question, input: GradeInput): GradeResult {
  if (question.type === 'mcq') {
    const selected = input.sel ?? [];
    return { correct: isCorrectSelection(question, selected), score: partialScore(question, selected) };
  }
  const grade = input.g ?? 0;
  return { correct: null, score: grade / 2 };
}

/**
 * Sugiere la autoevaluación a partir de los criterios marcados. Es sólo una sugerencia:
 * la decisión final es del estudiante.
 */
export function suggestSelfGrade(
  criteria: readonly { id: string; weight: number }[],
  met: readonly string[],
): SelfGrade {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total === 0) return 0;
  const metSet = new Set(met);
  const earned = criteria.reduce((sum, c) => sum + (metSet.has(c.id) ? c.weight : 0), 0);
  return gradeFromRatio(earned / total);
}

function gradeFromRatio(ratio: number): SelfGrade {
  if (ratio >= 0.85) return 2;
  if (ratio >= 0.5) return 1;
  return 0;
}

/**
 * Nota sugerida a partir de cómo salió cada apartado, pesando por sus puntos (1 si no
 * tiene). `null` mientras falte alguno por valorar.
 */
export function suggestFromParts(parts: readonly { id: string; marks?: number }[], grades: Readonly<Record<string, SelfGrade>>): SelfGrade | null {
  let total = 0;
  let earned = 0;
  for (const part of parts) {
    const grade = grades[part.id];
    if (grade === undefined) return null;
    const weight = part.marks ?? 1;
    total += weight;
    earned += (grade / 2) * weight;
  }
  return total === 0 ? null : gradeFromRatio(earned / total);
}
