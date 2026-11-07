import { useLiveQuery } from 'dexie-react-hooks';
import { Login, normalizeLogin } from '@core/schema/common';
import { kvGet, kvSet } from '@/infra/db/db';

/**
 * Amigos: a quién sigues para compararte. La lista vive sólo en este dispositivo (y en las
 * copias de seguridad): no se publica, así que nadie sabe a quién añades. Todo lo que se ve
 * de un amigo es su perfil público, que ya puede ver cualquiera.
 */

const KEY = 'friends';
export const MAX_FRIENDS = 200;

/** Acepta `ana`, `@Ana` o `https://github.com/ana`. Devuelve el login o `null` si no lo es. */
export function parseLogin(input: string): string | null {
  const login = normalizeLogin(input.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, ''));
  return Login.safeParse(login).success ? login : null;
}

/** Une dos listas sin repetir y descarta lo que no sea un login. */
export function mergeFriends(a: readonly string[], b: readonly unknown[]): string[] {
  const out = new Set(a);
  for (const item of b) {
    const login = typeof item === 'string' ? parseLogin(item) : null;
    if (login) out.add(login);
  }
  return [...out].slice(0, MAX_FRIENDS);
}

export async function getFriends(): Promise<string[]> {
  return (await kvGet<string[]>(KEY)) ?? [];
}

export function useFriends(): string[] | undefined {
  return useLiveQuery(getFriends, []);
}

export async function setFriends(logins: readonly string[]): Promise<void> {
  await kvSet(KEY, [...logins]);
}

export async function addFriend(login: string): Promise<void> {
  const friends = await getFriends();
  if (!friends.includes(login)) await setFriends(mergeFriends(friends, [login]));
}

export async function removeFriend(login: string): Promise<void> {
  await setFriends((await getFriends()).filter((friend) => friend !== login));
}
