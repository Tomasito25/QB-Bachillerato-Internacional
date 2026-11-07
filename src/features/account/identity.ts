import { normalizeLogin } from '@core/schema/common';
import { encodeSubmission } from '@core/submissions/envelope';
import { bytesToBase64Url } from '@core/util/encoding';
import { clearToken, setToken } from '@/infra/crypto/tokenVault';
import { kvDelete, kvGet, kvSet } from '@/infra/db/db';
import { checkToken, GitHubError, listRecentIssues, type TokenCheck } from '@/infra/github/client';
import { config } from '@/infra/config';
import { createStore } from '@/infra/store';

/**
 * Quién usa esta app, según este dispositivo.
 *
 * Es sólo una etiqueta local para personalizar: que alguien manipule esto no le da nada, porque
 * ningún dato oficial depende de ello. Lo oficial se atribuye al autor real del issue o del PR,
 * que certifica GitHub.
 */
export interface Identity {
  login: string;
  id: number;
  avatarUrl: string;
  verifiedAt: number;
  /** `issue`: sin token. `token`: además puede publicar sin clics. */
  via: 'issue' | 'token';
}

export const identity = createStore<Identity | null>(null);
/** Hay token utilizable en esta sesión. */
export const tokenReady = createStore<boolean>(false);

const KEY = 'identity';
const PENDING_KEY = 'pending-connect';

export async function loadIdentity(): Promise<void> {
  identity.set((await kvGet<Identity>(KEY)) ?? null);
}

async function saveIdentity(next: Identity): Promise<void> {
  identity.set(next);
  await kvSet(KEY, next);
}

export function newNonce(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(9)));
}

export interface PendingConnect {
  nonce: string;
  url: string;
  startedAt: number;
}

/** Prepara el issue de conexión. Lo abre el usuario con su sesión de GitHub: no hay contraseña ni token aquí. */
export async function startConnect(): Promise<PendingConnect> {
  const nonce = newNonce();
  const encoded = await encodeSubmission({ v: 1, kind: 'connect', nonce }, `Conecto mi cuenta de GitHub a ${config.appName}. Este issue sólo prueba que soy yo, y se cierra solo.`);
  const params = new URLSearchParams({ title: encoded.title, body: encoded.body });
  const pending: PendingConnect = { nonce, url: `https://github.com/${config.repo}/issues/new?${params.toString()}`, startedAt: Date.now() };
  await kvSet(PENDING_KEY, pending);
  return pending;
}

export function getPendingConnect(): Promise<PendingConnect | undefined> {
  return kvGet<PendingConnect>(PENDING_KEY);
}

export async function cancelConnect(): Promise<void> {
  await kvDelete(PENDING_KEY);
}

/** Busca el issue por su nonce. Quien lo creó lo dice GitHub, no el cliente. */
export async function checkConnect(): Promise<Identity | null> {
  const pending = await getPendingConnect();
  if (!pending) return identity.get();
  const issues = await listRecentIssues();
  const match = issues.find((issue) => issue.title.startsWith('[QB:connect]') && issue.title.endsWith(pending.nonce));
  if (!match || match.user.type !== 'User') return null;
  const next: Identity = {
    login: normalizeLogin(match.user.login),
    id: match.user.id,
    avatarUrl: match.user.avatar_url,
    verifiedAt: Date.now(),
    via: identity.get()?.via === 'token' ? 'token' : 'issue',
  };
  await saveIdentity(next);
  await kvDelete(PENDING_KEY);
  return next;
}

export async function disconnect(): Promise<void> {
  identity.set(null);
  tokenReady.set(false);
  await kvDelete(KEY);
  await kvDelete(PENDING_KEY);
  await clearToken();
}

export class TokenScopeError extends GitHubError {
  constructor() {
    super(403, 'A este token le falta el permiso public_repo. Sin él no puede abrir pull requests.');
    this.name = 'TokenScopeError';
  }
}

/**
 * Los tokens de grano fino no pueden contribuir a repos públicos ajenos (lo documenta GitHub),
 * así que hace falta uno clásico con `public_repo`. La app comprueba el alcance real: si tiene
 * más del necesario, lo avisa.
 */
export async function connectWithToken(token: string, remember: boolean): Promise<{ identity: Identity; check: TokenCheck; excessive: string[] }> {
  const check = await checkToken(token.trim());
  const hasAccess = check.scopes.includes('public_repo') || check.scopes.includes('repo');
  if (!hasAccess) throw new TokenScopeError();
  await setToken(token.trim(), remember);
  tokenReady.set(true);
  const next: Identity = { login: normalizeLogin(check.user.login), id: check.user.id, avatarUrl: check.user.avatar_url, verifiedAt: Date.now(), via: 'token' };
  await saveIdentity(next);
  await kvDelete(PENDING_KEY);
  return { identity: next, check, excessive: check.scopes.filter((s) => s !== 'public_repo') };
}

export async function removeToken(): Promise<void> {
  await clearToken();
  tokenReady.set(false);
  const current = identity.get();
  if (current) await saveIdentity({ ...current, via: 'issue' });
}

export const TOKEN_CREATE_URL = `https://github.com/settings/tokens/new?scopes=public_repo&description=${encodeURIComponent(config.appName)}`;
