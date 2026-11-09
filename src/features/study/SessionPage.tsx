import { ArrowLeft, ArrowRight, Bookmark, Clock, Flag, LogOut, Sigma, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { isCorrectSelection, type SelfGrade } from '@core/questions/grading';
import type { Question } from '@core/schema/question';
import { QuestionStatement, SolutionBlock } from '@/features/bank/QuestionView';
import { DifficultyBadge } from '@/features/bank/parts';
import { toQuestion } from '@/features/bank/questionsRepo';
import { getQuestion } from '@/features/bank/questionsRepo';
import { FormulaSheet } from '@/features/formulas/FormulaSheet';
import { hasFormulaSheet } from '@/features/formulas/physics';
import { preferences } from '@/features/settings/preferences';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import type { SessionAnswer, SessionRow } from '@/infra/db/types';
import { Button, ButtonLink } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Band } from '@/ui/Band';
import { Card, EmptyState, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { McqPlayer, McqResultBanner, OpenExamAnswer, OpenPlayer } from './players';
import { toggleFavorite, toggleHard, useProgress } from './progressRepo';
import { abandonSession, commitAnswer, commitSelfGrade, finishSession, formatDuration, isDeferredMode, MODE_LABELS, saveDeferredAnswer, saveWritten, setCursor, toggleMarked, useSession } from './sessions';

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

const hasAnswer = (answer: SessionAnswer | undefined) => Boolean(answer?.committed || answer?.selected?.length || Object.values(answer?.written ?? {}).some((text) => text.trim()));

type Result = 'right' | 'half' | 'wrong';

/** En práctica se corrige al momento: esto es lo que se pinta en la tira de preguntas. */
function resultOf(question: Question | undefined, answer: SessionAnswer | undefined): Result | null {
  if (!question || !answer?.committed) return null;
  if (question.type === 'mcq') return isCorrectSelection(question, answer.selected ?? []) ? 'right' : 'wrong';
  return answer.selfGrade === 2 ? 'right' : answer.selfGrade === 1 ? 'half' : 'wrong';
}

const RESULT_LABEL: Record<Result, string> = { right: 'bien', half: 'a medias', wrong: 'mal' };
const RESULT_CELL: Record<Result, string> = { right: 'bg-success text-canvas', half: 'bg-warning text-canvas', wrong: 'bg-danger text-canvas' };

function QuestionGrid({ session, questions, deferred, onJump }: { session: SessionRow; questions: Map<string, Question>; deferred: boolean; onJump: (index: number) => void }) {
  const marked = new Set(session.marked ?? []);
  return (
    <nav aria-label="Preguntas de la sesión" className="flex flex-wrap gap-1">
      {session.questionIds.map((id, index) => {
        const answer = session.answers[id];
        const result = deferred ? null : resultOf(questions.get(id), answer);
        const done = hasAnswer(answer);
        const current = index === session.cursor;
        const isMarked = marked.has(id);
        const state = result ? RESULT_LABEL[result] : done ? 'respondida' : 'sin responder';
        return (
          <button
            key={id}
            type="button"
            aria-current={current ? 'true' : undefined}
            aria-label={`Pregunta ${index + 1}, ${state}${isMarked ? ', marcada para revisar' : ''}`}
            onClick={() => onJump(index)}
            className={cn(
              'size-9 text-xs font-bold tabular-nums transition-colors sm:size-8',
              current && 'outline outline-2 outline-offset-1 outline-accent',
              isMarked ? 'bg-signal text-signal-ink' : result ? RESULT_CELL[result] : done ? 'bg-accent-soft text-accent-text' : 'border border-border text-muted hover:border-border-strong',
            )}
          >
            {index + 1}
          </button>
        );
      })}
    </nav>
  );
}

function JumpList({ label, indexes, onJump }: { label: string; indexes: readonly number[]; onJump: (index: number) => void }) {
  if (indexes.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[0.8125rem] font-bold">{label}</p>
      <div className="flex flex-wrap gap-1">
        {indexes.map((index) => (
          <button key={index} type="button" onClick={() => onJump(index)} aria-label={`Ir a la pregunta ${index + 1}`} className="size-9 border border-border text-xs font-bold tabular-nums hover:border-border-strong">
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

const TIME_WARNINGS = [10 * 60_000, 5 * 60_000, 60_000];

function Runner({ session, questions }: { session: SessionRow; questions: Map<string, Question> }) {
  const navigate = useNavigate();
  const prefs = preferences.use();
  const taxonomy = useTaxonomy();
  const [showFormulas, setShowFormulas] = useState(false);
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

  const warned = useRef(new Set<number>());
  useEffect(() => {
    if (remaining === null) return;
    for (const limit of TIME_WARNINGS) {
      // Sólo al cruzar el aviso: en un examen más corto no debe saltar nada al empezar.
      if (remaining <= limit && remaining > limit - 5000 && !warned.current.has(limit)) {
        warned.current.add(limit);
        toast.info(`Quedan ${limit / 60_000} ${limit === 60_000 ? 'minuto' : 'minutos'}.`);
      }
    }
  }, [remaining]);

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
    if (!deferred) return;
    // Se acumula lo transcurrido desde la última vez: este tiempo desempata las competiciones.
    const now = Date.now();
    void saveDeferredAnswer(session.id, questionId, { selected: next, durationMs: (saved?.durationMs ?? 0) + (now - shownAt.current), answeredAt: now });
    shownAt.current = now;
  };

  const onSelfGrade = async (grade: SelfGrade, met: string[]) => {
    if (!question) return;
    await commitSelfGrade(session.id, question, grade, met, Date.now() - shownAt.current);
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
      } else if (event.key === 'm' && deferred) {
        void toggleMarked(session.id, questionId);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [check, committed, deferred, next, openRevealed, question, questionId, session.id]);

  if (!question) {
    // La pregunta se retiró después de crear la sesión: se salta en lugar de romperla.
    return (
      <EmptyState title="Esta pregunta ya no está disponible" action={<Button variant="primary" onClick={next}>Continuar</Button>}>
        Se ha retirado desde que empezó la sesión.
      </EmptyState>
    );
  }

  const answeredCount = session.questionIds.filter((id) => hasAnswer(session.answers[id])).length;
  const unanswered = session.questionIds.flatMap((id, index) => (hasAnswer(session.answers[id]) ? [] : [index]));
  const markedIndexes = session.questionIds.flatMap((id, index) => (session.marked?.includes(id) ? [index] : []));
  const isMarked = session.marked?.includes(questionId) ?? false;
  const low = remaining !== null && remaining < 5 * 60_000;
  const results = deferred ? [] : session.questionIds.map((id) => resultOf(questions.get(id), session.answers[id]));
  const right = results.filter((r) => r === 'right').length;
  const graded = results.filter(Boolean).length;
  const topicName = taxonomy?.index.topics.get(question.topicIds[0] ?? '')?.topic.name;
  const jump = (index: number) => {
    setConfirmFinish(false);
    go(index);
  };
  const subjectHasFormulas = hasFormulaSheet(taxonomy?.subjects.find((s) => s.id === question.subjectId)?.name ?? '');

  return (
    <>
      <Band
        compact
        screen
        as="p"
        className="mb-5"
        value={answeredCount / session.questionIds.length}
        label="Progreso de la sesión"
        title={`Pregunta ${session.cursor + 1} de ${session.questionIds.length}`}
        subtitle={`${MODE_LABELS[session.mode]}${session.title ? ` · ${session.title}` : ''}${graded > 0 ? ` · ${right} de ${graded} bien` : ''}`}
        actions={
          <>
            {remaining !== null ? (
              <span role="timer" aria-label="Tiempo restante" className={cn('inline-flex h-9 items-center gap-1.5 border-2 border-[#0a0a0a] px-2.5 text-sm font-bold tabular-nums', low ? 'bg-signal text-[#0a0a0a]' : 'bg-white text-[#0a0a0a]')}>
                <Clock size={14} aria-hidden />
                {formatDuration(remaining)}
              </span>
            ) : null}
            {subjectHasFormulas ? (
              <Button variant="plate" size="sm" icon={<Sigma size={14} aria-hidden />} onClick={() => setShowFormulas(true)}>
                Formulario
              </Button>
            ) : null}
            <Button variant="plate" size="sm" icon={<LogOut size={14} aria-hidden />} onClick={() => setConfirmLeave(true)}>
              Salir
            </Button>
          </>
        }
      />
      {session.questionIds.length > 1 ? (
        <div className="mb-4">
          <QuestionGrid session={session} questions={questions} deferred={deferred} onJump={go} />
        </div>
      ) : null}

      <Card className="mb-5 p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {prefs.showDifficulty ? <DifficultyBadge value={question.difficulty} /> : null}
            {!deferred && topicName ? <span className="truncate text-xs font-medium text-muted">{topicName}</span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {deferred ? (
              <Button variant={isMarked ? 'signal' : 'ghost'} size="sm" icon={<Bookmark size={14} aria-hidden />} aria-pressed={isMarked} title="Revisar antes de entregar (M)" onClick={() => void toggleMarked(session.id, questionId)}>
                Revisar luego
              </Button>
            ) : null}
            <QuestionFlags questionId={question.id} />
          </div>
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
            <OpenExamAnswer key={question.id} question={question} initial={saved?.written} onChange={(written) => void saveWritten(session.id, question.id, written)} />
          ) : (
            <>
              <OpenPlayer key={question.id} question={question} revealed={openRevealed} committed={committed} initialGrade={saved?.selfGrade} initialCriteria={saved?.metCriteria} onGrade={(grade, met) => void onSelfGrade(grade, met)} />
              {openRevealed && question.explanation ? <SolutionBlock title="Explicación" source={question.explanation} question={question} /> : null}
            </>
          )}
        </div>
      </Card>

      <div className="safe-bottom sticky bottom-0 z-10 -mx-[var(--gutter)] mt-auto flex lg:mt-0 items-center justify-between gap-2 border-t-2 border-ink bg-canvas px-[var(--gutter)] py-3">
        <Button icon={<ArrowLeft size={16} aria-hidden />} disabled={session.cursor === 0} onClick={() => go(session.cursor - 1)}>
          Anterior
        </Button>
        <div className="flex gap-2">
          {!deferred && !committed ? (
            <Button variant="ghost" onClick={next}>
              {isLast ? 'Terminar' : 'Saltar'}
            </Button>
          ) : null}
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
        {unanswered.length > 0 ? `${unanswered.length === 1 ? 'Queda 1 pregunta' : `Quedan ${unanswered.length} preguntas`} sin responder. Las de test contarán como falladas.` : 'Has respondido todas las preguntas.'}
        <JumpList label="Sin responder" indexes={unanswered} onJump={jump} />
        <JumpList label="Marcadas para revisar" indexes={markedIndexes} onJump={jump} />
      </Dialog>

      <Dialog open={showFormulas} onClose={() => setShowFormulas(false)} title="Formulario" size="lg">
        <FormulaSheet />
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
