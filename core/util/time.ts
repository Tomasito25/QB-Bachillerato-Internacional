/**
 * Tiempo. Todo lo oficial se agrupa en UTC para que el resultado no dependa de la zona
 * horaria de quien lo calcula.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function dayKey(ms: number): string {
  return toIso(ms).slice(0, 10);
}

export function monthKey(ms: number): string {
  return toIso(ms).slice(0, 7);
}

/** Lunes 00:00 UTC de la semana ISO que contiene `ms`. */
export function startOfIsoWeek(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (d.getUTCDay() + 6) % 7;
  return midnight - weekday * DAY;
}

/** Clave ISO 8601 de semana, como `2026-W45`. El año es el del jueves de esa semana. */
export function weekKey(ms: number): string {
  const thursday = startOfIsoWeek(ms) + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const firstThursday = startOfIsoWeek(Date.UTC(year, 0, 4)) + 3 * DAY;
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function dayIndex(ms: number): number {
  return Math.floor(ms / DAY);
}
