import { CheckCircle2, Circle, GraduationCap, MinusCircle, RotateCcw, XCircle } from 'lucide-react';
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
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner, Stat } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { submitEntry, useCompetition, useMyEntryStatus } from '@/features/competitions/repo';
import { OUTBOX_STATUS_LABELS } from '@/features/sync/outbox';
import type { SessionRow } from '@/infra/db/types';
import { OpenPlayer } from './players';
import { commitSelfGrade, formatDuration, MODE_LABELS, SessionError, startSession, summarizeSession, useSession } from './sessions';

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
    return <p className="text-[13px] text-muted">Quien creó esta pregunta ha decidido no mostrar la solución al terminar.</p>;
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

function ReviewItem({ index, question, attempt, sessionId }: { index: number; question: Question; attempt?: AttemptRow; sessionId: string }) {
  const pending = question.type === 'open' && !attempt;
  const [open, setOpen] = useState(pending);
  const onGrade = (grade: SelfGrade, met: string[]) => {
    void commitSelfGrade(sessionId, question, grade, met);
  };
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-[13.5px] hover:bg-subtle/60">
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
            <OpenPlayer question={question} revealed committed={attempt !== undefined} initialGrade={attempt?.selfGrade ?? undefined} onGrade={onGrade} />
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
      <PageHeader
        title="Resultados"
        description={`${MODE_LABELS[session.mode]}${session.title ? ` · ${session.title}` : ''}`}
        actions={
          <>
            {failedIds.length > 0 ? (
              <Button icon={<RotateCcw size={16} aria-hidden />} onClick={() => void retryFailed()}>
                Repasar {failedIds.length} {failedIds.length === 1 ? 'fallo' : 'fallos'}
              </Button>
            ) : null}
            <ButtonLink to="/study" variant="primary" icon={<GraduationCap size={16} aria-hidden />}>
              Seguir estudiando
            </ButtonLink>
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Nota (test)" value={summary.scorePercent !== null ? `${summary.scorePercent} %` : '—'} />
          <Stat label="Aciertos" value={`${summary.correct} / ${summary.mcqTotal}`} />
          <Stat label="Respondidas" value={`${summary.answered} / ${summary.total}`} />
          <Stat label="Tiempo" value={formatDuration(summary.durationMs)} />
        </Card>
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
              return question ? <ReviewItem key={qid} index={index} question={question} attempt={byQuestion.get(qid)} sessionId={session.id} /> : null;
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}
