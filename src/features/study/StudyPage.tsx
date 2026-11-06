import { ClipboardCheck, Flag, History, Play, Repeat, SlidersHorizontal, Star, Target, Timer, XCircle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES, type Difficulty } from '@core/schema/common';
import { filterQuestions } from '@core/questions/filter';
import { QUESTION_TYPE_LABELS, type QuestionType } from '@core/schema/question';
import { useQuestions } from '@/features/bank/questionsRepo';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { SessionConfig } from '@/infra/db/types';
import { Button, ButtonLink } from '@/ui/Button';
import { Field, Input, Select } from '@/ui/Field';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { useLaunchSession } from './launch';
import { MODE_LABELS, useActiveSessions } from './sessions';

function ModeCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-accent-text">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </Card>
  );
}

function ReviewButton({ icon, label, count, onClick }: { icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" disabled={count === 0} onClick={onClick} className="flex h-9 items-center gap-2 rounded-md border border-border px-2.5 text-[13px] font-medium transition-colors hover:border-border-strong hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50">
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="text-muted tabular-nums">{count}</span>
    </button>
  );
}

export default function StudyPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const active = useActiveSessions();
  const launchSession = useLaunchSession();
  const [params] = useSearchParams();

  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [unitId, setUnitId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [type, setType] = useState<QuestionType | ''>('');
  const [count, setCount] = useState(20);
  const [examMinutes, setExamMinutes] = useState(30);

  useEffect(() => {
    const subject = params.get('subject');
    if (subject) setSubjectId(subject);
  }, [params]);

  const reviewCounts = useLiveQuery(async () => {
    const now = Date.now();
    const rows = await db.progress.toArray();
    return {
      due: rows.filter((r) => r.attempts > 0 && r.due <= now).length,
      failed: rows.filter((r) => r.lastCorrect === false).length,
      hard: rows.filter((r) => r.hard === 1).length,
      favorites: rows.filter((r) => r.favorite === 1).length,
    };
  }, []);

  const config: SessionConfig = useMemo(
    () => ({
      subjectId: subjectId || undefined,
      unitIds: unitId ? [unitId] : undefined,
      topicIds: topicId ? [topicId] : undefined,
      difficulties: difficulties.length > 0 ? difficulties : undefined,
      types: type ? [type] : undefined,
      count,
    }),
    [subjectId, unitId, topicId, difficulties, type, count],
  );

  const matches = useMemo(() => (questions && taxonomy ? filterQuestions(questions, config, taxonomy.index).length : 0), [questions, taxonomy, config]);

  if (!questions || !taxonomy || !reviewCounts) return <Spinner />;

  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  const unit = subject?.units.find((u) => u.id === unitId);
  const scopeTitle = taxonomy.index.topics.get(topicId)?.topic.name ?? unit?.name ?? subject?.name ?? 'Todo el banco';

  const launch = (mode: 'practice' | 'exam' | 'review' | 'custom', sessionConfig: SessionConfig, title: string, timeLimitSec?: number) =>
    launchSession({ mode, title, config: sessionConfig, timeLimitSec });

  const quick = (mode: 'practice' | 'exam') => {
    const scope = { count: mode === 'exam' ? count : 10, subjectId: subjectId || undefined };
    void launch(mode, scope, subject?.name ?? 'Todo el banco', mode === 'exam' ? examMinutes * 60 : undefined);
  };

  return (
    <>
      <PageHeader title="Estudiar" description="Lo que estudies se guarda en este dispositivo, también sin conexión." />

      {active && active.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2">
          {active.map((session) => (
            <Notice
              key={session.id}
              tone="accent"
              title={`${MODE_LABELS[session.mode]} en curso${session.title ? `: ${session.title}` : ''}`}
              action={
                <ButtonLink to={`/study/session/${session.id}`} variant="primary" size="sm" icon={<Play size={14} aria-hidden />}>
                  Continuar
                </ButtonLink>
              }
            >
              Pregunta {session.cursor + 1} de {session.questionIds.length}
            </Notice>
          ))}
        </div>
      ) : null}

      {questions.length === 0 ? (
        <EmptyState
          icon={<Target size={28} aria-hidden />}
          title="Aún no hay preguntas para estudiar"
          action={
            <>
              <ButtonLink to="/create" variant="primary">
                Crear una pregunta
              </ButtonLink>
              <ButtonLink to="/sync">Descargar de la comunidad</ButtonLink>
            </>
          }
        >
          Crea las tuyas o descarga las que ha publicado la comunidad.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <ModeCard icon={<Repeat size={18} aria-hidden />} title="Práctica" description="10 preguntas con corrección y explicación al momento. Da prioridad a lo que toca repasar.">
              <Button variant="primary" className="w-full" icon={<Play size={16} aria-hidden />} onClick={() => quick('practice')}>
                Empezar práctica
              </Button>
            </ModeCard>
            <ModeCard icon={<Timer size={18} aria-hidden />} title="Examen" description="Preguntas repartidas entre temas, con reloj y sin ver las soluciones hasta entregar.">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Field label="Preguntas">{(id) => <Input id={id} type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />}</Field>
                <Field label="Minutos">{(id) => <Input id={id} type="number" min={1} max={240} value={examMinutes} onChange={(e) => setExamMinutes(Math.max(1, Math.min(240, Number(e.target.value) || 1)))} />}</Field>
              </div>
              <Button variant="primary" className="w-full" icon={<ClipboardCheck size={16} aria-hidden />} onClick={() => quick('exam')}>
                Empezar examen
              </Button>
            </ModeCard>
            <ModeCard icon={<History size={18} aria-hidden />} title="Repaso" description="Repetición espaciada: cada pregunta vuelve justo cuando empezarías a olvidarla.">
              <div className="flex flex-col gap-1.5">
                <ReviewButton icon={<History size={14} aria-hidden />} label="Toca repasar" count={reviewCounts.due} onClick={() => void launch('review', { count: 50, source: 'due' }, 'Toca repasar')} />
                <ReviewButton icon={<XCircle size={14} aria-hidden />} label="Falladas" count={reviewCounts.failed} onClick={() => void launch('review', { count: 50, source: 'failed' }, 'Falladas')} />
                <ReviewButton icon={<Flag size={14} aria-hidden />} label="Difíciles para mí" count={reviewCounts.hard} onClick={() => void launch('review', { count: 50, source: 'hard' }, 'Difíciles')} />
                <ReviewButton icon={<Star size={14} aria-hidden />} label="Favoritas" count={reviewCounts.favorites} onClick={() => void launch('review', { count: 50, source: 'favorites' }, 'Favoritas')} />
              </div>
            </ModeCard>
          </div>

          <Card>
            <CardHeader title="Personalizado" description="Combina filtros y elige cómo estudiarlo." />
            <div className="flex flex-col gap-3 p-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Select
                  aria-label="Asignatura"
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    setUnitId('');
                    setTopicId('');
                  }}
                >
                  <option value="">Todas las asignaturas</option>
                  {taxonomy.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Unidad"
                  disabled={!subject}
                  value={unitId}
                  onChange={(e) => {
                    setUnitId(e.target.value);
                    setTopicId('');
                  }}
                >
                  <option value="">Todas las unidades</option>
                  {subject?.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Tema" disabled={!unit} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="">Todos los temas</option>
                  {unit?.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Tipo de pregunta" value={type} onChange={(e) => setType(e.target.value as QuestionType | '')}>
                  <option value="">Todos los tipos</option>
                  <option value="mcq">{QUESTION_TYPE_LABELS.mcq}</option>
                  <option value="open">{QUESTION_TYPE_LABELS.open}</option>
                </Select>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dificultad">
                {DIFFICULTY_VALUES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={difficulties.includes(level)}
                    onClick={() => setDifficulties((list) => (list.includes(level) ? list.filter((x) => x !== level) : [...list, level]))}
                    className={cn('h-7 rounded-full border px-2.5 text-xs font-medium transition-colors', difficulties.includes(level) ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-muted hover:border-border-strong hover:text-ink')}
                  >
                    {DIFFICULTY_LABELS[level]}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-[13px] text-muted" role="status">
                  <span className="font-medium text-ink tabular-nums">{matches}</span> {matches === 1 ? 'pregunta coincide' : 'preguntas coinciden'}.{' '}
                  {matches > 0 ? <Link to={`/bank?${new URLSearchParams(Object.entries({ subject: subjectId, unit: unitId, topic: topicId, type, difficulty: difficulties.join(',') }).filter(([, v]) => v)).toString()}`} className="underline underline-offset-2">Verlas</Link> : null}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[13px] text-muted">
                    Cuántas
                    <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="h-8 w-16" />
                  </label>
                  <Button disabled={matches === 0} icon={<SlidersHorizontal size={14} aria-hidden />} onClick={() => void launch('custom', config, scopeTitle)}>
                    Practicar
                  </Button>
                  <Button disabled={matches === 0} icon={<Timer size={14} aria-hidden />} onClick={() => void launch('exam', config, scopeTitle, examMinutes * 60)}>
                    Como examen
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
