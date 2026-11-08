import type { Difficulty } from '../schema/common.ts';
import type { Question, QuestionType } from '../schema/question.ts';
import type { TaxonomyIndex } from '../taxonomy/merge.ts';
import { normalizeText, searchableText } from './normalize.ts';

/** Filtros combinables. Se usan al explorar, al crear sesiones y al elegir preguntas de competición. */
export interface QuestionFilter {
  subjectId?: string;
  unitIds?: readonly string[];
  topicIds?: readonly string[];
  difficulties?: readonly Difficulty[];
  types?: readonly QuestionType[];
  tag?: string;
  text?: string;
}

/** Qué parte del temario entra al estudiar: todo, sólo unos temas, o todos menos esos. */
export interface StudyScope {
  mode: 'all' | 'only' | 'block';
  topicIds: readonly string[];
}

/** Una lista vacía no filtra: «sólo» sin nada marcado dejaría sin preguntas por un descuido. */
export function scopePredicate(scope: StudyScope): (question: { topicIds: readonly string[] }) => boolean {
  if (scope.mode === 'all' || scope.topicIds.length === 0) return () => true;
  const chosen = new Set(scope.topicIds);
  const touches = (question: { topicIds: readonly string[] }) => question.topicIds.some((id) => chosen.has(id));
  return scope.mode === 'only' ? touches : (question) => !touches(question);
}

const searchCache = new WeakMap<Question, string>();

function searchTextOf(question: Question): string {
  let text = searchCache.get(question);
  if (text === undefined) {
    text = searchableText(question);
    searchCache.set(question, text);
  }
  return text;
}

/** Una pregunta puede estar en temas de varias asignaturas: cuenta en todas. */
export function questionInSubject(question: Question, subjectId: string, index: TaxonomyIndex): boolean {
  if (question.subjectId === subjectId) return true;
  return question.topicIds.some((id) => index.topics.get(id)?.subjectId === subjectId);
}

export function questionInUnits(question: Question, unitIds: ReadonlySet<string>, index: TaxonomyIndex): boolean {
  return question.topicIds.some((id) => {
    const unitId = index.topics.get(id)?.unitId;
    return unitId !== undefined && unitIds.has(unitId);
  });
}

export function matchesFilter(question: Question, filter: QuestionFilter, index: TaxonomyIndex): boolean {
  if (filter.subjectId && !questionInSubject(question, filter.subjectId, index)) return false;
  if (filter.unitIds?.length && !questionInUnits(question, new Set(filter.unitIds), index)) return false;
  if (filter.topicIds?.length && !question.topicIds.some((id) => filter.topicIds?.includes(id))) return false;
  if (filter.difficulties?.length && !filter.difficulties.includes(question.difficulty)) return false;
  if (filter.types?.length && !filter.types.includes(question.type)) return false;
  if (filter.tag && !question.tags.some((t) => normalizeText(t) === normalizeText(filter.tag as string))) return false;
  if (filter.text) {
    const haystack = searchTextOf(question);
    for (const word of normalizeText(filter.text).split(' ')) {
      if (word && !haystack.includes(word)) return false;
    }
  }
  return true;
}

export function filterQuestions<T extends Question>(questions: readonly T[], filter: QuestionFilter, index: TaxonomyIndex): T[] {
  return questions.filter((q) => matchesFilter(q, filter, index));
}
