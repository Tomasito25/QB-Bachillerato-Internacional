/**
 * Repetición espaciada con FSRS 4.5 (Free Spaced Repetition Scheduler).
 *
 * Anki lo incorpora desde 2023. Frente a SM-2 modela la memoria con tres valores:
 * dificultad, estabilidad (días hasta que la probabilidad de recordar cae al 90 %) y
 * recuperabilidad (esa probabilidad ahora mismo). Los pesos son los valores por defecto del
 * proyecto, ajustados con millones de repasos reales.
 */

export const DEFAULT_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587,
  0.2272, 2.8755,
] as const;

const DECAY = -0.5;
const FACTOR = 19 / 81;
const MS_PER_DAY = 86_400_000;
const RELEARN_DELAY_MS = 10 * 60_000;
/** Repetir una pregunta el mismo día no demuestra memoria a largo plazo. */
const SAME_DAY_MS = 12 * 60 * 60_000;

/** 1 Otra vez · 2 Difícil · 3 Bien · 4 Fácil */
export type FsrsGrade = 1 | 2 | 3 | 4;

export interface FsrsCard {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewAt: number | null;
  due: number;
}

export interface FsrsParams {
  /** Probabilidad de recordar que se quiere mantener. */
  retention: number;
  maxIntervalDays: number;
}

export const DEFAULT_PARAMS: FsrsParams = { retention: 0.9, maxIntervalDays: 730 };

const w = (i: number): number => DEFAULT_WEIGHTS[i] as number;
const clampDifficulty = (d: number): number => Math.min(10, Math.max(1, d));

export function newCard(now: number): FsrsCard {
  return { stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReviewAt: null, due: now };
}

function initialDifficulty(grade: FsrsGrade): number {
  return clampDifficulty(w(4) - Math.exp(w(5) * (grade - 1)) + 1);
}

function nextDifficulty(difficulty: number, grade: FsrsGrade): number {
  const change = difficulty - w(6) * (grade - 3);
  // Reversión a la media: evita que una pregunta quede para siempre en un extremo.
  return clampDifficulty(w(7) * initialDifficulty(3) + (1 - w(7)) * change);
}

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

export function intervalDays(stability: number, params: FsrsParams = DEFAULT_PARAMS): number {
  const days = (stability / FACTOR) * (Math.pow(params.retention, 1 / DECAY) - 1);
  return Math.min(params.maxIntervalDays, Math.max(1, Math.round(days)));
}

function stabilityAfterRecall(d: number, s: number, r: number, grade: FsrsGrade): number {
  const hardPenalty = grade === 2 ? w(15) : 1;
  const easyBonus = grade === 4 ? w(16) : 1;
  return s * (1 + Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hardPenalty * easyBonus);
}

function stabilityAfterLapse(d: number, s: number, r: number): number {
  const next = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
  return Math.min(next, s);
}

export function review(card: FsrsCard, grade: FsrsGrade, now: number, params: FsrsParams = DEFAULT_PARAMS): FsrsCard {
  if (card.lastReviewAt === null || card.stability <= 0) {
    const stability = w(grade - 1);
    return {
      stability,
      difficulty: initialDifficulty(grade),
      reps: 1,
      lapses: grade === 1 ? 1 : 0,
      lastReviewAt: now,
      due: grade === 1 ? now + RELEARN_DELAY_MS : now + intervalDays(stability, params) * MS_PER_DAY,
    };
  }

  const elapsed = Math.max(0, now - card.lastReviewAt);

  if (elapsed < SAME_DAY_MS) {
    // Mismo día. Acertar no inflará la estabilidad: si no, repasar diez veces seguidas
    // mandaría la pregunta a meses vista. Fallar sí adelanta el siguiente repaso.
    if (grade === 1) {
      return { ...card, lapses: card.lapses + 1, reps: card.reps + 1, lastReviewAt: now, due: now + RELEARN_DELAY_MS };
    }
    return { ...card, reps: card.reps + 1, lastReviewAt: now };
  }

  const r = retrievability(elapsed / MS_PER_DAY, card.stability);
  const difficulty = nextDifficulty(card.difficulty, grade);

  if (grade === 1) {
    return {
      stability: Math.max(0.1, stabilityAfterLapse(difficulty, card.stability, r)),
      difficulty,
      reps: card.reps + 1,
      lapses: card.lapses + 1,
      lastReviewAt: now,
      due: now + RELEARN_DELAY_MS,
    };
  }

  const stability = stabilityAfterRecall(difficulty, card.stability, r, grade);
  return {
    stability,
    difficulty,
    reps: card.reps + 1,
    lapses: card.lapses,
    lastReviewAt: now,
    due: now + intervalDays(stability, params) * MS_PER_DAY,
  };
}

/** Una pregunta se considera dominada si, sin repasarla, se recordaría durante 3 semanas. */
export function isMastered(card: FsrsCard): boolean {
  return card.stability >= 21;
}

/** Traduce una respuesta a nota FSRS. */
export function gradeFromResult(result: { correct: boolean | null; selfGrade?: 0 | 1 | 2 }): FsrsGrade {
  if (result.correct === true) return 3;
  if (result.correct === false) return 1;
  if (result.selfGrade === 2) return 3;
  if (result.selfGrade === 1) return 2;
  return 1;
}
