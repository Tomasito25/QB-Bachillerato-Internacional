import { ArrowRight, Flame, History, Play, PencilLine, ShieldCheck, Swords, Target, UploadCloud } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
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
import { MODE_LABELS, useActiveSessions } from '@/features/study/sessions';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader, EmptyState, PageHeader, ProgressBar, Spinner, Stat } from '@/ui/Surface';

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const dateLabel = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

function timeAgo(ms: number): string {
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days === 0) return 'hoy';
  return relative.format(days, 'day');
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
        <div className="flex flex-col gap-2 p-4 text-[13.5px]">
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
          <p className="text-[13px] text-muted">Tu perfil aparecerá cuando se procese tu primer envío.</p>
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
        <div className="flex flex-col gap-2 p-4 text-[13.5px]">
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
  const { dailyGoal } = preferences.use();
  const launch = useLaunchSession();

  const recentSubjects = useMemo(() => {
    if (!stats || !taxonomy) return [];
    return [...stats.bySubject.entries()]
      .sort((a, b) => b[1].lastAt - a[1].lastAt)
      .slice(0, 4)
      .flatMap(([id, row]) => {
        const subject = taxonomy.index.subjects.get(id);
        return subject ? [{ id, name: subject.name, ...row }] : [];
      });
  }, [stats, taxonomy]);

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
            </>
          }
        >
          Todo funciona sin conexión y sin cuenta. Conecta tu cuenta de GitHub sólo si quieres compartir preguntas o participar en rankings.
        </EmptyState>
      </>
    );
  }

  const goalProgress = stats.today / dailyGoal;
  const session = active?.[0];
  const today = dateLabel.format(new Date());
  return (
    <>
      <PageHeader title="Hoy" documentTitle="Inicio" description={today.charAt(0).toUpperCase() + today.slice(1)} />
      <div className="flex flex-col gap-5">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{goalProgress >= 1 ? 'Objetivo cumplido' : 'Objetivo diario'}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
                {stats.today}
                <span className="text-xl font-medium text-faint"> / {dailyGoal}</span>
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
                <Button variant="primary" icon={<Play size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Todo el banco', config: { count: 10 } })}>
                  Practicar
                </Button>
              )}
              <ButtonLink to="/study">Más modos</ButtonLink>
            </div>
          </div>
          <ProgressBar value={goalProgress} label="Objetivo diario" tone={goalProgress >= 1 ? 'success' : 'accent'} className="mt-5 h-2" />
          {session ? (
            <p className="mt-3 text-[13px] text-muted">
              {MODE_LABELS[session.mode]} a medias{session.title ? `: ${session.title}` : ''} · pregunta {session.cursor + 1} de {session.questionIds.length}
            </p>
          ) : stats.due > 0 ? (
            <p className="mt-3 text-[13px] text-muted">Es el momento en que repasar cunde más.</p>
          ) : null}
          <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
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
          </div>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Asignaturas recientes" action={<Link to="/explore" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Explorar <ArrowRight size={12} aria-hidden /></Link>} />
            {recentSubjects.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">Aparecerán cuando empieces a estudiar.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentSubjects.map((subject) => (
                  <li key={subject.id}>
                    <Link to={`/explore/${subject.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-subtle/60">
                      <span className="min-w-0 truncate font-medium">{subject.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {subject.mcq > 0 ? `${Math.round((subject.correct / subject.mcq) * 100)} % · ` : ''}
                        {timeAgo(subject.lastAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ActiveCompetitions />
          <OfficialCard />
        </div>
      </div>
    </>
  );
}
