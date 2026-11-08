import { config } from '@/infra/config';
import { createStore } from '@/infra/store';

/**
 * Llamadas a la API de GitHub desde el navegador.
 *
 * Sin token, GitHub concede 60 peticiones por hora y por IP, y hasta un `304` gasta cuota
 * (comprobado). Por eso lo anónimo se usa sólo para cosas puntuales y se lleva la cuenta: todo
 * lo que se puede leer va por Pages, que no tiene ese límite.
 */

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export class RateLimitError extends GitHubError {
  readonly resetAt: number;
  constructor(resetAt: number) {
    super(429, 'GitHub limita las consultas sin token. Inténtalo más tarde.');
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: number;
}

export const rateLimit = createStore<RateLimitInfo | null>(null);

/** Se deja un margen para no gastar hasta la última petición y dejar sin nada al resto de la IP. */
const ANONYMOUS_FLOOR = 5;

/** Se comprobó en real: la API devuelve 5xx de vez en cuando, y repetir la petición funciona. */
const TRANSIENT_ATTEMPTS = 3;

export async function github(path: string, options: { token?: string | null; method?: string; body?: unknown; retry?: boolean } = {}): Promise<Response> {
  const { method = 'GET', retry = method === 'GET' } = options;
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await request(path, options);
    } catch (error) {
      // TypeError: fallo de red. Lo demás (el límite de consultas) no mejora reintentando ya.
      if (!(error instanceof TypeError) || !retry || attempt >= TRANSIENT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    if (response.status < 500 || !retry || attempt >= TRANSIENT_ATTEMPTS) return response;
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
}

async function request(path: string, options: { token?: string | null; method?: string; body?: unknown }): Promise<Response> {
  const { token, method = 'GET', body } = options;
  const known = rateLimit.get();
  if (!token && known && known.remaining <= ANONYMOUS_FLOOR && Date.now() < known.resetAt) {
    throw new RateLimitError(known.resetAt);
  }
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    // Sin cookies: la identidad sólo la da el token, si lo hay.
    credentials: 'omit',
  });
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  const limit = Number(response.headers.get('x-ratelimit-limit'));
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (limit > 0) rateLimit.set({ remaining, limit, resetAt: reset * 1000 });
  if ((response.status === 403 || response.status === 429) && remaining === 0) throw new RateLimitError(reset * 1000);
  return response;
}

export async function githubJson<T>(path: string, options: { token?: string | null; method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const response = await github(path, options);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new GitHubError(response.status, detail?.message ?? `GitHub respondió ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface RemoteIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  labels: { name: string }[];
  user: { login: string; id: number; avatar_url: string; type: string };
  pull_request?: unknown;
}

/** Los issues recientes del repositorio. Una sola petición resuelve el estado de todos los envíos. */
export function listRecentIssues(options: { token?: string | null; creator?: string } = {}): Promise<RemoteIssue[]> {
  const params = new URLSearchParams({ state: 'all', sort: 'created', direction: 'desc', per_page: '100' });
  if (options.creator) params.set('creator', options.creator);
  return githubJson<RemoteIssue[]>(`/repos/${config.repo}/issues?${params.toString()}`, { token: options.token });
}

export interface IssueComment {
  body: string;
  user: { login: string; type: string };
}

export function listIssueComments(issue: number, token?: string | null): Promise<IssueComment[]> {
  return githubJson<IssueComment[]>(`/repos/${config.repo}/issues/${issue}/comments?per_page=20`, { token });
}

export interface WhoAmI {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
}

export interface TokenCheck {
  user: WhoAmI;
  scopes: string[];
}

/** Comprueba el token y qué permisos tiene de verdad. */
export async function checkToken(token: string): Promise<TokenCheck> {
  const response = await github('/user', { token });
  if (response.status === 401) throw new GitHubError(401, 'GitHub no reconoce este token. Puede estar mal copiado o caducado.');
  if (!response.ok) throw new GitHubError(response.status, `GitHub respondió ${response.status}`);
  const scopes = (response.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { user: (await response.json()) as WhoAmI, scopes };
}

export function createIssue(token: string, title: string, body: string): Promise<RemoteIssue> {
  return githubJson<RemoteIssue>(`/repos/${config.repo}/issues`, { token, method: 'POST', body: { title, body } });
}

export interface PullFileWrite {
  path: string;
  /** Texto o bytes en base64. */
  content: string;
  encoding: 'utf-8' | 'base64';
}

const DATA_BRANCH = 'data';

/**
 * Vía con token: fork, rama, commit atómico y PR. Es la que admite imágenes grandes y lotes sin
 * límite práctico. Todo pasa por la API de datos de Git para que el commit sea uno solo.
 */
export async function openContributionPull(token: string, login: string, branch: string, title: string, body: string, files: readonly PullFileWrite[]): Promise<{ number: number; html_url: string }> {
  const [owner, name] = config.repo.split('/') as [string, string];
  // El dueño no puede hacer fork de su propio repositorio: su rama va en el mismo repo.
  const isOwner = owner.toLowerCase() === login.toLowerCase();
  const target = isOwner ? config.repo : `${login}/${name}`;
  // Todo este flujo se puede repetir sin daño: los blobs, árboles y commits sólo crean objetos, y
  // la rama lleva un nombre único. Por eso sus POST sí se reintentan ante un 5xx.
  const send = <T,>(path: string, body: unknown) => githubJson<T>(path, { token, method: 'POST', body, retry: true });
  if (!isOwner) await send(`/repos/${config.repo}/forks`, { default_branch_only: false });

  // Un fork recién creado tarda en estar disponible, y sólo se puede sincronizar cuando lo está.
  let head: string | null = null;
  for (let attempt = 0; attempt < 10 && head === null; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!isOwner) {
      const sync = await github(`/repos/${target}/merge-upstream`, { token, method: 'POST', body: { branch: DATA_BRANCH }, retry: true });
      if (!sync.ok && sync.status !== 409) continue;
    }
    const ref = await github(`/repos/${target}/git/ref/heads/${DATA_BRANCH}`, { token });
    if (ref.ok) head = ((await ref.json()) as { object: { sha: string } }).object.sha;
  }
  if (head === null) throw new GitHubError(504, 'El fork no está listo todavía. Vuelve a intentarlo en un minuto.');

  const baseCommit = await githubJson<{ tree: { sha: string } }>(`/repos/${target}/git/commits/${head}`, { token });
  // El texto va dentro del árbol: una sola petición, y no se roza el límite de 80 creaciones por minuto.
  const tree = [];
  for (const file of files) {
    if (file.encoding === 'utf-8') {
      tree.push({ path: file.path, mode: '100644', type: 'blob', content: file.content });
      continue;
    }
    const blob = await send<{ sha: string }>(`/repos/${target}/git/blobs`, { content: file.content, encoding: file.encoding });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await send<{ sha: string }>(`/repos/${target}/git/trees`, { base_tree: baseCommit.tree.sha, tree });
  const commit = await send<{ sha: string }>(`/repos/${target}/git/commits`, { message: title, tree: newTree.sha, parents: [head] });

  // Un 5xx puede haber creado la rama o el PR igualmente: que ya existan no es un error.
  const ref = await github(`/repos/${target}/git/refs`, { token, method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha }, retry: true });
  if (!ref.ok && ref.status !== 422) throw new GitHubError(ref.status, `GitHub respondió ${ref.status} al crear la rama`);
  const headLabel = isOwner ? branch : `${login}:${branch}`;
  const pull = await github(`/repos/${owner}/${name}/pulls`, { token, method: 'POST', body: { title, body, head: headLabel, base: DATA_BRANCH, maintainer_can_modify: false }, retry: true });
  if (pull.ok) return (await pull.json()) as { number: number; html_url: string };
  if (pull.status === 422) {
    const [existing] = await githubJson<{ number: number; html_url: string }[]>(`/repos/${owner}/${name}/pulls?state=open&head=${isOwner ? owner : login}:${branch}`, { token });
    if (existing) return existing;
  }
  const detail = (await pull.json().catch(() => null)) as { message?: string } | null;
  throw new GitHubError(pull.status, detail?.message ?? `GitHub respondió ${pull.status} al abrir el pull request`);
}
