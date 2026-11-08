import type { Question } from '../schema/question.ts';
import { selectBalanced } from '../study/select.ts';
import { shuffle } from '../util/rng.ts';
import type { Paper, PaperPart } from './papers.ts';

/** Sin puntos escritos no se puede saber cuánto vale: se cuenta como una pregunta media. */
const UNMARKED_QUESTION = 5;

export function questionMarks(question: Question): number {
  if (question.type === 'mcq') return 1;
  const parts = question.parts ?? [];
  const total = parts.reduce((sum, part) => sum + (part.subparts ? part.subparts.reduce((s, sub) => s + (sub.marks ?? 1), 0) : (part.marks ?? 1)), 0);
  return total > 0 ? total : UNMARKED_QUESTION;
}

/** Turnándose entre temas, para que el examen no se llene de un solo tema. */
function roundRobin<T extends { topicIds: readonly string[] }>(pool: readonly T[], random: () => number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of shuffle(pool, random)) {
    const key = item.topicIds[0] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queues = shuffle([...groups.values()], random);
  const out: T[] = [];
  while (out.length < pool.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

function pickOpen(part: PaperPart, pool: readonly Question[], random: () => number): Question[] {
  const tagged = part.preferTag ? pool.filter((q) => q.tags.includes(part.preferTag as string)) : [];
  const others = pool.filter((q) => !tagged.includes(q));
  const chosen: Question[] = [];
  let marks = 0;
  for (const question of [...roundRobin(tagged, random), ...roundRobin(others, random)]) {
    const value = questionMarks(question);
    if (marks + value > part.marks) continue;
    chosen.push(question);
    marks += value;
    if (marks === part.marks) break;
  }
  return chosen;
}

export interface AssembledPart {
  label: string;
  kind: PaperPart['kind'];
  ids: string[];
  /** Lo conseguido y lo que pide la prueba: preguntas en test, puntos en desarrollo. */
  got: number;
  wanted: number;
}

export function assemblePaper(paper: Paper, pool: readonly Question[], random: () => number = Math.random): AssembledPart[] {
  const used = new Set<string>();
  return paper.parts.map((part) => {
    const available = pool.filter((q) => q.type === part.kind && !used.has(q.id));
    const chosen = part.kind === 'mcq' ? selectBalanced(available, part.count ?? part.marks, random) : pickOpen(part, available, random);
    for (const question of chosen) used.add(question.id);
    return {
      label: part.label,
      kind: part.kind,
      ids: chosen.map((q) => q.id),
      got: part.kind === 'mcq' ? chosen.length : chosen.reduce((sum, q) => sum + questionMarks(q), 0),
      wanted: part.kind === 'mcq' ? (part.count ?? part.marks) : part.marks,
    };
  });
}
