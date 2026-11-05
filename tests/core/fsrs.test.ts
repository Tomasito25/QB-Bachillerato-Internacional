import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, gradeFromResult, intervalDays, isMastered, newCard, retrievability, review, type FsrsCard } from '@core/srs/fsrs';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** Repasa siguiendo fielmente el calendario, con la nota indicada en cada repaso. */
function simulate(grades: (1 | 2 | 3 | 4)[]): FsrsCard {
  let card = newCard(T0);
  let now = T0;
  for (const grade of grades) {
    card = review(card, grade, now);
    now = Math.max(card.due, now + DAY);
  }
  return card;
}

describe('FSRS', () => {
  it('con retención 0,9 el intervalo coincide con la estabilidad', () => {
    expect(intervalDays(10, DEFAULT_PARAMS)).toBe(10);
    expect(intervalDays(100, DEFAULT_PARAMS)).toBe(100);
  });

  it('la recuperabilidad es 1 al repasar y 0,9 tras S días', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1, 5);
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
    expect(retrievability(100, 10)).toBeLessThan(0.9);
  });

  it('más retención implica intervalos más cortos', () => {
    expect(intervalDays(30, { ...DEFAULT_PARAMS, retention: 0.95 })).toBeLessThan(intervalDays(30, { ...DEFAULT_PARAMS, retention: 0.85 }));
  });

  it('el primer repaso depende de la nota', () => {
    const again = review(newCard(T0), 1, T0);
    const good = review(newCard(T0), 3, T0);
    const easy = review(newCard(T0), 4, T0);
    expect(again.due - T0).toBeLessThan(DAY);
    expect(again.lapses).toBe(1);
    expect(good.due).toBeGreaterThan(again.due);
    expect(easy.due).toBeGreaterThan(good.due);
    expect(easy.difficulty).toBeLessThan(again.difficulty);
  });

  it('acertar a tiempo hace crecer la estabilidad y los intervalos', () => {
    let card = newCard(T0);
    let now = T0;
    const intervals: number[] = [];
    // Cinco repasos: al sexto ya se alcanza el tope de dos años.
    for (let i = 0; i < 5; i++) {
      const before = card.stability;
      card = review(card, 3, now);
      expect(card.stability).toBeGreaterThan(before);
      intervals.push(card.due - now);
      now = card.due;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1] as number);
  });

  it('fallar reduce la estabilidad y adelanta el repaso a minutos', () => {
    const card = simulate([3, 3, 3]);
    const later = (card.due as number) + DAY;
    const failed = review(card, 1, later);
    expect(failed.stability).toBeLessThan(card.stability);
    expect(failed.lapses).toBe(card.lapses + 1);
    expect(failed.due - later).toBeLessThan(DAY);
  });

  it('repetir el mismo día no infla la estabilidad', () => {
    let card = review(newCard(T0), 3, T0);
    const stability = card.stability;
    const due = card.due;
    for (let i = 1; i <= 20; i++) card = review(card, 3, T0 + i * 60_000);
    expect(card.stability).toBe(stability);
    expect(card.due).toBe(due);
    expect(card.reps).toBe(21);
  });

  it('fallar el mismo día sí adelanta el repaso', () => {
    const card = review(newCard(T0), 3, T0);
    const failed = review(card, 1, T0 + 60_000);
    expect(failed.due - (T0 + 60_000)).toBeLessThan(DAY);
    expect(failed.stability).toBe(card.stability);
  });

  it('respeta el intervalo máximo', () => {
    expect(intervalDays(1e9, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.maxIntervalDays);
  });

  it('la dificultad se mantiene dentro de sus límites', () => {
    const hard = simulate(Array(40).fill(1));
    expect(hard.difficulty).toBeLessThanOrEqual(10);
    expect(hard.difficulty).toBeGreaterThanOrEqual(1);
    const easy = simulate(Array(40).fill(4));
    expect(easy.difficulty).toBeLessThanOrEqual(10);
    expect(easy.difficulty).toBeGreaterThanOrEqual(1);
  });

  it('una pregunta bien aprendida acaba dominada', () => {
    expect(isMastered(simulate([1]))).toBe(false);
    expect(isMastered(simulate([3, 3, 3, 3, 3]))).toBe(true);
  });

  it('traduce resultados a notas', () => {
    expect(gradeFromResult({ correct: true })).toBe(3);
    expect(gradeFromResult({ correct: false })).toBe(1);
    expect(gradeFromResult({ correct: null, selfGrade: 2 })).toBe(3);
    expect(gradeFromResult({ correct: null, selfGrade: 1 })).toBe(2);
    expect(gradeFromResult({ correct: null, selfGrade: 0 })).toBe(1);
  });
});
