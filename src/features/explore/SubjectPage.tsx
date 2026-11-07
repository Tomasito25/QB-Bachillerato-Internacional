import { ArrowLeft, GraduationCap, Library, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bankStats } from '@core/questions/stats';
import { useQuestions } from '@/features/bank/questionsRepo';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { ButtonLink } from '@/ui/Button';
import { Card, EmptyState, PageHeader, Spinner } from '@/ui/Surface';

export default function SubjectPage() {
  const { subjectId } = useParams();
  const taxonomy = useTaxonomy();
  const questions = useQuestions();
  const stats = useMemo(() => (questions && taxonomy ? bankStats(questions, taxonomy.index) : null), [questions, taxonomy]);
  if (!taxonomy || !stats) return <Spinner />;
  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  if (!subject) {
    return <EmptyState title="No se encuentra esta asignatura" action={<ButtonLink to="/explore" variant="primary">Volver a explorar</ButtonLink>} />;
  }
  const units = [...subject.units].sort((a, b) => a.order - b.order);
  const count = stats.bySubject.get(subject.id) ?? 0;
  return (
    <>
      <Link to="/explore" className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        Explorar
      </Link>
      <PageHeader
        title={subject.name}
        description={subject.description}
        actions={
          <>
            <ButtonLink to={`/bank?subject=${subject.id}`} icon={<Library size={16} aria-hidden />}>
              {count} {count === 1 ? 'pregunta' : 'preguntas'}
            </ButtonLink>
            <ButtonLink to={`/create?subject=${subject.id}`} icon={<Plus size={16} aria-hidden />}>
              Añadir
            </ButtonLink>
            {count > 0 ? (
              <ButtonLink to={`/study?subject=${subject.id}`} variant="primary" icon={<GraduationCap size={16} aria-hidden />}>
                Estudiar
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {units.length === 0 ? (
        <EmptyState title="Esta asignatura aún no tiene unidades" action={<ButtonLink to="/subjects" variant="primary">Organizar el temario</ButtonLink>} />
      ) : (
        <div className="flex flex-col gap-3">
          {units.map((unit, unitIndex) => (
            <Card key={unit.id}>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <h2 className="min-w-0 text-sm font-semibold">
                  <span className="font-normal text-muted tabular-nums">Unidad {unitIndex + 1} · </span>
                  {unit.name}
                </h2>
                <Link to={`/bank?subject=${subject.id}&unit=${unit.id}`} className="shrink-0 text-xs text-muted tabular-nums hover:text-ink hover:underline">
                  {stats.byUnit.get(unit.id) ?? 0} preguntas
                </Link>
              </div>
              {unit.topics.length > 0 ? (
                <ul className="divide-y divide-border">
                  {[...unit.topics]
                    .sort((a, b) => a.order - b.order)
                    .map((topic, topicIndex) => {
                      const topicCount = stats.byTopic.get(topic.id) ?? 0;
                      return (
                        <li key={topic.id}>
                          <Link to={`/bank?subject=${subject.id}&topic=${topic.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-[0.84375rem] hover:bg-subtle/60">
                            <span className="min-w-0">
                              <span className="text-muted tabular-nums">
                                {unitIndex + 1}.{topicIndex + 1}{' '}
                              </span>
                              {topic.name}
                            </span>
                            <span className="shrink-0 text-xs text-muted tabular-nums">{topicCount}</span>
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <p className="px-4 py-3 text-[0.8125rem] text-muted">Sin temas todavía.</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
