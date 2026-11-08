/** Lo que no depende de React en las marcas de la interfaz: se prueba aparte. */

/** Todas dan al menos 4,5:1 con el blanco. El color sale del id: no cambia aunque cambie el orden. */
const INKS = ['#0b2bff', '#c4006a', '#00803c', '#c83400', '#6a14ff', '#00707f'] as const;

export function markColor(id: string): string {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return INKS[hash % INKS.length] ?? INKS[0];
}

export function subjectCode(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const first = words[0] ?? '?';
  return `${first[0]}${words[1]?.[0] ?? first[1] ?? ''}`.toUpperCase();
}

/** «A. Ondas» se parte en su letra y su nombre. Sin letra, el código sale de su posición. */
export function unitParts(name: string, index: number): { code: string; name: string } {
  const match = /^([\p{Lu}\d]{1,3})[.)]\s+(.+)$/u.exec(name.trim());
  return match?.[1] && match[2] ? { code: match[1], name: match[2] } : { code: String(index + 1), name };
}

/** Las dos primeras mayúsculas del nombre de la app, o sus dos primeras letras. */
export function monogram(name: string): string {
  const capitals = name.match(/\p{Lu}/gu) ?? [];
  return capitals.length >= 2 ? capitals.slice(0, 2).join('') : name.trim().slice(0, 2).toUpperCase();
}

export function bandPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
}
