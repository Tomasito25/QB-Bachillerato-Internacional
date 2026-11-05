/**
 * Cliente mínimo de la API de GitHub para las Actions. Va detrás de una interfaz para que el
 * pipeline se pueda probar de punta a punta sin red.
 */

export interface IssueUser {
  login: string;
  id: number;
  type: string;
  avatar_url: string;
}

export interface IssueData {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  created_at: string;
  user: IssueUser;
  html_url: string;
  node_id: string;
  /** Presente si en realidad es un PR: la API de issues también los devuelve. */
  is_pull_request: boolean;
}

export interface PullFile {
  filename: string;
  status: string;
  sha: string;
}

export interface PullData {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  user: IssueUser;
  html_url: string;
  head: { sha: string; ref: string; repo: string | null };
  base: { ref: string };
}

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

export interface GitHubApi {
  listOpenIssues(): Promise<IssueData[]>;
  comment(issue: number, body: string): Promise<void>;
  addLabels(issue: number, labels: string[]): Promise<void>;
  closeIssue(issue: number, reason: 'completed' | 'not_planned'): Promise<void>;
  createPull(input: { title: string; body: string; head: string; base: string }): Promise<{ number: number; html_url: string }>;
  mergePull(number: number, sha: string, title: string): Promise<boolean>;
  getPull(number: number): Promise<PullData>;
  listPullFiles(number: number): Promise<PullFile[]>;
  getBlob(repo: string, sha: string): Promise<Uint8Array>;
  permission(login: string): Promise<RepoPermission>;
  dispatchWorkflow(file: string, ref: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  /** Lee un issue para enlazar un PR con su envío de origen. */
  getIssue(number: number): Promise<IssueData | null>;
}

export const isMaintainerPermission = (permission: RepoPermission): boolean => ['admin', 'maintain', 'write'].includes(permission);

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: ({ name?: string } | string)[];
  created_at: string;
  user: IssueUser | null;
  html_url: string;
  node_id: string;
  pull_request?: unknown;
}

function toIssue(raw: RawIssue): IssueData {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    labels: raw.labels.map((label) => (typeof label === 'string' ? label : (label.name ?? ''))),
    created_at: raw.created_at,
    user: raw.user ?? { login: 'ghost', id: 0, type: 'Bot', avatar_url: '' },
    html_url: raw.html_url,
    node_id: raw.node_id,
    is_pull_request: raw.pull_request !== undefined,
  };
}

export class GitHubHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`GitHub ${status}: ${message}`);
    this.name = 'GitHubHttpError';
    this.status = status;
  }
}

export class RestGitHub implements GitHubApi {
  private readonly repo: string;
  private readonly token: string;

  constructor(repo: string, token: string) {
    this.repo = repo;
    this.token = token;
  }

  private async request(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    // Límite secundario: GitHub dice cuánto esperar. Se respeta y se reintenta.
    if ((response.status === 403 || response.status === 429) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      if (retryAfter > 0 || response.headers.get('x-ratelimit-remaining') === '0') {
        await new Promise((resolve) => setTimeout(resolve, Math.min(120, retryAfter || 30) * 1000));
        return this.request(path, init, attempt + 1);
      }
    }
    return response;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) throw new GitHubHttpError(response.status, (await response.text()).slice(0, 300));
    return (await response.json()) as T;
  }

  private async send(path: string, method: string, body?: unknown): Promise<void> {
    const response = await this.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new GitHubHttpError(response.status, (await response.text()).slice(0, 300));
  }

  async listOpenIssues(): Promise<IssueData[]> {
    // La primera página basta: se procesa un lote por ejecución y el resto queda para la siguiente.
    const raw = await this.json<RawIssue[]>(`/repos/${this.repo}/issues?state=open&sort=created&direction=asc&per_page=100`);
    return raw.map(toIssue);
  }

  comment(issue: number, body: string): Promise<void> {
    return this.send(`/repos/${this.repo}/issues/${issue}/comments`, 'POST', { body });
  }

  addLabels(issue: number, labels: string[]): Promise<void> {
    return this.send(`/repos/${this.repo}/issues/${issue}/labels`, 'POST', { labels });
  }

  closeIssue(issue: number, reason: 'completed' | 'not_planned'): Promise<void> {
    return this.send(`/repos/${this.repo}/issues/${issue}`, 'PATCH', { state: 'closed', state_reason: reason });
  }

  createPull(input: { title: string; body: string; head: string; base: string }): Promise<{ number: number; html_url: string }> {
    return this.json(`/repos/${this.repo}/pulls`, { method: 'POST', body: JSON.stringify({ ...input, maintainer_can_modify: false }) });
  }

  async mergePull(number: number, sha: string, title: string): Promise<boolean> {
    // `sha` evita mezclar algo distinto de lo validado si el PR cambió entre medias.
    const response = await this.request(`/repos/${this.repo}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ sha, merge_method: 'squash', commit_title: title }) });
    if (response.ok) return true;
    if (response.status === 405 || response.status === 409) return false;
    throw new GitHubHttpError(response.status, (await response.text()).slice(0, 300));
  }

  async getPull(number: number): Promise<PullData> {
    const raw = await this.json<{ number: number; title: string; body: string | null; state: string; merged: boolean; user: IssueUser; html_url: string; head: { sha: string; ref: string; repo: { full_name: string } | null }; base: { ref: string } }>(`/repos/${this.repo}/pulls/${number}`);
    return { ...raw, head: { sha: raw.head.sha, ref: raw.head.ref, repo: raw.head.repo?.full_name ?? null } };
  }

  async listPullFiles(number: number): Promise<PullFile[]> {
    const out: PullFile[] = [];
    for (let page = 1; page <= 30; page++) {
      const files = await this.json<PullFile[]>(`/repos/${this.repo}/pulls/${number}/files?per_page=100&page=${page}`);
      out.push(...files);
      if (files.length < 100) break;
    }
    return out;
  }

  async getBlob(repo: string, sha: string): Promise<Uint8Array> {
    const blob = await this.json<{ content: string; encoding: string }>(`/repos/${repo}/git/blobs/${sha}`);
    return Uint8Array.from(Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8'));
  }

  async permission(login: string): Promise<RepoPermission> {
    const response = await this.request(`/repos/${this.repo}/collaborators/${encodeURIComponent(login)}/permission`);
    if (!response.ok) return 'none';
    return ((await response.json()) as { permission: RepoPermission }).permission;
  }

  dispatchWorkflow(file: string, ref: string): Promise<void> {
    return this.send(`/repos/${this.repo}/actions/workflows/${file}/dispatches`, 'POST', { ref });
  }

  async deleteBranch(name: string): Promise<void> {
    const response = await this.request(`/repos/${this.repo}/git/refs/heads/${name}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 422) throw new GitHubHttpError(response.status, (await response.text()).slice(0, 300));
  }

  async getIssue(number: number): Promise<IssueData | null> {
    const response = await this.request(`/repos/${this.repo}/issues/${number}`);
    return response.ok ? toIssue((await response.json()) as RawIssue) : null;
  }
}
