// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitWorkspace } from '../../tools/lib/git';
import { GitHubHttpError, isMaintainerPermission, RestGitHub } from '../../tools/lib/github';

/** Registra cada petición y responde con lo que se le indique. */
function stubFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> });
    return responder(url, init);
  });
  return calls;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });

describe('cliente REST de las Actions', () => {
  const api = new RestGitHub('dueno/repo', 'token-de-prueba');

  afterEach(() => vi.unstubAllGlobals());

  it('autentica cada petición y usa la versión fijada de la API', async () => {
    const calls = stubFetch(() => json([]));
    await api.listOpenIssues();
    expect(calls[0]?.url).toBe('https://api.github.com/repos/dueno/repo/issues?state=open&sort=created&direction=asc&per_page=100');
    expect(calls[0]?.headers.Authorization).toBe('Bearer token-de-prueba');
    expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('distingue issues de PR y aplana las etiquetas', async () => {
    stubFetch(() =>
      json([
        { number: 1, title: 'a', body: 'x', state: 'open', labels: [{ name: 'qb:accepted' }, 'suelta'], created_at: 'c', user: { login: 'ana', id: 1, type: 'User', avatar_url: 'u' }, html_url: 'h', node_id: 'n' },
        { number: 2, title: 'b', body: null, state: 'open', labels: [], created_at: 'c', user: null, html_url: 'h', node_id: 'n', pull_request: {} },
      ]),
    );
    const [issue, pull] = await api.listOpenIssues();
    expect(issue?.labels).toEqual(['qb:accepted', 'suelta']);
    expect(issue?.is_pull_request).toBe(false);
    expect(pull?.is_pull_request).toBe(true);
    // Una cuenta borrada aparece sin usuario: no debe contar como persona.
    expect(pull?.user.type).toBe('Bot');
  });

  it('comenta, etiqueta y cierra con las rutas correctas', async () => {
    const calls = stubFetch(() => json({}));
    await api.comment(7, 'hola');
    await api.addLabels(7, ['qb:accepted']);
    await api.closeIssue(7, 'not_planned');
    expect(calls.map((c) => [c.method, c.url.replace('https://api.github.com', '')])).toEqual([
      ['POST', '/repos/dueno/repo/issues/7/comments'],
      ['POST', '/repos/dueno/repo/issues/7/labels'],
      ['PATCH', '/repos/dueno/repo/issues/7'],
    ]);
    expect(calls[2]?.body).toEqual({ state: 'closed', state_reason: 'not_planned' });
  });

  it('fusiona indicando el commit validado, con squash', async () => {
    const calls = stubFetch(() => json({ merged: true }));
    expect(await api.mergePull(5, 'abc123', 'Título')).toBe(true);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toContain('/pulls/5/merge');
    expect(calls[0]?.body).toEqual({ sha: 'abc123', merge_method: 'squash', commit_title: 'Título' });
  });

  it('si el PR cambió o no se puede fusionar, lo dice sin lanzar', async () => {
    stubFetch(() => json({ message: 'Head branch was modified' }, 409));
    expect(await api.mergePull(5, 'abc', 't')).toBe(false);
    stubFetch(() => json({ message: 'Not mergeable' }, 405));
    expect(await api.mergePull(5, 'abc', 't')).toBe(false);
  });

  it('un error de verdad al fusionar sí se propaga', async () => {
    stubFetch(() => json({ message: 'Server error' }, 500));
    await expect(api.mergePull(5, 'abc', 't')).rejects.toBeInstanceOf(GitHubHttpError);
  });

  it('no deja que un PR dé permiso de edición a los mantenedores por defecto', async () => {
    const calls = stubFetch(() => json({ number: 1, html_url: 'h' }));
    await api.createPull({ title: 't', body: 'b', head: 'contrib/issue-1', base: 'data' });
    expect(calls[0]?.body).toMatchObject({ head: 'contrib/issue-1', base: 'data' });
  });

  it('pagina los ficheros de un PR', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}`, status: 'added', sha: 's' }));
    const calls = stubFetch((url) => json(url.includes('page=1') && !url.includes('per_page=100&page=2') ? page(100) : page(3)));
    expect(await api.listPullFiles(9)).toHaveLength(103);
    expect(calls).toHaveLength(2);
  });

  it('lee los blobs como bytes, desde el repositorio del fork', async () => {
    const calls = stubFetch(() => json({ content: Buffer.from([1, 2, 3]).toString('base64'), encoding: 'base64' }));
    expect(await api.getBlob('otra/repo', 'sha1')).toEqual(Uint8Array.from([1, 2, 3]));
    expect(calls[0]?.url).toBe('https://api.github.com/repos/otra/repo/git/blobs/sha1');
  });

  it('normaliza un PR de un fork borrado', async () => {
    stubFetch(() => json({ number: 1, title: 't', body: null, state: 'open', merged: false, user: { login: 'a', id: 1, type: 'User', avatar_url: 'u' }, html_url: 'h', head: { sha: 's', ref: 'r', repo: null }, base: { ref: 'data' } }));
    expect((await api.getPull(1)).head.repo).toBeNull();
  });

  it('una persona sin permisos se trata como tal, no como un error', async () => {
    stubFetch(() => json({}, 404));
    expect(await api.permission('nadie')).toBe('none');
    stubFetch(() => json({ permission: 'write' }));
    expect(await api.permission('mod')).toBe('write');
    expect(isMaintainerPermission('write')).toBe(true);
    expect(isMaintainerPermission('admin')).toBe(true);
    expect(isMaintainerPermission('read')).toBe(false);
    expect(isMaintainerPermission('triage')).toBe(false);
    expect(isMaintainerPermission('none')).toBe(false);
  });

  it('dispara el despliegue en la rama indicada', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await api.dispatchWorkflow('deploy.yml', 'main');
    expect(calls[0]?.url).toContain('/actions/workflows/deploy.yml/dispatches');
    expect(calls[0]?.body).toEqual({ ref: 'main' });
  });

  it('borrar una rama ya borrada no es un error', async () => {
    stubFetch(() => json({}, 404));
    await expect(api.deleteBranch('x')).resolves.toBeUndefined();
    stubFetch(() => json({}, 500));
    await expect(api.deleteBranch('x')).rejects.toBeInstanceOf(GitHubHttpError);
  });

  it('respeta retry-after en el límite secundario y reintenta', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return attempts === 1 ? json({ message: 'secondary rate limit' }, 403, { 'retry-after': '5' }) : json([]);
    });
    const pending = api.listOpenIssues();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toEqual([]);
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });

  it('un 403 de permisos no se reintenta', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return json({ message: 'Resource not accessible by integration' }, 403, { 'x-ratelimit-remaining': '999' });
    });
    await expect(api.comment(1, 'x')).rejects.toBeInstanceOf(GitHubHttpError);
    expect(attempts).toBe(1);
  });
});

describe('git con un clon superficial, como en Actions', () => {
  let root: string;
  let remote: string;
  let shallow: GitWorkspace;
  let shallowDir: string;
  let other: string;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'qb-git-'));
    remote = join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', '--initial-branch=data', remote], { stdio: 'ignore' });
    other = join(root, 'other');
    execFileSync('git', ['clone', remote, other], { stdio: 'ignore' });
    git(other, 'config', 'user.name', 'otro');
    git(other, 'config', 'user.email', 'otro@example.org');
    git(other, 'checkout', '-b', 'data');
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(other, `f${i}.txt`), String(i));
      git(other, 'add', '-A');
      git(other, 'commit', '-m', `c${i}`);
    }
    git(other, 'push', 'origin', 'data');
    shallowDir = join(root, 'shallow');
    execFileSync('git', ['clone', '--depth', '1', '--branch', 'data', `file://${remote}`, shallowDir], { stdio: 'ignore' });
    shallow = new GitWorkspace(shallowDir);
    await shallow.configureBot();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sube un commit', async () => {
    writeFileSync(join(shallowDir, 'nuevo.txt'), 'x');
    expect(await shallow.commitAll('Nuevo')).toBe(true);
    await shallow.pushData();
    git(other, 'pull', 'origin', 'data');
    expect(git(other, 'log', '-1', '--format=%s')).toBe('Nuevo');
  });

  it('si alguien se adelanta, integra sus cambios y reintenta', async () => {
    writeFileSync(join(other, 'ajeno.txt'), 'y');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'Ajeno');
    git(other, 'push', 'origin', 'data');

    writeFileSync(join(shallowDir, 'mio.txt'), 'x');
    await shallow.commitAll('Mío');
    await shallow.pushData();

    git(other, 'pull', 'origin', 'data');
    expect(git(other, 'log', '-2', '--format=%s')).toBe('Mío\nAjeno');
  });

  it('sin cambios no hace commit', async () => {
    expect(await shallow.commitAll('Nada')).toBe(false);
  });

  it('una rama de aportación parte de lo último y se sube aparte', async () => {
    writeFileSync(join(other, 'ultimo.txt'), 'y');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'Último');
    git(other, 'push', 'origin', 'data');

    await shallow.syncData();
    await shallow.startBranch('contrib/issue-9');
    writeFileSync(join(shallowDir, 'aporte.txt'), 'x');
    await shallow.commitAll('Aporte');
    await shallow.pushBranch('contrib/issue-9');
    expect(git(remote, 'log', '-2', '--format=%s', 'contrib/issue-9')).toBe('Aporte\nÚltimo');
    expect(git(remote, 'log', '-1', '--format=%s', 'data')).toBe('Último');
  });

  it('descarta un envío a medias sin tocar los commits ya hechos', async () => {
    writeFileSync(join(shallowDir, 'bueno.txt'), 'x');
    await shallow.commitAll('Bueno');
    writeFileSync(join(shallowDir, 'a-medias.txt'), 'x');
    writeFileSync(join(shallowDir, 'f1.txt'), 'modificado');
    await shallow.discardChanges();
    expect(git(shallowDir, 'status', '--porcelain')).toBe('');
    expect(git(shallowDir, 'log', '-1', '--format=%s')).toBe('Bueno');
  });

  it('volver a data deja la copia igual que el remoto', async () => {
    writeFileSync(join(shallowDir, 'basura.txt'), 'x');
    await shallow.syncData();
    expect(git(shallowDir, 'status', '--porcelain')).toBe('');
  });

  it('un mensaje con caracteres raros no ejecuta nada', async () => {
    writeFileSync(join(shallowDir, 'x.txt'), 'x');
    await shallow.commitAll('$(touch /tmp/qb-pwned) `rm -rf /`; "comillas" \'simples\'');
    expect(git(shallowDir, 'log', '-1', '--format=%s')).toContain('$(touch');
  });
});
