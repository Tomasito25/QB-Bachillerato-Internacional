const local = (date: string) => new Date(`${date}T12:00:00`);
const long = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const medium = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const monthName = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });

export const formatLong = (date: string): string => long.format(local(date));
export const formatMedium = (date: string): string => medium.format(local(date));
export const formatMonth = (date: string): string => monthName.format(local(date));

export function untilLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `Faltan ${days} días`;
}
