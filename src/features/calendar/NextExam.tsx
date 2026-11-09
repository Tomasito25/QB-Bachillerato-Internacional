import { Link } from 'react-router-dom';
import { daysBetween } from '@core/study/plan';
import { untilLabel } from './format';
import { useStudyPlan } from './useStudyPlan';

/** Una línea: cuánto falta y qué toca hoy. */
export function NextExam() {
  const data = useStudyPlan();
  const next = data?.exams.find((exam) => exam.date >= data.today);
  if (!data) return null;
  if (!next) {
    return (
      <p className="mt-4 text-[0.8125rem] text-muted">
        ¿Tienes un mock o un examen a la vista?{' '}
        <Link to="/calendar" className="font-semibold underline">
          Añádelo y te hago un plan
        </Link>
      </p>
    );
  }
  const days = daysBetween(data.today, next.date);
  const blocks = data.plan.days[0]?.blocks.filter((block) => block.kind !== 'exam') ?? [];
  return (
    <Link to="/calendar" className="group mt-6 flex max-w-5xl flex-wrap items-baseline gap-x-4 gap-y-1 border-t-2 border-ink pt-3">
      <span className="qb-heading">
        {next.title}: {untilLabel(days).toLowerCase()}
      </span>
      <span className="min-w-0 text-[0.9375rem] text-muted group-hover:underline">{blocks.length > 0 ? `Hoy: ${blocks.map((block) => block.title).join(' · ')}` : 'Por hoy ya has hecho lo previsto.'}</span>
    </Link>
  );
}
