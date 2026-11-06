import { Award, CalendarDays, Lock, Pencil, ShieldCheck, Swords, Trophy, Users } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ACHIEVEMENTS } from '@core/scoring/achievements';
import { levelFromPoints, pointsForLevel } from '@core/scoring/rules';
import type { DerivedProfile, UserDetail } from '@core/schema/derived';
import { UserDetail as UserDetailSchema } from '@core/schema/derived';
import { identity, newNonce } from '@/features/account/identity';
import { AccountCard } from '@/features/account/AccountCard';
import { Avatar } from '@/features/bank/parts';
import { excerpt, getQuestion, useQuestions } from '@/features/bank/questionsRepo';
import { useLocalStats } from '@/features/study/localStats';
import { enqueue } from '@/features/sync/outbox';
import { config } from '@/infra/config';
import { db } from '@/infra/db/db';
import { Button, ButtonLink } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field, Input, Textarea } from '@/ui/Field';
import { Badge, Card, CardHeader, EmptyState, PageHeader, ProgressBar, Spinner, Stat } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const shortDate = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

function useUserDetail(login: string | undefined): UserDetail | null {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    fetch(config.communityUrl(`u/${encodeURIComponent(login)}.json`))
      .then(async (response) => {
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
        const parsed = UserDetailSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : null;
      })
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setDetail(value);
      });
    return () => {
      cancelled = true;
    };
  }, [login]);
  return detail;
}

function EditProfileDialog({ profile, open, onClose }: { profile: DerivedProfile | undefined; open: boolean; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDisplayName(profile?.displayName ?? '');
      setBio(profile?.bio ?? '');
    }
  }, [open, profile]);
  const save = async () => {
    setBusy(true);
    await enqueue({ v: 1, kind: 'profile', nonce: newNonce(), displayName: displayName.trim() || undefined, bio: bio.trim() || undefined }, 'Actualizo mi perfil público.', {});
    setBusy(false);
    toast.success('Preparado. Envíalo desde Sincronización.');
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar perfil público"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Preparar envío
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nombre visible (opcional)">{(id) => <Input id={id} data-autofocus maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
        <Field label="Biografía (opcional)" hint={`${bio.length} de 280`}>
          {(id, describedBy) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">Sólo puedes cambiar esto. Puntos, nivel y logros se calculan a partir de lo publicado.</p>
      </div>
    </Dialog>
  );
}

function Achievements({ unlocked }: { unlocked: readonly string[] }) {
  const set = new Set(unlocked);
  return (
    <Card>
      <CardHeader title="Logros" description={`${unlocked.length} de ${ACHIEVEMENTS.length}. Se calculan solos: no se pueden añadir a mano.`} />
      <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACHIEVEMENTS.map((achievement) => {
          const has = set.has(achievement.id);
          return (
            <li key={achievement.id} className={cn('flex items-start gap-2.5 rounded-md border p-2.5', has ? 'border-border' : 'border-dashed border-border')}>
              {has ? <Award size={16} className="mt-0.5 shrink-0 text-accent-text" aria-hidden /> : <Lock size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />}
              <div className="min-w-0">
                <p className={cn('text-[13px] font-medium', !has && 'text-muted')}>
                  {achievement.title}
                  <span className="sr-only">{has ? ' (conseguido)' : ' (pendiente)'}</span>
                </p>
                <p className="text-xs text-muted">{achievement.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ContributedList({ ids }: { ids: readonly string[] }) {
  const items = useLiveQuery(async () => (await Promise.all(ids.slice(-10).reverse().map((id) => getQuestion(id)))).filter((q) => q !== undefined), [ids.join(',')]);
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Preguntas aportadas" description={`${ids.length} en total`} />
      <ul className="divide-y divide-border">
        {items.map((question) => (
          <li key={question.id}>
            <Link to={`/q/${question.id}`} className="block px-4 py-2 text-[13.5px] hover:bg-subtle/60">
              {excerpt(question.statement, 110)}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActivityList({ detail }: { detail: UserDetail }) {
  if (detail.activity.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Historial de actividad" />
      <ul className="divide-y divide-border text-[13.5px]">
        {detail.activity.map((item, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
            {item.kind === 'study' ? (
              <>
                <span>
                  Estudió {item.answers} {item.answers === 1 ? 'pregunta' : 'preguntas'}
                  {item.correct > 0 ? `, ${item.correct} bien` : ''}
                  {item.points > 0 ? ` · +${item.points} pts` : ''}
                </span>
                <span className="shrink-0 text-xs text-muted">{shortDate.format(new Date(`${item.day}T12:00:00Z`))}</span>
              </>
            ) : item.kind === 'question' ? (
              <>
                <Link to={`/q/${item.questionId}`} className="hover:underline">
                  Publicó una pregunta
                </Link>
                <span className="shrink-0 text-xs text-muted">{shortDate.format(new Date(item.at))}</span>
              </>
            ) : (
              <>
                <Link to={`/competitions/${item.competitionId}`} className="min-w-0 truncate hover:underline">
                  {item.title}
                  {item.rank ? ` · puesto ${item.rank}` : ''}
                </Link>
                <span className="shrink-0 text-xs text-muted">{shortDate.format(new Date(item.at))}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OfficialProfile({ profile, isMe, onEdit }: { profile: DerivedProfile; isMe: boolean; onEdit: () => void }) {
  const detail = useUserDetail(profile.login);
  const { stats } = profile;
  const level = levelFromPoints(stats.points);
  const floor = pointsForLevel(level);
  const next = pointsForLevel(level + 1);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar user={{ id: profile.githubId, login: profile.login }} size={64} />
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{profile.displayName ?? `@${profile.login}`}</h1>
              {profile.suspect ? (
                <Badge tone="warning" title="Respuestas demasiado rápidas y acertadas. Fuera de los rankings hasta que lo revise un mantenedor.">
                  En revisión
                </Badge>
              ) : null}
            </div>
            <a href={`https://github.com/${profile.login}`} target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted hover:underline">
              @{profile.login} en GitHub
            </a>
            {profile.bio ? <p className="mt-2 text-sm whitespace-pre-wrap">{profile.bio}</p> : null}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays size={12} aria-hidden />
              Desde el {dateFormat.format(new Date(profile.registeredAt))}
            </p>
          </div>
          {isMe ? (
            <Button size="sm" icon={<Pencil size={14} aria-hidden />} onClick={onEdit}>
              Editar
            </Button>
          ) : null}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">
              Nivel {level} <span className="font-normal text-muted tabular-nums">· {stats.points.toLocaleString('es')} puntos</span>
            </p>
            <p className="text-xs text-muted tabular-nums">Faltan {(next - stats.points).toLocaleString('es')} para el {level + 1}</p>
          </div>
          <ProgressBar value={(stats.points - floor) / (next - floor)} label={`Progreso hasta el nivel ${level + 1}`} />
        </div>
      </Card>

      <section aria-labelledby="official-heading">
        <h2 id="official-heading" className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold tracking-wide text-muted uppercase">
          <ShieldCheck size={13} className="text-success" aria-hidden />
          Calculado por GitHub Actions
          <span className="font-normal normal-case">a partir de lo publicado, sin que el cliente pueda fijarlo</span>
        </h2>
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Preguntas realizadas" value={stats.answers.toLocaleString('es')} />
          <Stat label="Precisión en test" value={stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)} %`} hint={stats.mcqAnswers > 0 ? `${stats.mcqCorrect} de ${stats.mcqAnswers}` : undefined} />
          <Stat label="Preguntas aportadas" value={stats.questionsApproved} hint={stats.questionUses > 0 ? `Usadas por ${stats.questionUses}` : undefined} />
          <Stat label="Racha" value={`${stats.currentStreak} d`} hint={`Mejor: ${stats.longestStreak}`} />
          <Stat label="Sesiones completas" value={stats.sessions} />
          <Stat label="Competiciones" value={stats.competitions} hint={stats.competitionWins > 0 ? `${stats.competitionWins} ganadas` : undefined} />
          <Stat label="Ranking global" value={profile.ranks.global ? `#${profile.ranks.global}` : '—'} />
          <Stat label="Ranking semanal" value={profile.ranks.week ? `#${profile.ranks.week}` : '—'} />
        </Card>
      </section>

      <Achievements unlocked={profile.achievements} />
      {detail ? <ContributedList ids={detail.contributed} /> : null}
      {detail ? <ActivityList detail={detail} /> : null}
    </div>
  );
}

function LocalSummary() {
  const local = useLocalStats();
  if (!local) return null;
  return (
    <section aria-labelledby="local-heading">
      <h2 id="local-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Users size={13} aria-hidden />
        Sólo en este dispositivo
        <span className="font-normal normal-case">incluye lo que no has publicado; no es oficial</span>
      </h2>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="grid flex-1 basis-64 grid-cols-3 gap-4">
          <Stat label="Respuestas" value={local.total.toLocaleString('es')} />
          <Stat label="Precisión" value={local.accuracy === null ? '—' : `${Math.round(local.accuracy * 100)} %`} />
          <Stat label="Sin publicar" value={local.unpublished} />
        </div>
        {local.unpublished > 0 ? <ButtonLink to="/sync">Ver envíos</ButtonLink> : null}
      </Card>
    </section>
  );
}

export default function ProfilePage() {
  const { login: routeLogin } = useParams();
  const me = identity.use();
  const login = routeLogin?.toLowerCase() ?? me?.login;
  const profile = useLiveQuery(async () => (login ? ((await db.dProfiles.get(login)) ?? null) : null), [login]);
  const questions = useQuestions();
  const [editing, setEditing] = useState(false);
  const isMe = login !== undefined && login === me?.login;

  if (profile === undefined || !questions) return <Spinner />;

  if (!login) {
    return (
      <>
        <PageHeader title="Perfil" description="Tu identidad es tu cuenta de GitHub. Conéctala para tener perfil público y entrar en los rankings." />
        <div className="flex flex-col gap-4">
          <AccountCard />
          <LocalSummary />
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <PageHeader title={`@${login}`} documentTitle="Perfil" />
        <div className="flex flex-col gap-4">
          <EmptyState icon={<Trophy size={28} aria-hidden />} title={isMe ? 'Tu perfil público aparecerá en unos minutos' : 'Este perfil no existe, o aún no se ha sincronizado'} action={isMe ? <ButtonLink to="/sync" variant="primary">Ir a sincronización</ButtonLink> : <ButtonLink to="/leaderboards">Ver rankings</ButtonLink>}>
            {isMe ? 'Se crea cuando GitHub Actions procesa tu conexión y se despliega. Mientras tanto, todo sigue funcionando.' : null}
          </EmptyState>
          {isMe ? <LocalSummary /> : null}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={profile.displayName ?? `@${profile.login}`} documentTitle={profile.login} />
      <div className="-mt-[3.25rem] flex flex-col gap-4">
        <OfficialProfile profile={profile} isMe={isMe} onEdit={() => setEditing(true)} />
        {isMe ? <LocalSummary /> : null}
        {!isMe ? (
          <ButtonLink to={`/competitions/new?invite=${profile.login}`} className="w-fit" icon={<Swords size={16} aria-hidden />}>
            Retar a un duelo
          </ButtonLink>
        ) : null}
      </div>
      <EditProfileDialog profile={profile} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}
