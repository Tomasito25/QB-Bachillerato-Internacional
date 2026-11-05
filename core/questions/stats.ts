import type { Difficulty } from '../schema/common.ts';
import type { Question, QuestionType } from '../schema/question.ts';
import type { TaxonomyIndex } from '../taxonomy/merge.ts';

export interface BankStats {
  total: number;
  byDifficulty: Record<Difficulty, number>;
  byType: Record<QuestionType, number>;
  bySubject: Map<string, number>;
  byUnit: Map<string, number>;
  byTopic: Map<string, number>;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Una pregunta en dos temas cuenta en los dos, pero una sola vez en cada unidad y asignatura. */
export function bankStats(questions: readonly Question[], index: TaxonomyIndex): BankStats {
  const stats: BankStats = {
    total: questions.length,
    byDifficulty: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byType: { mcq: 0, open: 0 },
    bySubject: new Map(),
    byUnit: new Map(),
    byTopic: new Map(),
  };
  for (const question of questions) {
    stats.byDifficulty[question.difficulty] += 1;
    stats.byType[question.type] += 1;
    const subjects = new Set<string>([question.subjectId]);
    const units = new Set<string>();
    for (const topicId of question.topicIds) {
      bump(stats.byTopic, topicId);
      const entry = index.topics.get(topicId);
      if (entry) {
        units.add(entry.unitId);
        subjects.add(entry.subjectId);
      }
    }
    for (const unitId of units) bump(stats.byUnit, unitId);
    for (const subjectId of subjects) bump(stats.bySubject, subjectId);
  }
  return stats;
}
