import { useLiveQuery } from 'dexie-react-hooks';
import type { SubjectDoc } from '@core/schema/taxonomy';
import { isMastered } from '@core/srs/fsrs';
import { buildTaxonomyIndex } from '@core/taxonomy/merge';
import { loadQuestions } from '@/features/bank/questionsRepo';
import { loadSubjects } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { AttemptRow, ProgressRow } from '@/infra/db/types';

/**
 * Cómo vas en cada asignatura, unidad y tema. Como el resto de `localStats`, sólo refleja este
 * dispositivo. Una pregunta en dos temas cuenta en los dos, pero una sola vez en cada unidad y asignatura.
 */

export interface NodeProgress {
  total: number;
  seen: number;
  mastered: number;
  due: number;
  answers: number;
  mcq: number;
  correct: number;
  open: number;
  /** Suma de las autoevaluaciones de desarrollo, de 0 a 1 cada una. */
  openScore: number;
  lastAt: number;
}

export interface TopicProgress extends NodeProgress {
  id: string;
  name: string;
}
export interface UnitProgress extends TopicProgress {
  topics: TopicProgress[];
}
export interface SubjectProgress extends TopicProgress {
  units: UnitProgress[];
}

const empty = (): NodeProgress => ({ total: 0, seen: 0, mastered: 0, due: 0, answers: 0, mcq: 0, correct: 0, open: 0, openScore: 0, lastAt: 0 });

function add(target: NodeProgress, delta: NodeProgress): void {
  target.total += delta.total;
  target.seen += delta.seen;
  target.mastered += delta.mastered;
  target.due += delta.due;
  target.answers += delta.answers;
  target.mcq += delta.mcq;
  target.correct += delta.correct;
  target.open += delta.open;
  target.openScore += delta.openScore;
  target.lastAt = Math.max(target.lastAt, delta.lastAt);
}

/** Aciertos en test y nota en desarrollo, juntos. `null` si aún no se ha respondido nada. */
export function nodeScore(node: NodeProgress): number | null {
  const graded = node.mcq + node.open;
  return graded > 0 ? (node.correct + node.openScore) / graded : null;
}

export function computeSyllabusProgress(subjects: readonly SubjectDoc[], questions: readonly { id: string; subjectId: string; topicIds: readonly string[] }[], attempts: readonly AttemptRow[], progress: readonly ProgressRow[], now: number): SubjectProgress[] {
  const index = buildTaxonomyIndex(subjects);
  const perQuestion = new Map<string, NodeProgress>();
  for (const attempt of attempts) {
    let row = perQuestion.get(attempt.questionId);
    if (!row) perQuestion.set(attempt.questionId, (row = empty()));
    row.answers += 1;
    if (attempt.correct !== null) {
      row.mcq += 1;
      if (attempt.correct) row.correct += 1;
    } else {
      row.open += 1;
      row.openScore += attempt.score;
    }
    row.lastAt = Math.max(row.lastAt, attempt.at);
  }

  const progressById = new Map(progress.map((p) => [p.questionId, p]));
  const nodes = new Map<string, NodeProgress>();
  for (const question of questions) {
    const state = progressById.get(question.id);
    const practised = state !== undefined && state.attempts > 0;
    const delta: NodeProgress = { ...(perQuestion.get(question.id) ?? empty()), total: 1, seen: practised ? 1 : 0, mastered: practised && isMastered(state.card) ? 1 : 0, due: practised && state.due <= now ? 1 : 0 };
    const keys = new Set<string>([question.subjectId]);
    for (const topicId of question.topicIds) {
      const found = index.topics.get(topicId);
      if (!found) continue;
      keys.add(topicId).add(found.unitId).add(found.subjectId);
    }
    for (const key of keys) {
      let node = nodes.get(key);
      if (!node) nodes.set(key, (node = empty()));
      add(node, delta);
    }
  }

  return subjects.flatMap((subject) => {
    const totals = nodes.get(subject.id);
    if (!totals) return [];
    const units = subject.units.flatMap((unit) => {
      const unitTotals = nodes.get(unit.id);
      if (!unitTotals) return [];
      const topics = unit.topics.flatMap((topic) => {
        const topicTotals = nodes.get(topic.id);
        return topicTotals ? [{ ...topicTotals, id: topic.id, name: topic.name }] : [];
      });
      return [{ ...unitTotals, id: unit.id, name: unit.name, topics }];
    });
    return [{ ...totals, id: subject.id, name: subject.name, units }];
  });
}

export type WeakTopic = TopicProgress & { path: string; score: number };

/** Con pocas respuestas un porcentaje no dice nada, y por encima del 80 % no hay nada que reforzar. */
export function weakestTopics(tree: readonly SubjectProgress[], minAnswers = 3, limit = 5): WeakTopic[] {
  return tree
    .flatMap((subject) => subject.units.flatMap((unit) => unit.topics.map((topic) => ({ ...topic, path: `${subject.name} › ${unit.name}`, score: nodeScore(topic) ?? 1 }))))
    .filter((topic) => topic.mcq + topic.open >= minAnswers && topic.score < 0.8)
    .sort((a, b) => a.score - b.score || b.answers - a.answers)
    .slice(0, limit);
}

export function useSyllabusProgress(): SubjectProgress[] | undefined {
  return useLiveQuery(async () => {
    const [subjects, questions, attempts, progress] = await Promise.all([loadSubjects(), loadQuestions(), db.attempts.toArray(), db.progress.toArray()]);
    return computeSyllabusProgress(subjects, questions, attempts, progress, Date.now());
  }, []);
}
