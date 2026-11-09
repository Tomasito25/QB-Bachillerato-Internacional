import { CheckCircle2, Circle, GraduationCap, MinusCircle, Play, RotateCcw, XCircle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Question } from '@core/schema/question';
import type { SelfGrade } from '@core/questions/grading';
import { QuestionStatement, SolutionBlock } from '@/features/bank/QuestionView';
import { excerpt, getQuestion, toQuestion } from '@/features/bank/questionsRepo';
import { db } from '@/infra/db/db';
import type { AttemptRow } from '@/infra/db/types';
import { Markdown } from '@/infra/markdown/Markdown';
import { Band } from '@/ui/Band';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader, EmptyState, Notice, ProgressBar, Spinner, Stat } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { submitEntry, useCompetition, useMyEntryStatus } from '@/features/competitions/repo';
import { OUTBOX_STATUS_LABELS } from '@/features/sync/outbox';
import type { SessionRow } from '@/infra/db/types';
import { OpenPlayer } from './players';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { useLaunchSession } from './launch';
import { commitSelfGrade, formatDuration, marksByTopic, MODE_LABELS, SessionError, sessionMarks, startSession, summarizeSession, useSession, type TopicMarks } from './sessions';

function AttemptIcon({ question, attempt }: { question: Question; attempt?: AttemptRow }) {
  if (question.type === 'open') {
    if (!attempt) return <Circle size={16} className="text-warning" aria-label="Pendiente de autoevaluar" />;
    return attempt.selfGrade === 2 ? <CheckCircle2 size={16} className="text-success" aria-label="Bien" /> : attempt.selfGrade === 1 ? <MinusCircle size={16} className="text-warning" aria-label="A medias" /> : <XCircle size={16} className="text-danger" aria-label="Mal" />;
  }
  if (attempt?.correct) return <CheckCircle2 size={16} className="text-success" aria-label="Correcta" />;
  if ((attempt?.selected?.length ?? 0) === 0) return <MinusCircle size={16} className="text-muted" aria-label="Sin responder" />;
  return <XCircle size={16} className="text-danger" aria-label="Incorrecta" />;
}

function McqReview({ question, attempt }: { question: Extract<Question, { type: 'mcq' }>; attempt?: AttemptRow }) {
  const selected = new Set(attempt?.selected ?? []);
  if (!question.reveal.solutionsAtExamEnd) {
    return <p className="text-[0.8125rem] text-muted">Quien creó esta pregunta ha decidido no mostrar la solución al terminar.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {question.answers.map((answer) => {
        const chosen = selected.has(answer.id);
        return (
          <li key={answer.id} className={cn('rounded-md border px-3 py-2 text-sm', answer.correct ? 'border-success bg-success-soft' : chosen ? 'border-danger bg-danger-soft' : 'border-border')}>
            <Markdown source={answer.text} images={question.images} />
            {answer.correct ? <span className="mt-0.5 block text-xs font-medium text-success">Correcta</span> : null}
            {chosen && !answer.correct ? <span className="mt-0.5 block text-xs font-medium text-danger">Tu respuesta</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Dónde has fallado, de peor a mejor, y a un toque de practicarlo. */
function TopicBreakdown({ rows }: { rows: readonly TopicMarks[] }) {
  const taxonomy = useTaxonomy();
  const launch = useLaunchSession();
  if (!taxonomy || rows.length < 2) return null;
  return (
    <Card>
      <CardHeader title="Por temas" description="De lo que peor te ha ido a lo mejor." />
      <ul className="divide-y divide-border px-4">
        {rows.map((row) => {
          const name = taxonomy.index.topics.get(row.topicId)?.topic.name ?? 'Tema borrado';
          return (
            <li key={row.topicId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem_4rem_auto]">
              <p className="truncate text-[0.9375rem] font-medium" title={name}>
                {name}
              </p>
              <Button size="sm" className="sm:order-last" icon={<Play size={14} aria-hidden />} aria-label={`Practicar ${name}`} onClick={() => void launch({ mode: 'practice', title: name, config: { topicIds: [row.topicId], count: 10, ignoreScope: true } })}>
                Practicar
              </Button>
              <ProgressBar value={row.earned / row.total} label={`Puntos en ${name}`} className="col-span-2 sm:col-span-1" />
              <p className="col-span-2 text-sm font-bold tabular-nums sm:col-span-1 sm:text-right">
                {row.earned} / {row.total}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ReviewItem({ index, question, attempt, sessionId, written }: { index: number; question: Question; attempt?: AttemptRow; sessionId: string; written?: Record<string, string> }) {
  const pending = question.type === 'open' && !attempt;
  const [open, setOpen] = useState(pending);
  const onGrade = (grade: SelfGrade, met: string[]) => {
    void commitSelfGrade(sessionId, question, grade, met);
  };
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-[0.84375rem] hover:bg-subtle/60">
        <span className="mt-0.5 shrink-0">
          <AttemptIcon question={question} attempt={attempt} />
        </span>
        <span className="w-5 shrink-0 text-muted tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1">{excerpt(question.statement, 130)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border bg-subtle/30 px-4 py-3">
          <QuestionStatement question={question} />
          {question.type === 'mcq' ? (
            <McqReview question={question} attempt={attempt} />
          ) : (
            <OpenPlayer question={question} revealed committed={attempt !== undefined} initialGrade={attempt?.selfGrade ?? undefined} written={written} onGrade={onGrade} />
          )}
          {question.explanation && (question.type === 'open' || question.reveal.solutionsAtExamEnd) ? <SolutionBlock title="Explicación" source={question.explanation} question={question} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Una competición no termina al acabar: cuenta cuando la entrega llega a GitHub dentro de plazo. */
function CompetitionSubmit({ session }: { session: SessionRow }) {
  const entry = useMyEntryStatus(session.id);
  const competition = useCompetition(session.competitionId ?? undefined);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  if (entry) {
    return (
      <Notice tone={entry.status === 'accepted' ? 'success' : entry.status === 'rejected' ? 'danger' : 'accent'} title={`Entrega: ${OUTBOX_STATUS_LABELS[entry.status]}`} action={<ButtonLink to="/sync" size="sm">Ver envíos</ButtonLink>}>
        {entry.status === 'accepted' ? 'La clasificación se actualiza en el próximo despliegue.' : 'Sigue su estado en Sincronización.'}
      </Notice>
    );
  }
  return (
    <Notice
      tone="accent"
      title="Falta entregar"
      action={
        <Button
          variant="primary"
          size="sm"
          busy={busy}
          onClick={() => {
            setBusy(true);
            void submitEntry(session)
              .then(() => navigate('/sync'))
              .finally(() => setBusy(false));
          }}
        >
          Preparar entrega
        </Button>
      }
    >
      Sólo cuenta si llega a GitHub antes de que cierre{competition ? ` (${new Date(competition.closesAt).toLocaleString('es')})` : ''}. Sólo se admite una entrega.
    </Notice>
  );
}

export default function ResultsPage() {
  const { id } = useParams();
  const session = useSession(id);
  const navigate = useNavigate();
  const attempts = useLiveQuery(async () => (id ? db.attempts.where('sessionId').equals(id).toArray() : []), [id]);
  const ids = session?.questionIds;
  const questions = useLiveQuery(async () => {
    if (!ids) return undefined;
    const rows = await Promise.all(ids.map((questionId) => getQuestion(questionId)));
    return new Map(rows.filter((row) => row !== undefined).map((row) => [row.id, toQuestion(row)]));
  }, [ids?.join(',')]);

  const summary = useMemo(() => (session && questions && attempts ? summarizeSession(session, questions, attempts) : null), [session, questions, attempts]);

  if (session === undefined || !attempts) return <Spinner />;
  if (session === null) return <EmptyState title="Esta sesión ya no existe" action={<ButtonLink to="/study" variant="primary">Ir a estudiar</ButtonLink>} />;
  if (!questions || !summary) return <Spinner />;

  const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
  const marks = sessionMarks(session, questions, attempts);
  const ratio = marks.total > 0 ? marks.earned / marks.total : 0;
  const failedIds = session.questionIds.filter((qid) => {
    const question = questions.get(qid);
    const attempt = byQuestion.get(qid);
    return question && attempt && (question.type === 'mcq' ? !attempt.correct : attempt.selfGrade !== 2);
  });

  const retryFailed = async () => {
    try {
      const newId = await startSession({ mode: 'practice', title: 'Repaso de fallos', config: { count: failedIds.length }, questionIds: failedIds });
      navigate(`/study/session/${newId}`);
    } catch (error) {
      toast.error(error instanceof SessionError ? error.message : 'No se ha podido crear la sesión.');
    }
  };

  return (
    <>
      <Band
        className="mb-8"
        value={ratio}
        label="Puntos conseguidos"
        title="Resultados"
        subtitle={`${MODE_LABELS[session.mode]}${session.title ? ` · ${session.title}` : ''}`}
        detail={`${marks.earned} de ${marks.total} puntos${marks.pending > 0 ? ` · ${marks.pending === 1 ? 'falta' : 'faltan'} ${marks.pending} por autoevaluar` : ''}`}
        figure={`${Math.round(ratio * 100)}%`}
        actions={
          <>
            {failedIds.length > 0 ? (
              <Button variant="signal" icon={<RotateCcw size={16} aria-hidden />} onClick={() => void retryFailed()}>
                Repasar {failedIds.length} {failedIds.length === 1 ? 'fallo' : 'fallos'}
              </Button>
            ) : null}
            <ButtonLink to="/study" variant={failedIds.length > 0 ? 'plate' : 'signal'} icon={<GraduationCap size={16} aria-hidden />}>
              Seguir estudiando
            </ButtonLink>
          </>
        }
      />
      <div className="flex flex-col gap-8">
        <Card className="grid grid-cols-2 gap-x-4 gap-y-6 p-4 sm:grid-cols-4">
          <Stat label={summary.mcqTotal < summary.total ? 'Puntos (estimación)' : 'Puntos'} value={`${marks.earned} / ${marks.total}`} />
          <Stat label="Aciertos en test" value={`${summary.correct} / ${summary.mcqTotal}`} />
          <Stat label="Respondidas" value={`${summary.answered} / ${summary.total}`} />
          <Stat label="Tiempo" value={formatDuration(summary.durationMs)} />
        </Card>
        <TopicBreakdown rows={marksByTopic(session, questions, attempts)} />
        {session.competitionId ? <CompetitionSubmit session={session} /> : null}
        {summary.pendingSelfGrade > 0 ? (
          <Notice tone="warning" title={`Te ${summary.pendingSelfGrade === 1 ? 'queda 1 pregunta' : `quedan ${summary.pendingSelfGrade} preguntas`} de desarrollo por autoevaluar`}>
            Compárala con la solución y di cómo te ha salido. Así sabrá cuándo volver a preguntártela.
          </Notice>
        ) : null}
        <Card>
          <CardHeader title="Revisión" description="Abre cada pregunta para ver la solución." />
          <ol className="divide-y divide-border">
            {session.questionIds.map((qid, index) => {
              const question = questions.get(qid);
              return question ? <ReviewItem key={qid} index={index} question={question} attempt={byQuestion.get(qid)} sessionId={session.id} written={session.answers[qid]?.written} /> : null;
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}
