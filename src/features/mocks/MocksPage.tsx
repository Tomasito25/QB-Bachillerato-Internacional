import { Clock, Play } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { assemblePaper, questionMarks } from '@core/exams/assemble';
import { detectFormat, EXAM_FORMATS, findPaper, paperMarks, type Paper } from '@core/exams/papers';
import { questionInSubject } from '@core/questions/filter';
import type { Question } from '@core/schema/question';
import { toQuestion, useQuestions } from '@/features/bank/questionsRepo';
import { useExams } from '@/features/calendar/useStudyPlan';
import { useLaunchSession } from '@/features/study/launch';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { Button } from '@/ui/Button';
import { Field, Select } from '@/ui/Field';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { formatDuration } from '@/features/study/sessions';
import { timeAgo } from '@/ui/time';

const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)} h ` : ''}${minutes % 60 > 0 ? `${minutes % 60} min` : ''}`.trim();

function PaperCard({ paper, pool, onStart }: { paper: Paper; pool: readonly Question[]; onStart: () => void }) {
  const preview = useMemo(() => {
    const mcq = pool.filter((q) => q.type === 'mcq').length;
    const openMarks = pool.filter((q) => q.type === 'open').reduce((sum, q) => sum + questionMarks(q), 0);
    return { mcq, openMarks };
  }, [pool]);
  const lacking = paper.parts.filter((part) => (part.kind === 'mcq' ? preview.mcq < (part.count ?? part.marks) : preview.openMarks < part.marks));
  const unusable = paper.parts.every((part) => (part.kind === 'mcq' ? preview.mcq === 0 : preview.openMarks === 0));
  return (
    <section className="flex flex-col gap-3 border-t-2 border-ink pt-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="qb-heading sm:text-[2.25rem]">{paper.name}</h3>
        <p className="flex items-center gap-1.5 text-sm font-bold tabular-nums">
          <Clock size={14} aria-hidden />
          {minutesLabel(paper.minutes)}
        </p>
      </div>
      <ul className="flex flex-col gap-1 text-[0.9375rem]">
        {paper.parts.map((part) => (
          <li key={part.label}>
            {part.label}: <span className="font-bold tabular-nums">{part.kind === 'mcq' ? `${part.count ?? part.marks} preguntas` : `${part.marks} puntos`}</span>
          </li>
        ))}
      </ul>
      <p className="text-[0.8125rem] text-muted">
        {paperMarks(paper)} puntos · {paper.calculator ? 'con calculadora' : 'sin calculadora'}
        {paper.booklet ? ' · con cuadernillo' : ''}
      </p>
      {lacking.length > 0 && !unusable ? <p className="text-[0.8125rem] font-medium text-warning">Tu banco aún no llega a todo: saldrá más corto, con el mismo tiempo.</p> : null}
      <Button variant="primary" className="mt-auto w-full" icon={<Play size={16} aria-hidden />} disabled={unusable} onClick={onStart}>
        Empezar simulacro
      </Button>
    </section>
  );
}

function History() {
  const sessions = useLiveQuery(async () => (await db.sessions.where('state').equals('finished').reverse().sortBy('startedAt')).filter((s) => s.config.paperId).slice(0, 10), []);
  if (!sessions || sessions.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Tus simulacros" />
      <ul className="divide-y divide-border px-4">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <Link to={`/study/session/${session.id}/results`} className="font-bold underline underline-offset-2">
              {session.title}
            </Link>
            <span className="text-[0.8125rem] text-muted tabular-nums">
              {timeAgo(session.startedAt)} · {formatDuration((session.finishedAt ?? session.startedAt) - session.startedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function MocksPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const exams = useExams();
  const launch = useLaunchSession();
  const [params] = useSearchParams();
  const [subjectId, setSubjectId] = useState('');
  const [formatId, setFormatId] = useState('');
  const [examId, setExamId] = useState('');

  // Desde el calendario se llega con el examen ya elegido.
  useEffect(() => {
    const exam = exams?.find((e) => e.id === params.get('exam'));
    if (!exam) return;
    setSubjectId(exam.subjectId);
    setExamId(exam.id);
    const found = findPaper(exam.paperId);
    if (found) setFormatId(found.format.id);
  }, [params, exams]);

  const subject = taxonomy?.subjects.find((s) => s.id === subjectId);
  useEffect(() => {
    if (subject) setFormatId((current) => current || detectFormat(subject.name)?.id || '');
  }, [subject]);

  const exam = exams?.find((e) => e.id === examId);
  const pool = useMemo(() => {
    if (!questions || !taxonomy || !subjectId) return [];
    return questions.filter((q) => questionInSubject(q, subjectId, taxonomy.index) && (!exam || exam.topicIds.length === 0 || q.topicIds.some((id) => exam.topicIds.includes(id)))).map(toQuestion);
  }, [questions, taxonomy, subjectId, exam]);

  if (!questions || !taxonomy || !exams) return <Spinner />;
  const format = EXAM_FORMATS.find((f) => f.id === formatId);
  const subjects = taxonomy.subjects.filter((s) => s.units.some((u) => u.topics.length > 0));
  const subjectExams = exams.filter((e) => e.subjectId === subjectId);

  const start = (paper: Paper) => {
    if (!format) return;
    const ids = assemblePaper(paper, pool).flatMap((part) => part.ids);
    void launch({ mode: 'exam', title: `${format.name} · ${paper.name}`, config: { subjectId, topicIds: exam && exam.topicIds.length > 0 ? exam.topicIds : undefined, count: ids.length, ignoreScope: true, paperId: paper.id }, timeLimitSec: paper.minutes * 60, questionIds: ids });
  };

  return (
    <>
      <PageHeader title="Simulacros" description="Con el tiempo y el número de preguntas de las pruebas oficiales del IB." />
      {questions.length === 0 ? (
        <EmptyState title="Aún no hay preguntas">Importa o descarga preguntas para poder hacer un simulacro.</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Asignatura">
              {(id) => (
                <Select
                  id={id}
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setFormatId('');
                    setExamId('');
                  }}
                >
                  <option value="">Elige una</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Formato">
              {(id) => (
                <Select id={id} value={formatId} disabled={!subject} onChange={(e) => setFormatId(e.target.value)}>
                  <option value="">Elige uno</option>
                  {EXAM_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Qué entra">
              {(id) => (
                <Select id={id} value={examId} disabled={subjectExams.length === 0} onChange={(e) => setExamId(e.target.value)}>
                  <option value="">Todo el temario</option>
                  {subjectExams.map((e) => (
                    <option key={e.id} value={e.id}>
                      Lo de {e.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {!subject ? <p className="text-[0.9375rem] text-muted">Elige una asignatura para ver sus pruebas.</p> : null}
          {subject && !format ? <Notice tone="accent" title="Elige el formato">No sé a qué asignatura del IB corresponde «{subject.name}».</Notice> : null}
          {subject && format ? (
            <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
              {format.papers.map((paper) => (
                <PaperCard key={paper.id} paper={paper} pool={pool} onStart={() => start(paper)} />
              ))}
            </div>
          ) : null}
          <History />
          <p className="text-[0.8125rem] text-muted">Las preguntas no son exámenes del IB. El test se corrige solo y el desarrollo lo autoevalúas al entregar, así que los puntos son una estimación.</p>
        </div>
      )}
    </>
  );
}
