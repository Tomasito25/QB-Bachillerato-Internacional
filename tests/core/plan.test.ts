import { describe, expect, it } from 'vitest';
import { addDays, buildPlan, daysBetween, weekdayOf, type PlanBlock, type PlanExam, type PlanInput, type PlanTopic } from '@core/study/plan';

const topic = (id: string, over: Partial<PlanTopic> = {}): PlanTopic => ({ id, name: id, subjectId: 's', total: 20, seen: 0, mastered: 0, due: 0, score: null, ...over });
const exam = (id: string, date: string, over: Partial<PlanExam> = {}): PlanExam => ({ id, title: id, kind: 'mock', date, subjectId: 's', topicIds: [], paperMinutes: null, ...over });
const input = (over: Partial<PlanInput>): PlanInput => ({ today: '2027-01-04', exams: [exam('e', '2027-02-01')], topics: [topic('a'), topic('b')], minutesPerDay: 50, restDays: [], doneToday: 0, ...over });

const study = (blocks: PlanBlock[]) => blocks.filter((block): block is Extract<PlanBlock, { kind: 'study' }> => block.kind === 'study');
const planned = (plan: ReturnType<typeof buildPlan>, topicId: string) => plan.days.flatMap((day) => study(day.blocks)).filter((block) => block.topicId === topicId).reduce((sum, block) => sum + block.count, 0);

describe('calendario de estudio', () => {
  it('cuenta los días sin que le afecte el cambio de hora', () => {
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
    expect(addDays('2027-03-28', 1)).toBe('2027-03-29');
    expect(weekdayOf('2027-01-03')).toBe(0);
  });

  it('sin exámenes futuros no hay plan', () => {
    expect(buildPlan(input({ exams: [exam('viejo', '2026-12-01')] })).days).toEqual([]);
  });

  it('reparte todo lo que entra antes del examen y marca el día del examen', () => {
    const plan = buildPlan(input({}));
    expect(planned(plan, 'a')).toBe(20);
    expect(planned(plan, 'b')).toBe(20);
    expect(plan.shortfalls).toEqual([]);
    const last = plan.days[plan.days.length - 1];
    expect(last?.date).toBe('2027-02-01');
    expect(last?.blocks).toEqual([{ kind: 'exam', examId: 'e', title: 'e', examKind: 'mock' }]);
  });

  it('sólo incluye lo que entra en ese examen', () => {
    const plan = buildPlan(input({ exams: [exam('e', '2027-02-01', { topicIds: ['a'] })] }));
    expect(planned(plan, 'a')).toBe(20);
    expect(planned(plan, 'b')).toBe(0);
  });

  it('no pone nada en los días libres ni pasa de lo que cabe al día', () => {
    const plan = buildPlan(input({ restDays: [0, 6], topics: [topic('a', { total: 80 }), topic('b', { total: 80 }), topic('c', { total: 80 })] }));
    for (const day of plan.days) {
      if (day.rest) expect(day.blocks).toEqual([]);
      const total = day.blocks.reduce((sum, block) => sum + (block.kind === 'study' || block.kind === 'review' ? block.count : 0), 0);
      expect(total).toBeLessThanOrEqual(plan.capacity);
      expect(new Set(study(day.blocks).map((b) => b.topicId)).size).toBeLessThanOrEqual(3);
    }
  });

  it('lo que peor va se trabaja primero, y lo dominado no vuelve', () => {
    const plan = buildPlan(input({ topics: [topic('bien', { seen: 20, mastered: 18, score: 0.9 }), topic('mal', { seen: 10, mastered: 2, score: 0.3, total: 10 })] }));
    expect(planned(plan, 'bien')).toBe(0);
    expect(planned(plan, 'mal')).toBe(8);
    expect(study(plan.days[0]?.blocks ?? [])[0]?.reason).toBe('weak');
  });

  it('lo hecho hoy se descuenta de hoy', () => {
    const capacity = buildPlan(input({})).capacity;
    expect(buildPlan(input({ doneToday: capacity })).days[0]?.blocks).toEqual([]);
  });

  it('el repaso de hoy es lo que toca de verdad', () => {
    const plan = buildPlan(input({ topics: [topic('a', { seen: 20, mastered: 20, score: 1, due: 3 })] }));
    expect(plan.days[0]?.blocks).toEqual([{ kind: 'review', title: 'Repaso espaciado', count: 3 }]);
  });

  it('ensaya la prueba entera antes del examen si se sabe cuánto dura', () => {
    const plan = buildPlan(input({ exams: [exam('e', '2027-02-01', { paperMinutes: 90 })] }));
    const mocks = plan.days.filter((day) => day.blocks.some((block) => block.kind === 'mock')).map((day) => day.date);
    expect(mocks).toEqual(['2027-01-18', '2027-01-25', '2027-01-29']);
  });

  it('si un ensayo cae en día libre, se adelanta', () => {
    // El 2027-01-18 es lunes.
    const plan = buildPlan(input({ restDays: [1], exams: [exam('e', '2027-02-01', { paperMinutes: 90 })] }));
    const dates = plan.days.filter((day) => day.blocks.some((block) => block.kind === 'mock')).map((day) => day.date);
    expect(dates[0]).toBe('2027-01-17');
    expect(dates.every((date) => weekdayOf(date) !== 1)).toBe(true);
  });

  it('un tema de dos exámenes se prepara para el primero', () => {
    const plan = buildPlan(input({ exams: [exam('final', '2027-03-01'), exam('mock', '2027-01-20')], topics: [topic('a')] }));
    const blocks = plan.days.flatMap((day) => study(day.blocks));
    expect(blocks.every((block) => block.examId === 'mock')).toBe(true);
  });

  it('dice cuánto no cabe y con qué tiempo cabría', () => {
    const big = input({ exams: [exam('e', '2027-01-08')], topics: [topic('a', { total: 300 })], minutesPerDay: 25 });
    const plan = buildPlan(big);
    expect(plan.shortfalls[0]?.questions).toBeGreaterThan(0);
    const better = buildPlan({ ...big, minutesPerDay: plan.shortfalls[0]?.minutesNeeded ?? 0 });
    expect(better.shortfalls).toEqual([]);
  });

  it('un examen hoy no deja estudio para hoy', () => {
    const plan = buildPlan(input({ exams: [exam('e', '2027-01-04')] }));
    expect(plan.days).toHaveLength(1);
    expect(study(plan.days[0]?.blocks ?? [])).toEqual([]);
  });
});
