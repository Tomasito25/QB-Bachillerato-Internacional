import { ChevronRight, Compass, Search } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bankStats, type BankStats } from '@core/questions/stats';
import { excerpt, useQuestions, type ViewQuestion } from '@/features/bank/questionsRepo';
import { DifficultyBadge, TypeBadge } from '@/features/bank/parts';
import { useTaxonomy, type TaxonomyView } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { ButtonLink } from '@/ui/Button';
import { Input } from '@/ui/Field';
import { Card, CardHeader, EmptyState, PageHeader, Spinner } from '@/ui/Surface';

function SubjectCard({ subject, stats }: { subject: TaxonomyView['subjects'][number]; stats: BankStats }) {
  const count = stats.bySubject.get(subject.id) ?? 0;
  const topics = subject.units.reduce((sum, unit) => sum + unit.topics.length, 0);
  return (
    <Link to={`/explore/${subject.id}`} className="group flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span className="truncate">{subject.name}</span>
        <ChevronRight size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      {subject.description ? <span className="line-clamp-2 text-[13px] text-muted">{subject.description}</span> : null}
      <span className="mt-1 text-xs text-muted tabular-nums">
        {count} {count === 1 ? 'pregunta' : 'preguntas'} · {subject.units.length} {subject.units.length === 1 ? 'unidad' : 'unidades'} · {topics} {topics === 1 ? 'tema' : 'temas'}
      </span>
    </Link>
  );
}

function QuestionList({ title, description, questions }: { title: string; description?: string; questions: readonly ViewQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-border">
        {questions.map((question) => (
          <li key={question.id} className="px-4 py-2.5">
            <Link to={`/q/${question.id}`} className="text-[13.5px] leading-snug hover:text-accent-text">
              {excerpt(question.statement, 110)}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <TypeBadge type={question.type} />
              <DifficultyBadge value={question.difficulty} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ExplorePage() {
  const taxonomy = useTaxonomy();
  const questions = useQuestions();
  const popularIds = useLiveQuery(async () => (await db.dQuestionStats.orderBy('questionId').toArray()).filter((s) => s.answers > 0).sort((a, b) => b.uniqueUsers - a.uniqueUsers || b.answers - a.answers).slice(0, 5).map((s) => s.questionId), []);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const stats = useMemo(() => (questions && taxonomy ? bankStats(questions, taxonomy.index) : null), [questions, taxonomy]);
  const recent = useMemo(() => [...(questions ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), [questions]);
  const popular = useMemo(() => {
    const byId = new Map(questions?.map((q) => [q.id, q]));
    return (popularIds ?? []).map((id) => byId.get(id)).filter((q): q is ViewQuestion => Boolean(q));
  }, [questions, popularIds]);

  if (!taxonomy || !stats) return <Spinner />;

  return (
    <>
      <PageHeader title="Explorar" description="Navega por asignaturas, unidades y temas, o busca directamente." actions={<ButtonLink to="/subjects">Gestionar temario</ButtonLink>} />
      <form
        role="search"
        className="relative mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/bank?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Search size={15} className="pointer-events-none absolute top-2.5 left-2.5 text-faint" aria-hidden />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar preguntas…" aria-label="Buscar preguntas" className="pl-8" />
      </form>

      {taxonomy.subjects.length === 0 ? (
        <EmptyState
          icon={<Compass size={28} aria-hidden />}
          title="Todavía no hay asignaturas aquí"
          action={
            <>
              <ButtonLink to="/sync" variant="primary">
                Descargar de la comunidad
              </ButtonLink>
              <ButtonLink to="/subjects">Crear una asignatura</ButtonLink>
            </>
          }
        >
          Descarga lo que ha publicado la comunidad o empieza tu propio temario.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <section aria-label="Asignaturas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {taxonomy.subjects.map((subject) => (
              <SubjectCard key={subject.id} subject={subject} stats={stats} />
            ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <QuestionList title="Más usadas" description="Las que más personas han respondido." questions={popular} />
            <QuestionList title="Recientes" questions={recent} />
          </div>
        </div>
      )}
    </>
  );
}
