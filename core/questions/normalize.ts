import type { Question } from '../schema/question.ts';
import { sha256Hex } from '../util/encoding.ts';

/** Quita marcas de Markdown y LaTeX que no cambian el sentido para comparar y buscar. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[a-z0-9]*\n?/gi, ' ')
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forma canónica: sin mayúsculas, sin acentos, sin puntuación. */
export function normalizeText(text: string): string {
  return plainText(text)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizedName(name: string): string {
  return normalizeText(name);
}

function partStatements(question: Extract<Question, { type: 'open' }>): string[] {
  return (question.parts ?? []).flatMap((part) => [part.statement, ...(part.subparts ?? []).map((sub) => sub.statement)]).filter(Boolean);
}

function comparableParts(question: Question): string[] {
  const parts = [normalizeText(question.statement)];
  if (question.type === 'mcq') {
    // Ordenadas: cambiar el orden de las opciones no hace distinta a una pregunta.
    parts.push(...question.answers.map((a) => normalizeText(a.text)).sort());
  } else {
    // En orden: los apartados de un examen no se pueden barajar.
    parts.push(...partStatements(question).map(normalizeText));
  }
  return parts;
}

/** Huella para detectar copias exactas, sin depender del orden ni de la tipografía. */
export function questionFingerprint(question: Question): Promise<string> {
  return sha256Hex(`${question.type}\n${comparableParts(question).join('\n')}`);
}

function shingles(text: string): Set<string> {
  const words = text.split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length === 1 && words[0]) out.add(words[0]);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) common += 1;
  return common / (a.size + b.size - common);
}

export const NEAR_DUPLICATE_THRESHOLD = 0.85;

/** Enunciados demasiado cortos dan falsos positivos: «¿Qué es X?» se parece a «¿Qué es Y?». */
const MIN_WORDS_FOR_SIMILARITY = 6;

export interface DuplicateMatch {
  id: string;
  similarity: number;
  exact: boolean;
}

export interface DuplicateIndexEntry {
  id: string;
  statement: string;
  shingles: Set<string>;
  words: number;
}

const duplicateCache = new WeakMap<Question, DuplicateIndexEntry>();

export function duplicateIndexEntry(question: Question): DuplicateIndexEntry {
  let entry = duplicateCache.get(question);
  if (!entry) {
    const statement = comparableParts(question).join(' ');
    entry = { id: question.id, statement, shingles: shingles(statement), words: statement.split(' ').filter(Boolean).length };
    duplicateCache.set(question, entry);
  }
  return entry;
}

/** Busca copias exactas y casi exactas de `question` en `others`. Ignora su propio id. */
export function findDuplicates(question: Question, others: Iterable<DuplicateIndexEntry>): DuplicateMatch[] {
  const self = duplicateIndexEntry(question);
  const matches: DuplicateMatch[] = [];
  for (const other of others) {
    if (other.id === question.id) continue;
    if (other.statement === self.statement) {
      matches.push({ id: other.id, similarity: 1, exact: true });
      continue;
    }
    if (self.words < MIN_WORDS_FOR_SIMILARITY || other.words < MIN_WORDS_FOR_SIMILARITY) continue;
    // Atajo: si el tamaño ya impide llegar al umbral, no hace falta comparar.
    const ratio = Math.min(self.shingles.size, other.shingles.size) / Math.max(self.shingles.size, other.shingles.size);
    if (ratio < NEAR_DUPLICATE_THRESHOLD) continue;
    const similarity = jaccard(self.shingles, other.shingles);
    if (similarity >= NEAR_DUPLICATE_THRESHOLD) matches.push({ id: other.id, similarity, exact: false });
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Texto en el que se busca: enunciado, opciones, etiquetas y palabras clave. Las explicaciones
 * y respuestas modelo se dejan fuera: encarecen la búsqueda y dan coincidencias de ruido.
 */
export function searchableText(question: Question): string {
  const parts = [question.statement, question.tags.join(' ')];
  if (question.type === 'mcq') parts.push(...question.answers.map((a) => a.text));
  else parts.push(question.keywords.join(' '), ...partStatements(question));
  return normalizeText(parts.join(' '));
}
