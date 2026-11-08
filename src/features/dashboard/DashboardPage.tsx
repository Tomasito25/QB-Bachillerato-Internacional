import { ArrowRight, Flame, History, Play, PencilLine, ShieldCheck, Swords, Target, UploadCloud } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { competitionPhase } from '@core/competitions/competitions';
import { identity } from '@/features/account/identity';
import { CompetitionRow } from '@/features/competitions/CompetitionsPage';
import { useCompetitions } from '@/features/competitions/repo';
import { unpublishedAnswerCount } from '@/features/sync/publish';
import { db } from '@/infra/db/db';
import { useQuestions } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
import { useLocalStats } from '@/features/study/localStats';
import { useLaunchSession } from '@/features/study/launch';
import { MODE_LABELS, scopeLabel, useActiveSessions } from '@/features/study/sessions';
import { nodeScore, useSyllabusProgress, weakestTopics } from '@/features/study/syllabusProgress';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { Button, ButtonLink } from '@/ui/Button';
import { ColumnChart, ProgressLegend, ProgressSegments } from '@/ui/charts';
import { Card, CardHeader, EmptyState, PageHeader, ProgressBar, Spinner, Stat } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { formatDuration } from '@/ui/time';

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const dateLabel = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

function timeAgo(ms: number): string {
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days === 0) return 'hoy';
  return relative.format(days, 'day');
}

const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function GoalRow({ label, done, goal }: { label: string; done: number; goal: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">
          {done} <span className="font-normal text-faint">/ {goal}</span>
        </span>
      </div>
      <ProgressBar value={done / goal} label={`${label}: ${done} de ${goal}`} tone={done >= goal ? 'success' : 'accent'} className="mt-1.5 h-2" />
    </div>
  );
}

/** Lo oficial, separado de lo local: aquí sólo hay lo que ha calculado Actions. */
function OfficialCard() {
  const user = identity.use();
  const profile = useLiveQuery(async () => (user ? db.dProfiles.get(user.login) : undefined), [user?.login]);
  const unpublished = useLiveQuery(() => unpublishedAnswerCount(), []);
  if (!user) {
    return (
      <Card>
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
    <Card>
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
    <Card>
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
  const weak = syllabus ? weakestTopics(syllabus) : [];
  return (
    <>
      <PageHeader title="Hoy" documentTitle="Inicio" description={today.charAt(0).toUpperCase() + today.slice(1)} />
      <div className="flex flex-col gap-5">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{goalTotal === 0 ? 'Respuestas de hoy' : goalReached ? 'Objetivo cumplido' : 'Objetivo diario'}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
                {goalTotal === 0 ? stats.today : goalDone}
                {goalTotal > 0 ? <span className="text-xl font-medium text-faint"> / {goalTotal}</span> : null}
              </p>
            </div>
            {/* Una sola acción principal: lo que más sentido tiene ahora mismo. */}
            <div className="flex flex-wrap gap-2">
              {session ? (
                <ButtonLink to={`/study/session/${session.id}`} variant="primary" icon={<Play size={16} aria-hidden />}>
                  Continuar {MODE_LABELS[session.mode].toLowerCase()}
                </ButtonLink>
              ) : stats.due > 0 ? (
                <Button variant="primary" icon={<History size={16} aria-hidden />} onClick={() => void launch({ mode: 'review', title: 'Toca repasar', config: { count: 50, source: 'due' } })}>
                  Repasar {stats.due}
                </Button>
              ) : (
                <Button variant="primary" icon={<Play size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Todo el banco', config: { count: practiceCount } })}>
                  Practicar
                </Button>
              )}
              {!goalReached && goalTotal > 0 ? (
                <Button icon={<Target size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Objetivo de hoy', config: { count: missing.mcq + missing.open, mix: missing } })}>
                  Hacer lo que falta
                </Button>
              ) : null}
              <ButtonLink to="/study">Más modos</ButtonLink>
            </div>
          </div>
          {goalTotal > 0 ? (
            <div className={cn('mt-5 grid gap-4', dailyGoalMcq > 0 && dailyGoalOpen > 0 && 'sm:grid-cols-2')}>
              {dailyGoalMcq > 0 ? <GoalRow label="Tipo test" done={stats.todayMcq} goal={dailyGoalMcq} /> : null}
              {dailyGoalOpen > 0 ? <GoalRow label="Desarrollo" done={stats.todayOpen} goal={dailyGoalOpen} /> : null}
            </div>
          ) : null}
          {session ? (
            <p className="mt-3 text-[0.8125rem] text-muted">
              {MODE_LABELS[session.mode]} a medias{session.title ? `: ${session.title}` : ''} · pregunta {session.cursor + 1} de {session.questionIds.length}
            </p>
          ) : stats.due > 0 ? (
            <p className="mt-3 text-[0.8125rem] text-muted">Es el momento en que repasar cunde más.</p>
          ) : null}
          {scope ? (
            <p className="mt-3 text-[0.8125rem] text-muted">
              Estudias: {scope.toLowerCase()}.{' '}
              <Link to="/study" className="underline underline-offset-2 hover:text-ink">
                Cambiar
              </Link>
            </p>
          ) : null}
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
            <Stat
              label="Racha"
              value={
                <span className="inline-flex items-center gap-1">
                  <Flame size={20} className={stats.streak > 0 ? 'text-warning' : 'text-faint'} aria-hidden />
                  {stats.streak}
                </span>
              }
              hint={stats.streak === 1 ? 'día' : 'días'}
            />
            <Stat label="Precisión" value={stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)} %`} hint={stats.mcqTotal > 0 ? `en ${stats.mcqTotal} de test` : 'en test'} />
            <Stat label="Dominadas" value={stats.mastered.toLocaleString('es')} hint={`de ${questions.length.toLocaleString('es')}`} />
            <Stat label="Por repasar" value={stats.due.toLocaleString('es')} hint={stats.due === 1 ? 'pregunta' : 'preguntas'} />
          </div>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Por asignatura" action={<Link to="/stats" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Ver detalle <ArrowRight size={12} aria-hidden /></Link>} />
            {subjects.length === 0 ? (
              <p className="p-4 text-[0.8125rem] text-muted">Aparecerán en cuanto haya preguntas.</p>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {subjects.map((subject) => {
                    const score = nodeScore(subject);
                    return (
                      <li key={subject.id}>
                        <Link to={`/stats?subject=${subject.id}`} className="block px-4 py-3 hover:bg-subtle/60">
                          <span className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-medium">{subject.name}</span>
                            <span className="shrink-0 text-xs text-muted tabular-nums">
                              {subject.seen} de {subject.total}
                              {score !== null ? ` · ${Math.round(score * 100)} %` : ''}
                              {subject.lastAt > 0 ? ` · ${timeAgo(subject.lastAt)}` : ''}
                            </span>
                          </span>
                          <ProgressSegments label={subject.name} mastered={subject.mastered} seen={subject.seen} total={subject.total} className="mt-2" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-border px-4 py-2.5">
                  <ProgressLegend />
                </div>
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="Temas a reforzar" description="Los que peor te salen, con al menos 3 respuestas." />
            {weak.length === 0 ? (
              <p className="p-4 text-[0.8125rem] text-muted">{stats.total === 0 ? 'Aparecerán cuando empieces a estudiar.' : 'Nada por debajo del 80 %. Sigue así.'}</p>
            ) : (
              <ul className="divide-y divide-border">
                {weak.map((topic) => (
                  <li key={topic.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{topic.name}</p>
                      <p className="truncate text-xs text-muted">{topic.path}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{Math.round(topic.score * 100)} %</span>
                    <Button size="sm" icon={<Play size={14} aria-hidden />} aria-label={`Practicar ${topic.name}`} onClick={() => void launch({ mode: 'practice', title: topic.name, config: { count: practiceCount, topicIds: [topic.id] } })}>
                      Practicar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <ColumnChart data={activity} title="Respuestas por día, últimas dos semanas" unit="respuestas" />
            <p className="mt-3 text-[0.8125rem] text-muted">
              <span className="font-medium text-ink tabular-nums">{stats.weekAnswers}</span> esta semana
              {stats.previousWeekAnswers > 0 || stats.weekAnswers > 0 ? ` (${change >= 0 ? '+' : '−'}${Math.abs(change)} respecto a la anterior)` : ''} · {formatDuration(stats.weekMs)} estudiando
            </p>
          </Card>
          {studyOnly ? null : (
            <>
              <ActiveCompetitions />
              <OfficialCard />
            </>
          )}
        </div>
      </div>
    </>
  );
}
