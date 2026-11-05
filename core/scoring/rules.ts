/**
 * Reglas de puntuación. Un solo fichero: aquí se discute y se cambia el equilibrio del juego.
 *
 * Están pensadas para premiar aprender, no acumular:
 *   - Repetir la misma pregunta rinde cada vez menos y, a la cuarta, nada.
 *   - Hay topes diarios en todo lo que se puede repetir.
 *   - Lo que no se puede verificar (desarrollo) apenas suma.
 *   - Tus propias preguntas no dan puntos.
 */
export const RULES = {
  correctByDifficulty: { 1: 2, 2: 3, 3: 5, 4: 8, 5: 12 } as Record<number, number>,
  repeatFactors: [1, 0.5, 0.25] as readonly number[],
  minHoursBetweenAwards: 20,
  dailyAnswerCap: 200,
  selfGraded: 1,
  selfGradedDailyCap: 20,
  sessionComplete: 5,
  sessionMinAnswers: 10,
  sessionsPerDay: 3,
  questionApproved: 15,
  approvedPerDay: 5,
  questionUsed: 1,
  usedPerQuestion: 30,
  usedPerDay: 50,
  competitionParticipation: 10,
  duelWin: 15,
  podium: [30, 20, 10] as readonly number[],
  podiumMinParticipants: 3,
  tournamentChampion: 30,
  tournamentFinalist: 20,
  streakDayMinAnswers: 5,
  streakBonuses: { 3: 5, 7: 15, 30: 50 } as Record<number, number>,
  /** Por debajo de esto no ha dado tiempo a leer: la respuesta no cuenta. */
  minAnswerMs: 500,
  /** Sospechoso: casi todo bien y a una velocidad que no permite leer. */
  suspectMinAnswers: 30,
  suspectMedianMs: 1500,
  suspectAccuracy: 0.9,
  /** Mínimo de respuestas para entrar en el ranking de rendimiento. */
  performanceMinAnswers: 30,
  leaderboardSize: 100,
} as const;

/**
 * Nivel a partir de los puntos. Crece con la raíz: cada nivel cuesta algo más que el anterior,
 * sin hacerse inalcanzable. 25 pts → 2, 100 → 3, 225 → 4, 1 000 → 7, 10 000 → 21.
 */
export function levelFromPoints(points: number): number {
  return Math.floor(Math.sqrt(Math.max(0, points) / 25)) + 1;
}

export function pointsForLevel(level: number): number {
  return (level - 1) * (level - 1) * 25;
}

/**
 * Límite inferior del intervalo de Wilson al 95 %. Para ordenar por precisión sin que 10/10
 * gane a 950/1000: premia también la evidencia, no sólo el porcentaje.
 */
export function wilsonLowerBound(successes: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return Math.max(0, (centre - margin) / denominator);
}
