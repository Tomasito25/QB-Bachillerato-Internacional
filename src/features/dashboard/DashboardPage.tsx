import { ArrowRight, History, Play, PencilLine, ShieldCheck, Swords, Target, UploadCloud } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { competitionPhase } from '@core/competitions/competitions';
import { identity } from '@/features/account/identity';
import { CompetitionRow } from '@/features/competitions/CompetitionsPage';
import { useCompetitions } from '@/features/competitions/repo';
import { unpublishedAnswerCount } from '@/features/sync/publish';
import { db } from '@/infra/db/db';
import { useQuestions } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
import { daysBetween } from '@core/study/plan';
import { untilLabel } from '@/features/calendar/format';
import { useStudyPlan } from '@/features/calendar/useStudyPlan';
import { useLocalStats } from '@/features/study/localStats';
import { useLaunchSession } from '@/features/study/launch';
import { MODE_LABELS, scopeLabel, useActiveSessions } from '@/features/study/sessions';
import { nodeScore, useSyllabusProgress, weakestTopics, type NodeProgress } from '@/features/study/syllabusProgress';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { Band } from '@/ui/Band';
import { Button, ButtonLink } from '@/ui/Button';
import { ColumnChart, ProgressLegend, ProgressSegments } from '@/ui/charts';
import { unitParts } from '@/ui/marks';
import { SubjectMark } from '@/ui/SubjectMark';
import { Card, CardHeader, EmptyState, PageHeader, Spinner, Stat } from '@/ui/Surface';
import { formatDuration } from '@/ui/time';

const dateLabel = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Una fila del temario: ficha, nombre, avance y acierto, siempre en las mismas columnas. */
function SyllabusRow({ mark, name, node, to }: { mark: ReactNode; name: string; node: NodeProgress; to: string }) {
  const score = nodeScore(node);
  return (
    <li className="border-t-2 border-ink">
      <Link to={to} className="grid grid-cols-[2.75rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1.5 py-2.5 transition-colors hover:bg-subtle sm:grid-cols-[2.75rem_minmax(0,17rem)_minmax(0,1fr)_4.5rem]">
        {mark}
        <span className="truncate font-semibold">{name}</span>
        <ProgressSegments label={name} mastered={node.mastered} seen={node.seen} total={node.total} className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto" />
        <span className="qb-display text-right text-[1.375rem] whitespace-nowrap">{score === null ? '—' : `${Math.round(score * 100)} %`}</span>
      </Link>
    </li>
  );
}

/** Lo oficial, separado de lo local: aquí sólo hay lo que ha calculado Actions. */
function OfficialCard() {
  const user = identity.use();
  const profile = useLiveQuery(async () => (user ? db.dProfiles.get(user.login) : undefined), [user?.login]);
  const unpublished = useLiveQuery(() => unpublishedAnswerCount(), []);
  if (!user) {
    return (
      <Card className="[&>*]:!px-0">
        <CardHeader title="Ranking" />
        <div className="flex flex-col gap-2 p-4 text-[0.84375rem]">
          <p className="text-muted">Conecta tu cuenta de GitHub para tener perfil público y entrar en los rankings. Es opcional.</p>
          <ButtonLink to="/settings" className="w-fit">
            Conectar
          </ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <Card className="[&>*]:!px-0">
      <CardHeader title="Ranking" description={<span className="inline-flex items-center gap-1"><ShieldCheck size={12} className="text-success" aria-hidden />Calculado por Actions</span>} action={<Link to="/leaderboards" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Ver todo <ArrowRight size={12} aria-hidden /></Link>} />
      <div className="flex flex-col gap-3 p-4">
        {profile ? (
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Puntos" value={profile.stats.points.toLocaleString('es')} hint={`Nivel ${profile.stats.level}`} />
            <Stat label="Global" value={profile.ranks.global ? `#${profile.ranks.global}` : '—'} />
            <Stat label="Semana" value={profile.ranks.week ? `#${profile.ranks.week}` : '—'} />
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted">Tu perfil aparecerá cuando se procese tu primer envío.</p>
        )}
        {unpublished ? (
          <ButtonLink to="/sync" className="w-fit" icon={<UploadCloud size={14} aria-hidden />} size="sm">
            Publicar {unpublished} {unpublished === 1 ? 'respuesta' : 'respuestas'}
          </ButtonLink>
        ) : null}
      </div>
    </Card>
  );
}

function ActiveCompetitions() {
  const competitions = useCompetitions();
  const now = Date.now();
  const active = (competitions ?? []).filter((c) => competitionPhase(c, now) !== 'closed').sort((a, b) => a.closesAt.localeCompare(b.closesAt)).slice(0, 4);
  return (
    <Card className="[&>*]:!px-0">
      <CardHeader title="Competiciones activas" action={<Link to="/competitions" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Ver todas <ArrowRight size={12} aria-hidden /></Link>} />
      {active.length > 0 ? (
        <ul className="divide-y divide-border">
          {active.map((competition) => (
            <CompetitionRow key={competition.id} competition={competition} now={now} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2 p-4 text-[0.84375rem]">
          <p className="text-muted">Ninguna en este momento.</p>
          <ButtonLink to="/competitions/new" className="w-fit" size="sm" icon={<Swords size={14} aria-hidden />}>
            Retar a alguien
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

function NextExam() {
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

export default function DashboardPage() {
  const stats = useLocalStats();
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const active = useActiveSessions();
  const syllabus = useSyllabusProgress();
  const { dailyGoalMcq, dailyGoalOpen, practiceCount, studyOnly, studyScope } = preferences.use();
  const launch = useLaunchSession();

  if (!stats || !questions || !taxonomy) return <Spinner />;

  if (questions.length === 0 && stats.total === 0) {
    return (
      <>
        <PageHeader title="Te damos la bienvenida" description="Un banco de preguntas que mantiene la gente que lo usa." />
        <EmptyState
          icon={<Target size={28} aria-hidden />}
          title="Empieza por tener algo que estudiar"
          action={
            <>
              <ButtonLink to="/sync" variant="primary">
                Descargar de la comunidad
              </ButtonLink>
              <ButtonLink to="/create" icon={<PencilLine size={16} aria-hidden />}>
                Crear una pregunta
              </ButtonLink>
              <ButtonLink to="/guide" variant="ghost">
                Ver la guía
              </ButtonLink>
            </>
          }
        >
          Todo funciona sin conexión y sin cuenta. Conecta tu cuenta de GitHub sólo si quieres compartir preguntas o participar en rankings.
        </EmptyState>
      </>
    );
  }

  const goalTotal = dailyGoalMcq + dailyGoalOpen;
  // Lo que se hace de más de un tipo no compensa lo que falta del otro.
  const goalDone = Math.min(stats.todayMcq, dailyGoalMcq) + Math.min(stats.todayOpen, dailyGoalOpen);
  const missing = { mcq: Math.max(0, dailyGoalMcq - stats.todayMcq), open: Math.max(0, dailyGoalOpen - stats.todayOpen) };
  const goalReached = goalTotal > 0 && goalDone >= goalTotal;
  const session = active?.[0];
  const today = dateLabel.format(new Date());
  const scope = scopeLabel(studyScope);
  const activity = stats.recentDays.slice(-14).map((d, i) => ({ key: d.day, label: dayFormat.format(parseDay(d.day)), value: d.answers, tick: i % 7 === 0 ? dayFormat.format(parseDay(d.day)) : '' }));
  const change = stats.weekAnswers - stats.previousWeekAnswers;
  const subjects = syllabus ? [...syllabus].sort((a, b) => b.lastAt - a.lastAt || b.total - a.total).slice(0, 5) : [];
  const single = subjects.length === 1 ? subjects[0] : undefined;
  const weak = syllabus ? weakestTopics(syllabus) : [];
  // Sin objetivo, la banda mide cuánto del banco has visto: siempre hay algo que medir.
  const value = goalTotal > 0 ? goalDone / goalTotal : questions.length > 0 ? stats.seen / questions.length : 0;
  const streak = stats.streak > 0 ? ` · ${stats.streak === 1 ? '1 día' : `${stats.streak} días`} de racha` : '';
  const accuracy = stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)} %`;
  const figures = [
    ...(dailyGoalMcq > 0 ? [{ label: 'Tipo test', value: `${stats.todayMcq}/${dailyGoalMcq}` }] : []),
    ...(dailyGoalOpen > 0 ? [{ label: 'Desarrollo', value: `${stats.todayOpen}/${dailyGoalOpen}` }] : []),
    { label: 'Precisión', value: accuracy },
    { label: 'Por repasar', value: stats.due.toLocaleString('es') },
    { label: 'Dominadas', value: stats.mastered.toLocaleString('es') },
    { label: stats.streak === 1 ? 'Día de racha' : 'Días de racha', value: stats.streak.toLocaleString('es') },
  ].slice(0, 4);

  return (
    <>
      <Band
        value={value}
        label={goalTotal > 0 ? 'Objetivo de hoy' : 'Preguntas vistas del banco'}
        title="Hoy"
        documentTitle="Inicio"
        subtitle={`${today.charAt(0).toUpperCase() + today.slice(1)}${streak}`}
        detail={goalTotal === 0 ? `${stats.today} ${stats.today === 1 ? 'respuesta' : 'respuestas'} hoy` : goalReached ? 'Objetivo cumplido' : `${goalDone} de ${goalTotal} preguntas`}
        figure={`${Math.round(value * 100)}%`}
        actions={
          <>
            {/* Una sola acción principal: lo que más sentido tiene ahora mismo. */}
            {session ? (
              <ButtonLink to={`/study/session/${session.id}`} variant="signal" icon={<Play size={16} aria-hidden />}>
                Continuar {MODE_LABELS[session.mode].toLowerCase()}
              </ButtonLink>
            ) : stats.due > 0 ? (
              <Button variant="signal" icon={<History size={16} aria-hidden />} onClick={() => void launch({ mode: 'review', title: 'Toca repasar', config: { count: 50, source: 'due' } })}>
                Repasar {stats.due}
              </Button>
            ) : (
              <Button variant="signal" icon={<Play size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Todo el banco', config: { count: practiceCount } })}>
                Practicar
              </Button>
            )}
            {!goalReached && goalTotal > 0 ? (
              <Button variant="plate" icon={<Target size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Objetivo de hoy', config: { count: missing.mcq + missing.open, mix: missing } })}>
                Hacer lo que falta
              </Button>
            ) : null}
          </>
        }
      />
      <div className="qb-bleed grid lg:grid-cols-[minmax(0,1fr)_clamp(18rem,26vw,23.25rem)]">
        <div className="min-w-0 px-[var(--gutter)] py-6">
          <div className="grid max-w-5xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {figures.map((figure) => (
              <Stat key={figure.label} label={figure.label} value={figure.value} />
            ))}
          </div>
          {session || stats.due > 0 || scope ? (
            <p className="mt-4 text-[0.8125rem] text-muted">
              {session ? `${MODE_LABELS[session.mode]} a medias${session.title ? `: ${session.title}` : ''} · pregunta ${session.cursor + 1} de ${session.questionIds.length}. ` : stats.due > 0 ? 'Es el momento en que repasar cunde más. ' : ''}
              {scope ? (
                <>
                  Estudias: {scope.toLowerCase()}.{' '}
                  <Link to="/study" className="font-semibold underline">
                    Cambiar
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <NextExam />
          <section className="mt-7 max-w-5xl">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
              <h2 className="qb-heading sm:text-[2rem]">{single ? single.name : 'Por asignatura'}</h2>
              <ProgressLegend />
            </div>
            {subjects.length === 0 ? (
              <p className="border-t-2 border-ink py-3 text-[0.9375rem] text-muted">Aparecerán en cuanto haya preguntas.</p>
            ) : (
              <>
                <ul className="border-b-2 border-ink">
                  {single
                    ? single.units.map((unit, index) => {
                        const parts = unitParts(unit.name, index);
                        return <SyllabusRow key={unit.id} mark={<span className="qb-display text-[2rem] font-black">{parts.code}</span>} name={parts.name} node={unit} to={`/stats?subject=${single.id}`} />;
                      })
                    : subjects.map((subject) => <SyllabusRow key={subject.id} mark={<SubjectMark id={subject.id} name={subject.name} />} name={subject.name} node={subject} to={`/stats?subject=${subject.id}`} />)}
                </ul>
                <Link to="/stats" className="mt-2.5 inline-flex items-center gap-1 text-[0.8125rem] font-bold hover:underline">
                  Ver detalle <ArrowRight size={14} aria-hidden />
                </Link>
              </>
            )}
          </section>
        </div>
        <aside className="bg-signal px-[var(--gutter)] py-6 text-signal-ink lg:px-6" aria-labelledby="weak-topics">
          <h2 id="weak-topics" className="qb-heading mb-3 sm:text-[2.25rem]">
            A reforzar
          </h2>
          {weak.length === 0 ? (
            <p className="border-t-2 border-signal-ink py-3 text-[0.9375rem] font-medium">{stats.total === 0 ? 'Aparecerán cuando empieces a estudiar.' : 'Nada por debajo del 80 %. Sigue así.'}</p>
          ) : (
            <ul>
              {weak.map((topic) => (
                <li key={topic.id} className="border-t-2 border-signal-ink">
                  <button
                    type="button"
                    title={`Practicar ${topic.name}`}
                    aria-label={`Practicar ${topic.name}: ${Math.round(topic.score * 100)} % de acierto`}
                    onClick={() => void launch({ mode: 'practice', title: topic.name, config: { count: practiceCount, topicIds: [topic.id] } })}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left transition-colors hover:bg-white/45"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold">{topic.name}</span>
                      <span className="block truncate text-[0.8125rem]">{topic.path}</span>
                    </span>
                    <span className="qb-display text-[2.5rem] font-black">{Math.round(topic.score * 100)}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <Card className="py-4">
          <ColumnChart data={activity} title="Respuestas por día, últimas dos semanas" unit="respuestas" />
          <p className="mt-3 text-[0.8125rem] text-muted">
            <span className="font-bold text-ink tabular-nums">{stats.weekAnswers}</span> esta semana
            {stats.previousWeekAnswers > 0 || stats.weekAnswers > 0 ? ` (${change >= 0 ? '+' : '−'}${Math.abs(change)} respecto a la anterior)` : ''} · {formatDuration(stats.weekMs)} estudiando
          </p>
        </Card>
        {studyOnly ? null : <ActiveCompetitions />}
        {studyOnly ? null : <OfficialCard />}
      </div>
    </>
  );
}
