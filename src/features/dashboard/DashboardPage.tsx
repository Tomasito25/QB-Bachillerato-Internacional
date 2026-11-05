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
import { MODE_LABELS, useActiveSessions } from '@/features/study/sessions';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { ButtonLink } from '@/ui/Button';
import { Card, CardHeader, EmptyState, Notice, PageHeader, ProgressBar, Spinner, Stat } from '@/ui/Surface';

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

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

  return (
    <>
      <PageHeader
        title="Inicio"
        actions={
          <ButtonLink to="/study" variant="primary" icon={<Play size={16} aria-hidden />}>
            Estudiar
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-4">
        {active?.[0] ? (
          <Notice
            tone="accent"
            title={`${MODE_LABELS[active[0].mode]} a medias${active[0].title ? `: ${active[0].title}` : ''}`}
            action={
              <ButtonLink to={`/study/session/${active[0].id}`} variant="primary" size="sm">
                Continuar
              </ButtonLink>
            }
          >
            Pregunta {active[0].cursor + 1} de {active[0].questionIds.length}.
          </Notice>
        ) : null}

        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <div className="min-w-0">
            <Stat label="Hoy" value={`${stats.today} / ${dailyGoal}`} />
            <ProgressBar value={goalProgress} label="Objetivo diario" tone={goalProgress >= 1 ? 'success' : 'accent'} className="mt-2" />
          </div>
          <Stat
            label="Racha"
            value={
              <span className="inline-flex items-center gap-1">
                <Flame size={18} className={stats.streak > 0 ? 'text-warning' : 'text-faint'} aria-hidden />
                {stats.streak} {stats.streak === 1 ? 'día' : 'días'}
              </span>
            }
            hint={stats.longestStreak > stats.streak ? `Mejor: ${stats.longestStreak}` : undefined}
          />
          <Stat label="Precisión en test" value={stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)} %`} hint={stats.mcqTotal > 0 ? `${stats.mcqTotal} ${stats.mcqTotal === 1 ? "respuesta" : "respuestas"}` : undefined} />
          <Stat label="Preguntas disponibles" value={questions.length.toLocaleString('es')} />
        </Card>

        {stats.due > 0 ? (
          <Notice
            tone="neutral"
            title={`Tienes ${stats.due} ${stats.due === 1 ? 'pregunta' : 'preguntas'} para repasar hoy`}
            action={
              <ButtonLink to="/study" size="sm" icon={<History size={14} aria-hidden />}>
                Repasar
              </ButtonLink>
            }
          >
            Es el momento en que repasar cunde más.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <OfficialCard />
          <ActiveCompetitions />
          <Card>
            <CardHeader title="Asignaturas recientes" action={<Link to="/explore" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Explorar <ArrowRight size={12} aria-hidden /></Link>} />
            {recentSubjects.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">Aparecerán cuando empieces a estudiar.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentSubjects.map((subject) => (
                  <li key={subject.id}>
                    <Link to={`/explore/${subject.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-subtle/60">
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
          <Card>
            <CardHeader title="Última actividad" action={<Link to="/stats" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Estadísticas <ArrowRight size={12} aria-hidden /></Link>} />
            <div className="flex flex-col gap-1 p-4 text-[13.5px]">
              {stats.lastAttemptAt ? (
                <>
                  <p>
                    Estudiaste por última vez <span className="font-medium">{timeAgo(stats.lastAttemptAt)}</span>.
                  </p>
                  <p className="text-[13px] text-muted">
                    {stats.total.toLocaleString('es')} respuestas en total · {stats.mastered} {stats.mastered === 1 ? 'pregunta dominada' : 'preguntas dominadas'}.
                  </p>
                </>
              ) : (
                <p className="text-muted">Todavía no has respondido nada.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
