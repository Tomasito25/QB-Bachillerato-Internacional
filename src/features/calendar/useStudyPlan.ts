import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { findPaper } from '@core/exams/papers';
import { buildPlan, type PlanExam, type PlanTopic, type StudyPlan } from '@core/study/plan';
import { preferences } from '@/features/settings/preferences';
import { localDay } from '@/features/study/localStats';
import { nodeScore, useSyllabusProgress, type SubjectProgress } from '@/features/study/syllabusProgress';
import { db } from '@/infra/db/db';
import type { ExamRow } from '@/infra/db/types';

export function toPlanTopics(tree: readonly SubjectProgress[]): PlanTopic[] {
  return tree.flatMap((subject) => subject.units.flatMap((unit) => unit.topics.map((topic) => ({ id: topic.id, name: topic.name, subjectId: subject.id, total: topic.total, seen: topic.seen, mastered: topic.mastered, due: topic.due, score: nodeScore(topic) }))));
}

export function toPlanExam(exam: ExamRow): PlanExam {
  return { id: exam.id, title: exam.title, kind: exam.kind, date: exam.date, subjectId: exam.subjectId, topicIds: exam.topicIds, paperMinutes: findPaper(exam.paperId)?.paper.minutes ?? null };
}

export interface ExamProgress {
  total: number;
  mastered: number;
  seen: number;
}

/** Cuánto llevas de lo que entra en ese examen. */
export function examProgress(exam: ExamRow, topics: readonly PlanTopic[]): ExamProgress {
  const inExam = topics.filter((topic) => topic.subjectId === exam.subjectId && (exam.topicIds.length === 0 || exam.topicIds.includes(topic.id)));
  return { total: inExam.reduce((s, t) => s + t.total, 0), mastered: inExam.reduce((s, t) => s + t.mastered, 0), seen: inExam.reduce((s, t) => s + t.seen, 0) };
}

export interface PlanData {
  plan: StudyPlan;
  exams: ExamRow[];
  topics: PlanTopic[];
  today: string;
  doneToday: number;
}

export function useExams(): ExamRow[] | undefined {
  return useLiveQuery(() => db.exams.orderBy('date').toArray(), []);
}

export function useStudyPlan(): PlanData | undefined {
  const exams = useExams();
  const tree = useSyllabusProgress();
  const { planMinutes, planRestDays } = preferences.use();
  const today = localDay(Date.now());
  const doneToday = useLiveQuery(() => {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    return db.attempts.where('at').aboveOrEqual(new Date(y, m - 1, d).getTime()).count();
  }, [today]);
  return useMemo(() => {
    if (!exams || !tree || doneToday === undefined) return undefined;
    const topics = toPlanTopics(tree);
    return { plan: buildPlan({ today, exams: exams.map(toPlanExam), topics, minutesPerDay: planMinutes, restDays: planRestDays, doneToday }), exams, topics, today, doneToday };
  }, [exams, tree, doneToday, today, planMinutes, planRestDays]);
}
