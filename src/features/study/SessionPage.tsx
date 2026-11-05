import { ArrowLeft, ArrowRight, Clock, Flag, LogOut, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { isCorrectSelection, type SelfGrade } from '@core/questions/grading';
import type { Question } from '@core/schema/question';
import { QuestionStatement, SolutionBlock } from '@/features/bank/QuestionView';
import { DifficultyBadge } from '@/features/bank/parts';
import { toQuestion } from '@/features/bank/questionsRepo';
import { getQuestion } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
import type { SessionRow } from '@/infra/db/types';
import { Button, ButtonLink } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Card, EmptyState, PageHeader, ProgressBar, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { McqPlayer, McqResultBanner, OpenPlayer } from './players';
import { toggleFavorite, toggleHard, useProgress } from './progressRepo';
import { abandonSession, commitAnswer, commitSelfGrade, finishSession, formatDuration, isDeferredMode, MODE_LABELS, saveDeferredAnswer, setCursor, useSession } from './sessions';

function useSessionQuestions(session: SessionRow | null | undefined): Map<string, Question> | undefined {
  const ids = session?.questionIds;
  return useLiveQuery(async () => {
    if (!ids) return undefined;
    const rows = await Promise.all(ids.map((id) => getQuestion(id)));
    return new Map(rows.filter((row) => row !== undefined).map((row) => [row.id, toQuestion(row)]));
  }, [ids?.join(',')]);
}

/** El reloj es de pared: cerrar la app no lo detiene, y al volver se entrega si ya pasó el plazo. */
function useCountdown(session: SessionRow, onExpire: () => void): number | null {
  const deadline = session.timeLimitSec ? session.startedAt + session.timeLimitSec * 1000 : null;
  const [remaining, setRemaining] = useState(deadline ? deadline - Date.now() : null);
  const expired = useRef(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (!deadline || session.state !== 'active') return;
    const tick = () => {
      const left = deadline - Date.now();
      setRemaining(left);
      if (left <= 0 && !expired.current) {
        expired.current = true;
        expire.current();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, session.state]);

  return remaining;
}

function QuestionFlags({ questionId }: { questionId: string }) {
  const progress = useProgress(questionId);
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" title="Favorita (F)" aria-label="Marcar como favorita" aria-pressed={progress?.favorite === 1} onClick={() => void toggleFavorite(questionId)}>
        <Star size={16} className={progress?.favorite ? 'fill-current text-warning' : ''} aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Difícil para mí" aria-label="Marcar como difícil" aria-pressed={progress?.hard === 1} onClick={() => void toggleHard(questionId)}>
        <Flag size={16} className={progress?.hard ? 'fill-current text-danger' : ''} aria-hidden />
      </Button>
    </div>
  );
}

function QuestionGrid({ session, questions, onJump }: { session: SessionRow; questions: Map<string, Question>; onJump: (index: number) => void }) {
  return (
    <nav aria-label="Preguntas del examen" className="flex flex-wrap gap-1">
      {session.questionIds.map((id, index) => {
        const answer = session.answers[id];
        const question = questions.get(id);
        const done = question?.type === 'open' ? answer !== undefined : (answer?.selected?.length ?? 0) > 0;
        const current = index === session.cursor;
        return (
          <button
            key={id}
            type="button"
            aria-current={current ? 'true' : undefined}
            aria-label={`Pregunta ${index + 1}${done ? ', respondida' : ', sin responder'}`}
            onClick={() => onJump(index)}
            className={cn(
              'size-7 rounded text-xs font-medium tabular-nums transition-colors',
              current ? 'bg-accent text-accent-ink' : done ? 'bg-accent-soft text-accent-text' : 'border border-border text-muted hover:border-border-strong',
            )}
          >
            {index + 1}
          </button>
        );
      })}
    </nav>
  );
}

function Runner({ session, questions }: { session: SessionRow; questions: Map<string, Question> }) {
  const navigate = useNavigate();
  const prefs = preferences.use();
  const deferred = isDeferredMode(session.mode);
  const questionId = session.questionIds[session.cursor] as string;
  const question = questions.get(questionId);
  const saved = session.answers[questionId];

  const [selected, setSelected] = useState<string[]>(saved?.selected ?? []);
  const [openRevealed, setOpenRevealed] = useState(saved?.committed ?? false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const shownAt = useRef(Date.now());

  // Al cambiar de pregunta se restaura lo guardado: también tras cerrar y volver.
  useEffect(() => {
    const answer = session.answers[questionId];
    setSelected(answer?.selected ?? []);
    setOpenRevealed(answer?.committed ?? false);
    shownAt.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de pregunta.
  }, [questionId]);

  const finish = useCallback(async () => {
    await finishSession(session.id);
    navigate(`/study/session/${session.id}/results`, { replace: true });
  }, [navigate, session.id]);

  const remaining = useCountdown(session, () => void finish());

  const go = useCallback(
    (cursor: number) => {
      if (cursor >= 0 && cursor < session.questionIds.length) void setCursor(session.id, cursor);
    },
    [session.id, session.questionIds.length],
  );

  const isLast = session.cursor === session.questionIds.length - 1;
  const committed = saved?.committed ?? false;

  const check = useCallback(async () => {
    if (!question || question.type !== 'mcq' || committed || selected.length === 0) return;
    await commitAnswer(session.id, question, { selected, durationMs: Date.now() - shownAt.current, answeredAt: Date.now() });
  }, [committed, question, selected, session.id]);

  const next = useCallback(() => {
    if (isLast) {
      if (deferred) setConfirmFinish(true);
      else void finish();
    } else {
      go(session.cursor + 1);
    }
  }, [deferred, finish, go, isLast, session.cursor]);

  const changeSelection = (next: string[]) => {
    setSelected(next);
    if (deferred) void saveDeferredAnswer(session.id, questionId, { selected: next, durationMs: (saved?.durationMs ?? 0) + (Date.now() - shownAt.current), answeredAt: Date.now() });
  };

  const onSelfGrade = async (grade: SelfGrade, met: string[]) => {
    if (!question) return;
    await commitSelfGrade(session.id, question, grade, met);
  };

  // Avance automático tras acertar, si está activado.
  useEffect(() => {
    if (!prefs.autoAdvance || deferred || !committed || question?.type !== 'mcq') return;
    if (!isCorrectSelection(question, saved?.selected ?? [])) return;
    const timer = window.setTimeout(next, 900);
    return () => window.clearTimeout(timer);
  }, [committed, deferred, next, prefs.autoAdvance, question, saved?.selected]);

  // Atajos: Intro comprueba o avanza, Espacio revela, F marca favorita.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable]')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (deferred || committed || question?.type === 'open') next();
        else void check();
      } else if (event.key === ' ' && question?.type === 'open' && !openRevealed) {
        event.preventDefault();
        setOpenRevealed(true);
      } else if (event.key === 'f' && question) {
        void toggleFavorite(question.id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [check, committed, deferred, next, openRevealed, question]);

  if (!question) {
    // La pregunta se retiró después de crear la sesión: se salta en lugar de romperla.
    return (
      <EmptyState title="Esta pregunta ya no está disponible" action={<Button variant="primary" onClick={next}>Continuar</Button>}>
        Se ha retirado desde que empezó la sesión.
      </EmptyState>
    );
  }

  const answeredCount = session.questionIds.filter((id) => {
    const answer = session.answers[id];
    return answer?.committed || (answer?.selected?.length ?? 0) > 0;
  }).length;
  const unanswered = session.questionIds.length - answeredCount;
  const low = remaining !== null && remaining < 60_000;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">
            {MODE_LABELS[session.mode]}
            {session.title ? ` · ${session.title}` : ''}
          </p>
          <p className="text-sm font-semibold tabular-nums">
            Pregunta {session.cursor + 1} de {session.questionIds.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {remaining !== null ? (
            <span role="timer" aria-label="Tiempo restante" className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-medium tabular-nums', low ? 'border-danger bg-danger-soft text-danger' : 'border-border')}>
              <Clock size={14} aria-hidden />
              {formatDuration(remaining)}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" icon={<LogOut size={14} aria-hidden />} onClick={() => setConfirmLeave(true)}>
            Salir
          </Button>
        </div>
      </div>
      <ProgressBar value={answeredCount / session.questionIds.length} label="Progreso de la sesión" className="mb-4" />
      {deferred ? (
        <div className="mb-4">
          <QuestionGrid session={session} questions={questions} onJump={go} />
        </div>
      ) : null}

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          {prefs.showDifficulty ? <DifficultyBadge value={question.difficulty} /> : <span />}
          <QuestionFlags questionId={question.id} />
        </div>
        <QuestionStatement question={question} />
        <div className="mt-4 flex flex-col gap-3">
          {question.type === 'mcq' ? (
            <>
              <McqPlayer sessionId={session.id} question={question} selected={selected} onChange={changeSelection} revealed={!deferred && committed} />
              {!deferred && committed ? (
                <>
                  <McqResultBanner question={question} selected={saved?.selected ?? []} />
                  {question.explanation && question.reveal.explanationAfterAnswer ? <SolutionBlock title="Explicación" source={question.explanation} question={question} /> : null}
                </>
              ) : null}
            </>
          ) : deferred ? (
            <p className="rounded-md bg-subtle p-3 text-[13px] text-muted">Es de desarrollo: al terminar verás la solución y te autoevaluarás. Mientras tanto, resuélvela en papel o en tu cabeza.</p>
          ) : (
            <>
              <OpenPlayer key={question.id} question={question} revealed={openRevealed} committed={committed} initialGrade={saved?.selfGrade} initialCriteria={saved?.metCriteria} onGrade={(grade, met) => void onSelfGrade(grade, met)} />
              {openRevealed && question.explanation ? <SolutionBlock title="Explicación" source={question.explanation} question={question} /> : null}
            </>
          )}
        </div>
      </Card>

      <div className="safe-bottom sticky bottom-16 z-10 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-border bg-canvas/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:-mx-10 lg:px-10">
        <Button icon={<ArrowLeft size={16} aria-hidden />} disabled={session.cursor === 0} onClick={() => go(session.cursor - 1)}>
          Anterior
        </Button>
        <div className="flex gap-2">
          {deferred ? (
            <>
              <Button onClick={() => setConfirmFinish(true)}>Entregar</Button>
              {!isLast ? (
                <Button variant="primary" onClick={next}>
                  Siguiente
                  <ArrowRight size={16} aria-hidden />
                </Button>
              ) : null}
            </>
          ) : question.type === 'mcq' && !committed ? (
            <Button variant="primary" disabled={selected.length === 0} onClick={() => void check()}>
              Comprobar
            </Button>
          ) : question.type === 'open' && !openRevealed ? (
            <Button variant="primary" onClick={() => setOpenRevealed(true)}>
              Ver solución
            </Button>
          ) : (
            <Button variant="primary" disabled={question.type === 'open' && !committed} onClick={next}>
              {isLast ? 'Ver resultados' : 'Siguiente'}
              <ArrowRight size={16} aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="¿Entregar?"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmFinish(false)}>Seguir</Button>
            <Button variant="primary" onClick={() => void finish()}>
              Entregar
            </Button>
          </>
        }
      >
        {unanswered > 0 ? `Quedan ${unanswered} ${unanswered === 1 ? 'pregunta' : 'preguntas'} sin responder. Las de test contarán como falladas.` : 'Has respondido todas las preguntas.'}
      </Dialog>

      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Salir de la sesión"
        size="sm"
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => {
                void abandonSession(session.id).then(() => navigate('/study'));
              }}
            >
              Descartar
            </Button>
            <ButtonLink to="/study" variant="primary">
              Continuar más tarde
            </ButtonLink>
          </>
        }
      >
        Tu progreso está guardado: puedes volver cuando quieras.
        {session.timeLimitSec ? ' El reloj sigue corriendo mientras tanto.' : ''} Si la descartas, lo ya corregido se conserva en tu historial.
      </Dialog>
    </>
  );
}

export default function SessionPage() {
  const { id } = useParams();
  const session = useSession(id);
  const questions = useSessionQuestions(session);
  const navigate = useNavigate();

  useEffect(() => {
    if (session?.state === 'finished') navigate(`/study/session/${session.id}/results`, { replace: true });
  }, [navigate, session?.id, session?.state]);

  const title = useMemo(() => (session ? `${MODE_LABELS[session.mode]} en curso` : 'Sesión'), [session]);

  if (session === undefined || (session && !questions)) return <Spinner />;
  if (session === null || !questions) {
    return (
      <EmptyState title="Esta sesión ya no existe" action={<ButtonLink to="/study" variant="primary">Ir a estudiar</ButtonLink>}>
        Puede que se descartara.
      </EmptyState>
    );
  }
  return (
    <>
      <div className="sr-only">
        <PageHeader title={title} />
      </div>
      <Runner session={session} questions={questions} />
    </>
  );
}
