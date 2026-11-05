import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeSubmission } from '@core/submissions/envelope';
import type { Submission } from '@core/schema/submission';
import { DataStore } from '../../tools/lib/data-store';
import { GitWorkspace } from '../../tools/lib/git';
import type { GitHubApi, IssueData, IssueUser, PullData, PullFile, RepoPermission } from '../../tools/lib/github';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Un repositorio de verdad: remoto bare y copia de trabajo. Las operaciones de git son reales. */
export function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'qb-repo-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '--bare', '--initial-branch=data', remote], { stdio: 'ignore' });
  execFileSync('git', ['clone', remote, work], { stdio: 'ignore' });
  git(work, 'config', 'user.name', 'test');
  git(work, 'config', 'user.email', 'test@example.org');
  git(work, 'checkout', '-b', 'data');
  writeFileSync(join(work, 'README.md'), 'Datos comunitarios\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'Inicio');
  git(work, 'push', 'origin', 'data');
  return { root, remote, work, git: new GitWorkspace(work, 'data', { retryDelayMs: 0 }), store: new DataStore(work), cleanup: () => rmSync(root, { recursive: true, force: true }), log: (...args: string[]) => git(work, ...args), remoteLog: (...args: string[]) => git(remote, ...args) };
}

let nextNumber = 1;

export function user(login: string, id = 1000 + login.length): IssueUser {
  return { login, id, type: 'User', avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4` };
}

export async function issueFor(submission: Submission, author: IssueUser, createdAt: number, summary = 'Resumen'): Promise<IssueData> {
  const encoded = await encodeSubmission(submission, summary);
  const number = nextNumber++;
  return {
    number,
    title: encoded.title,
    body: encoded.body,
    state: 'open',
    labels: [],
    created_at: new Date(createdAt).toISOString(),
    user: author,
    html_url: `https://github.com/o/r/issues/${number}`,
    node_id: `NODE${number}`,
    is_pull_request: false,
  };
}

/** Sustituto de la API de GitHub que simula lo justo y deja registro de lo que se le pide. */
export class FakeGitHub implements GitHubApi {
  issues: IssueData[] = [];
  comments = new Map<number, string[]>();
  labels = new Map<number, string[]>();
  closed = new Map<number, string>();
  pulls: { number: number; title: string; body: string; head: string; base: string; html_url: string }[] = [];
  merged: number[] = [];
  dispatched: string[] = [];
  deletedBranches: string[] = [];
  permissions = new Map<string, RepoPermission>();
  mergeSucceeds = true;
  pullData = new Map<number, PullData>();
  pullFiles = new Map<number, PullFile[]>();
  blobs = new Map<string, Uint8Array>();
  /** Se llama al fusionar, para aplicar el merge sobre el remoto real. */
  onMerge: (number: number, head: string) => void = () => undefined;

  async listOpenIssues() {
    return this.issues.filter((i) => i.state === 'open');
  }
  async comment(issue: number, body: string) {
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), body]);
  }
  async addLabels(issue: number, labels: string[]) {
    this.labels.set(issue, [...(this.labels.get(issue) ?? []), ...labels]);
    const found = this.issues.find((i) => i.number === issue);
    if (found) found.labels.push(...labels);
  }
  async closeIssue(issue: number, reason: 'completed' | 'not_planned') {
    this.closed.set(issue, reason);
    const found = this.issues.find((i) => i.number === issue);
    if (found) found.state = 'closed';
  }
  async createPull(input: { title: string; body: string; head: string; base: string }) {
    const number = 5000 + this.pulls.length;
    const pull = { number, ...input, html_url: `https://github.com/o/r/pull/${number}` };
    this.pulls.push(pull);
    return { number, html_url: pull.html_url };
  }
  async mergePull(number: number, _sha: string, _title: string) {
    if (!this.mergeSucceeds) return false;
    this.merged.push(number);
    const pull = this.pulls.find((p) => p.number === number);
    if (pull) this.onMerge(number, pull.head);
    return true;
  }
  async getPull(number: number) {
    const pull = this.pullData.get(number);
    if (!pull) throw new Error(`PR ${number} desconocido`);
    return pull;
  }
  async listPullFiles(number: number) {
    return this.pullFiles.get(number) ?? [];
  }
  async getBlob(_repo: string, sha: string) {
    const blob = this.blobs.get(sha);
    if (!blob) throw new Error(`Blob ${sha} desconocido`);
    return blob;
  }
  async permission(login: string) {
    return this.permissions.get(login) ?? 'read';
  }
  async dispatchWorkflow(file: string) {
    this.dispatched.push(file);
  }
  async deleteBranch(name: string) {
    this.deletedBranches.push(name);
  }
  async getIssue(number: number) {
    return this.issues.find((i) => i.number === number) ?? null;
  }
  lastComment(issue: IssueData): string {
    return this.comments.get(issue.number)?.at(-1) ?? '';
  }
}
