import { Flame, Swords, UserPlus, Users, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DerivedProfile } from '@core/schema/derived';
import { identity } from '@/features/account/identity';
import { Avatar } from '@/features/bank/parts';
import { db } from '@/infra/db/db';
import { Button, ButtonLink } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';
import { Card, CardHeader, EmptyState, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { addFriend, MAX_FRIENDS, parseLogin, removeFriend, useFriends } from './friends';

function useProfiles(): Map<string, DerivedProfile> | undefined {
  return useLiveQuery(async () => new Map((await db.dProfiles.toArray()).map((p) => [p.login, p])), []);
}

function FriendActions({ login }: { login: string }) {
  return (
    <div className="flex shrink-0 items-center">
      <ButtonLink to={`/competitions/new?invite=${login}`} size="sm" variant="ghost" icon={<Swords size={14} aria-hidden />} aria-label={`Retar a @${login} a un duelo`}>
        <span className="hidden sm:inline">Retar</span>
      </ButtonLink>
      <Button size="sm" variant="ghost" aria-label={`Quitar a @${login} de tus amigos`} title="Quitar de amigos" onClick={() => void removeFriend(login)}>
        <X size={14} aria-hidden />
      </Button>
    </div>
  );
}

/** Tú y tus amigos, por puntos. Con `manage`, cada fila lleva retar y quitar. */
export function FriendsRanking({ manage = false }: { manage?: boolean }) {
  const friends = useFriends();
  const profiles = useProfiles();
  const me = identity.use();
  if (!friends || !profiles) return <Spinner />;

  if (friends.length === 0) {
    return (
      <EmptyState icon={<Users size={28} aria-hidden />} title="Aún no sigues a nadie" action={manage ? null : <ButtonLink to="/friends" variant="primary">Añadir amigos</ButtonLink>}>
        Añade a quien quieras por su usuario de GitHub, o desde su perfil, para ver aquí cómo vais.
      </EmptyState>
    );
  }

  const logins = me && !friends.includes(me.login) ? [me.login, ...friends] : friends;
  const ranked = logins.flatMap((login) => profiles.get(login) ?? []).sort((a, b) => b.stats.points - a.stats.points || a.login.localeCompare(b.login));
  const unseen = friends.filter((login) => !profiles.has(login));

  return (
    <Card>
      <ol>
        {ranked.map((profile, index) => {
          const isMe = profile.login === me?.login;
          return (
            <li key={profile.login} className={cn('flex items-center gap-3 border-b border-border px-4 py-2 last:border-0', isMe && 'bg-accent-soft')}>
              <span className={cn('w-6 shrink-0 text-right text-sm font-semibold tabular-nums', index > 2 && 'font-normal text-muted')}>{index + 1}</span>
              <Avatar user={{ id: profile.githubId, login: profile.login }} size={28} />
              <Link to={`/u/${profile.login}`} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm">
                  {profile.displayName ?? profile.login}
                  {profile.displayName ? <span className="ml-1.5 text-xs text-muted">@{profile.login}</span> : null}
                  {isMe ? <span className="ml-1.5 text-xs text-muted">(tú)</span> : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  Nivel {profile.stats.level}
                  {profile.stats.currentStreak > 0 ? (
                    <span className="inline-flex items-center gap-0.5" title="Racha de días seguidos">
                      <Flame size={12} aria-hidden />
                      {profile.stats.currentStreak}
                    </span>
                  ) : null}
                </span>
              </Link>
              <span className="shrink-0 text-sm font-medium tabular-nums">{profile.stats.points.toLocaleString('es')} pts</span>
              {manage && !isMe ? <FriendActions login={profile.login} /> : null}
            </li>
          );
        })}
        {unseen.map((login) => (
          <li key={login} className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-0">
            <span className="w-6 shrink-0" />
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-none bg-subtle text-xs font-medium text-muted uppercase">
              {login[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">@{login}</span>
              <span className="block text-xs text-muted">Sin actividad pública todavía</span>
            </span>
            {manage ? <FriendActions login={login} /> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Suggestions({ exclude }: { exclude: ReadonlySet<string> }) {
  const profiles = useProfiles();
  if (!profiles) return null;
  const people = [...profiles.values()]
    .filter((p) => !exclude.has(p.login) && !p.suspect && p.stats.points > 0)
    .sort((a, b) => b.stats.points - a.stats.points)
    .slice(0, 6);
  if (people.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Gente activa en el banco" description="Por si no sabes por dónde empezar." />
      <ul className="grid gap-2 p-4 sm:grid-cols-2">
        {people.map((profile) => (
          <li key={profile.login} className="flex items-center gap-2.5 rounded-md border border-border p-2">
            <Avatar user={{ id: profile.githubId, login: profile.login }} size={24} />
            <Link to={`/u/${profile.login}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
              {profile.displayName ?? profile.login}
            </Link>
            <Button size="sm" variant="ghost" icon={<UserPlus size={14} aria-hidden />} onClick={() => void addFriend(profile.login)}>
              Añadir
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function FriendsPage() {
  const friends = useFriends();
  const profiles = useProfiles();
  const me = identity.use();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const login = parseLogin(input);
    if (!login) return setError('Eso no parece un usuario de GitHub.');
    if (login === me?.login) return setError('Ese usuario eres tú.');
    if (friends?.includes(login)) return setError('Ya está en tu lista.');
    if ((friends?.length ?? 0) >= MAX_FRIENDS) return setError(`Has llegado al máximo de ${MAX_FRIENDS}.`);
    await addFriend(login);
    setInput('');
    setError(null);
    toast.success(profiles?.has(login) ? `@${login} está en tus amigos.` : `@${login} está en tus amigos. Aparecerá con sus puntos cuando publique algo.`);
  };

  return (
    <>
      <PageHeader title="Amigos" description="Sigue a quien quieras y comparad vuestro progreso. La lista sólo está en este dispositivo: nadie se entera de a quién añades." />
      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <form onSubmit={(e) => void submit(e)}>
            <Field label="Añadir por usuario de GitHub" hint="También vale @usuario o el enlace a su perfil." error={error ?? undefined}>
              {(id, describedBy) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    list={listId}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="usuario"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setError(null);
                    }}
                  />
                  <Button type="submit" variant="primary" icon={<UserPlus size={16} aria-hidden />} disabled={!input.trim()} className="shrink-0">
                    Añadir
                  </Button>
                </div>
              )}
            </Field>
            <datalist id={listId}>
              {[...(profiles?.values() ?? [])]
                .filter((p) => p.login !== me?.login && !friends?.includes(p.login))
                .map((p) => (
                  <option key={p.login} value={p.login}>
                    {p.displayName ?? ''}
                  </option>
                ))}
            </datalist>
          </form>
        </Card>
        <FriendsRanking manage />
        <Suggestions exclude={new Set([...(friends ?? []), me?.login ?? ''])} />
      </div>
    </>
  );
}
