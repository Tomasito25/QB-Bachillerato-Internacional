import { seededRandom, shuffle } from '../util/rng.ts';

/** Qué se elige para cada sesión. Es lógica pura: se prueba con azar determinista. */

export interface SelectionProgress {
  due: number;
  attempts: number;
  lastCorrect: boolean | null;
}

/** Peso de cada pregunta en una práctica: importa más lo que toca repasar o se falló. */
function practiceWeight(progress: SelectionProgress | undefined, now: number): number {
  if (!progress || progress.attempts === 0) return 3;
  if (progress.lastCorrect === false) return 5;
  if (progress.due <= now) return 6;
  return 1;
}

/**
 * Muestreo ponderado sin reemplazo (Efraimidis-Spirakis): cada elemento recibe la clave
 * `u^(1/peso)` y se quedan los mayores. Sigue habiendo azar: un peso alto favorece, no obliga.
 */
export function selectPractice<T extends { id: string }>(
  pool: readonly T[],
  count: number,
  progress: ReadonlyMap<string, SelectionProgress>,
  now: number,
  random: () => number = Math.random,
): T[] {
  return pool
    .map((item) => ({ item, key: Math.pow(random(), 1 / practiceWeight(progress.get(item.id), now)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((entry) => entry.item);
}

/** Reparte el examen entre temas: sin esto, un tema con muchas preguntas se llevaría casi todo. */
export function selectBalanced<T extends { id: string; topicIds: readonly string[] }>(
  pool: readonly T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of shuffle(pool, random)) {
    const key = item.topicIds[0] ?? '';
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const queues = shuffle([...groups.values()], random);
  const out: T[] = [];
  while (out.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) out.push(next);
      if (out.length === count) break;
    }
  }
  return shuffle(out, random);
}

/** Lo más urgente primero: lo que lleva más tiempo vencido. */
export function selectDue<T extends { id: string }>(
  pool: readonly T[],
  count: number,
  progress: ReadonlyMap<string, SelectionProgress>,
  now: number,
): T[] {
  return pool
    .filter((item) => {
      const row = progress.get(item.id);
      return row !== undefined && row.attempts > 0 && row.due <= now;
    })
    .sort((a, b) => (progress.get(a.id)?.due ?? 0) - (progress.get(b.id)?.due ?? 0))
    .slice(0, count);
}

/**
 * Orden de las opciones para esta sesión. Evita memorizar «la de arriba». Con semilla: al
 * recargar a mitad de sesión las opciones no se mueven.
 */
export function shuffledOptions<T>(options: readonly T[], sessionId: string, questionId: string): T[] {
  return shuffle(options, seededRandom(`${sessionId}:${questionId}`));
}
