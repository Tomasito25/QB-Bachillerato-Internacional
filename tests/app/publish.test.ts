import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Question } from '@core/schema/question';
import { Submission } from '@core/schema/submission';
import { SubjectDoc } from '@core/schema/taxonomy';
import { decodeIssueBody } from '@core/submissions/envelope';
import { connectWithToken, disconnect, identity, TokenScopeError } from '@/features/account/identity';
import { saveLocalQuestion } from '@/features/bank/questionsRepo';
import { discardItem, flushWithToken, isOpen, LABEL_TO_STATUS, manualTransport, markAwaitingUser, refreshStatuses } from '@/features/sync/outbox';
import { publishResults, publishViaIssue, publishViaPull, unpublishedAnswerCount } from '@/features/sync/publish';
import { clearToken, decryptToken, encryptToken, generateVaultKey, getToken, setToken } from '@/infra/crypto/tokenVault';
import { db } from '@/infra/db/db';
import type { AttemptRow, OutboxRow } from '@/infra/db/types';
import { makeMcq, makeSubject, SUBJECT_ID, TOPIC_ID, uuid } from '../fixtures';

vi.mock('@/infra/config', async () => ({
  config: { version: 'test', base: '/', repo: 'owner/questionbank', communityUrl: (path: string) => `/community/${path}` },
  hasCommunity: () => true,
}));

beforeEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(db.tables.map((table) => table.clear()));
  identity.set(null);
  await clearToken();
});

const attempt = (questionId: string, overrides: Partial<AttemptRow> = {}): AttemptRow => ({
  id: `attempt${Math.random().toString(36).slice(2, 10)}`,
  questionId,
  questionRev: 1,
  sessionId: null,
  mode: 'practice',
  selected: ['a'],
  selfGrade: null,
  correct: true,
  score: 1,
  durationMs: 4000,
  at: Date.now() - 1000,
  subjectId: SUBJECT_ID,
  difficulty: 3,
  published: 0,
  ...overrides,
});

describe('publicar preguntas por issue', () => {
  it('prepara un envío válido, que el servidor podrá leer', async () => {
    const question = makeMcq({ author: null });
    await db.lSubjects.put({ ...makeSubject({ createdBy: null }), local: { baseRev: null } });
    await saveLocalQuestion(question, null);

    const [row] = await publishViaIssue([question.id], 'own');
    expect(row).toMatchObject({ kind: 'questions', status: 'queued', channel: 'issue' });
    expect(row?.issueTitle).toContain('[QB:questions]');
    expect((await db.lQuestions.get(question.id))?.local).toMatchObject({ syncState: 'queued', outboxId: row?.id });

    const decoded = Submission.parse(await decodeIssueBody(row?.issueBody));
    expect(decoded.kind).toBe('questions');
    if (decoded.kind === 'questions') {
      expect(decoded.licenseAccepted).toBe(true);
      expect(decoded.origin).toBe('own');
      expect(decoded.questions).toHaveLength(1);
      expect(decoded.subjects).toHaveLength(1);
    }
  });

  it('adopta la asignatura comunitaria si ya existe con ese nombre', async () => {
    await db.cSubjects.put(makeSubject());
    const mySubject = uuid();
    const myUnit = uuid();
    const myTopic = uuid();
    await db.lSubjects.put({ ...makeSubject({ id: mySubject, name: 'ANATOMÍA', createdBy: null, units: [{ id: myUnit, name: 'sistema locomotor', order: 0, topics: [{ id: myTopic, name: 'huesos', order: 0 }] }] }), local: { baseRev: null } });
    const question = makeMcq({ author: null, subjectId: mySubject, topicIds: [myTopic] });
    await saveLocalQuestion(question, null);

    await publishViaIssue([question.id], 'own');

    const stored = await db.lQuestions.get(question.id);
    expect(stored?.subjectId).toBe(SUBJECT_ID);
    expect(stored?.topicIds).toEqual([TOPIC_ID]);
    expect(await db.lSubjects.get(mySubject)).toBeUndefined();
  });

  it('una pregunta pequeña cabe en la URL', async () => {
    const question = makeMcq({ author: null });
    await db.cSubjects.put(makeSubject());
    await saveLocalQuestion(question, null);
    const [row] = await publishViaIssue([question.id], 'own');
    expect(manualTransport(row as OutboxRow).mode).toBe('url');
  });

  it('un lote grande pasa al portapapeles o se parte, pero siempre es enviable', async () => {
    await db.cSubjects.put(makeSubject());
    const lorem = (seed: number) => Array.from({ length: 700 }, (_, i) => `palabra${(i * 7 + seed) % 97}`).join(' ');
    const questions = Array.from({ length: 45 }, (_, i) => makeMcq({ id: uuid(), author: null, statement: lorem(i) }));
    for (const q of questions) await saveLocalQuestion(q, null);
    const rows = await publishViaIssue(questions.map((q) => q.id), 'own');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(manualTransport(row).mode).not.toBe('too-large');
    const all = (await Promise.all(rows.map(async (row) => Submission.parse(await decodeIssueBody(row.issueBody))))).flatMap((s) => (s.kind === 'questions' ? s.questions : []));
    expect(all).toHaveLength(45);
  });

  it('no publica lo que no existe', async () => {
    await expect(publishViaIssue([uuid()], 'own')).rejects.toThrow(/No hay preguntas/);
  });
});

describe('publicar resultados', () => {
  it('envía lo que se marcó, nunca si acertó', async () => {
    const question = makeMcq();
    await db.cQuestions.put({ ...question, shardId: 's' });
    await db.attempts.put(attempt(question.id));
    expect(await unpublishedAnswerCount()).toBe(1);
    const [row] = await publishResults();
    const decoded = Submission.parse(await decodeIssueBody(row?.issueBody));
    if (decoded.kind !== 'results') throw new Error('tipo');
    expect(Object.keys(decoded.answers[0] as object).sort()).toEqual(['at', 'id', 'm', 'ms', 'q', 'sel']);
    expect(JSON.stringify(decoded)).not.toMatch(/correct|points|score/);
    // Ya en cola: no se ofrece publicarlas otra vez.
    expect(await unpublishedAnswerCount()).toBe(0);
  });

  it('no publica respuestas a preguntas que sólo existen aquí', async () => {
    const mine = makeMcq({ author: null });
    await saveLocalQuestion(mine, null);
    await db.attempts.put(attempt(mine.id));
    expect(await unpublishedAnswerCount()).toBe(0);
    await expect(publishResults()).rejects.toThrow(/No hay respuestas/);
  });

  it('las de una competición van por su propia entrega', async () => {
    const question = makeMcq();
    await db.cQuestions.put({ ...question, shardId: 's' });
    await db.attempts.put(attempt(question.id, { mode: 'competition' }));
    expect(await unpublishedAnswerCount()).toBe(0);
  });

  it('se marcan como publicadas sólo tras la confirmación de GitHub', async () => {
    const question = makeMcq();
    await db.cQuestions.put({ ...question, shardId: 's' });
    const row = attempt(question.id);
    await db.attempts.put(row);
    const [item] = await publishResults();
    await markAwaitingUser(item?.id as string);
    expect((await db.attempts.get(row.id))?.published).toBe(0);

    const issue = (labels: string[]) => [{ number: 7, title: `[QB:results] 1 respuestas · ${item?.nonce}`, state: 'closed', html_url: 'https://github.com/o/r/issues/7', created_at: '', labels: labels.map((name) => ({ name })), user: { login: 'ana', id: 1, avatar_url: '', type: 'User' } }];
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(issue([])), { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '9999999999' } }));
    await refreshStatuses();
    expect(await db.outbox.get(item?.id as string)).toMatchObject({ status: 'sent', issueNumber: 7 });
    expect((await db.attempts.get(row.id))?.published).toBe(0);

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(issue(['qb:accepted'])), { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '49', 'x-ratelimit-reset': '9999999999' } }));
    await refreshStatuses();
    expect((await db.outbox.get(item?.id as string))?.status).toBe('accepted');
    expect((await db.attempts.get(row.id))?.published).toBe(1);
  });
});

describe('estado de los envíos', () => {
  it('con dos issues del mismo envío, manda el que entró', async () => {
    await db.cSubjects.put(makeSubject());
    const question = makeMcq({ author: null });
    await saveLocalQuestion(question, null);
    const [row] = await publishViaIssue([question.id], 'own');
    await markAwaitingUser(row?.id as string);
    const issue = (number: number, label: string) => ({ number, title: `x · ${row?.nonce}`, state: 'closed', html_url: `u${number}`, created_at: '', labels: [{ name: label }], user: { login: 'a', id: 1, avatar_url: '', type: 'User' } });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([issue(2, 'qb:rejected'), issue(1, 'qb:accepted')]), { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '9999999999' } }));
    await refreshStatuses();
    expect(await db.outbox.get(row?.id as string)).toMatchObject({ status: 'accepted', issueNumber: 1 });
  });

  async function pendingQuestion() {
    await db.cSubjects.put(makeSubject());
    const question = makeMcq({ author: null });
    await saveLocalQuestion(question, null);
    const [row] = await publishViaIssue([question.id], 'own');
    await markAwaitingUser(row?.id as string);
    return { row: row as OutboxRow, question };
  }

  const serve = (issues: unknown, comments: unknown = []) =>
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.includes('/comments') ? comments : issues), { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '9999999999' } }));

  it('un rechazo trae el motivo y devuelve la pregunta a editable', async () => {
    const { row, question } = await pendingQuestion();
    serve(
      [{ number: 8, title: `x · ${row.nonce}`, state: 'closed', html_url: 'u', created_at: '', labels: [{ name: 'qb:rejected' }], user: { login: 'a', id: 1, avatar_url: '', type: 'User' } }],
      [{ body: 'Ya existe en el banco.', user: { login: 'github-actions[bot]', type: 'Bot' } }],
    );
    await refreshStatuses();
    expect(await db.outbox.get(row.id)).toMatchObject({ status: 'rejected', error: 'Ya existe en el banco.' });
    expect((await db.lQuestions.get(question.id))?.local).toMatchObject({ syncState: 'rejected', note: 'Ya existe en el banco.' });
  });

  it('no gasta cuota si no hay nada pendiente', async () => {
    const spy = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', spy);
    await refreshStatuses();
    expect(spy).not.toHaveBeenCalled();
  });

  it('se respeta el límite anónimo', async () => {
    const { row } = await pendingQuestion();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' } }));
    await expect(refreshStatuses()).rejects.toThrow(/limita/);
    // Ya sabe que está agotado: la siguiente vez ni lo intenta.
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(refreshStatuses()).rejects.toThrow(/limita/);
    expect(spy).not.toHaveBeenCalled();
    expect((await db.outbox.get(row.id))?.status).toBe('awaiting-user');
  });

  it('descartar un envío devuelve la pregunta a su estado local', async () => {
    const { row, question } = await pendingQuestion();
    await discardItem(row);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.lQuestions.get(question.id))?.local).toMatchObject({ syncState: 'local', outboxId: null });
  });

  it('clasifica bien los estados abiertos', () => {
    const base = { status: 'queued' } as OutboxRow;
    expect(isOpen(base)).toBe(true);
    expect(isOpen({ ...base, status: 'accepted' })).toBe(false);
    expect(LABEL_TO_STATUS['qb:review']).toBe('review');
  });
});

describe('token', () => {
  const USER = { login: 'Ana', id: 11, avatar_url: 'https://avatars.githubusercontent.com/u/11', name: null };

  const stubUser = (scopes: string, status = 200) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(USER), { status, headers: { 'x-oauth-scopes': scopes } }));

  it('se valida contra GitHub y la identidad sale de allí', async () => {
    stubUser('public_repo');
    const result = await connectWithToken(' ghp_abc ', false);
    expect(result.identity).toMatchObject({ login: 'ana', id: 11, via: 'token' });
    expect(result.excessive).toEqual([]);
    expect(await getToken()).toBe('ghp_abc');
  });

  it('avisa si tiene más permisos de los necesarios', async () => {
    stubUser('public_repo, delete_repo, admin:org');
    expect((await connectWithToken('t', false)).excessive).toEqual(['delete_repo', 'admin:org']);
  });

  it('rechaza un token sin permiso para contribuir, y no lo guarda', async () => {
    stubUser('gist');
    await expect(connectWithToken('t', false)).rejects.toBeInstanceOf(TokenScopeError);
    expect(await getToken()).toBeNull();
    expect(identity.get()).toBeNull();
  });

  it('rechaza un token inválido', async () => {
    stubUser('', 401);
    await expect(connectWithToken('t', false)).rejects.toThrow(/no reconoce/);
  });

  it('el cifrado es de ida y vuelta, y con otra clave no se abre', async () => {
    const key = await generateVaultKey();
    const stored = await encryptToken(key, 'ghp_secreto');
    expect(new TextDecoder().decode(new Uint8Array(stored.ciphertext))).not.toContain('ghp_secreto');
    expect(await decryptToken(key, stored)).toBe('ghp_secreto');
    await expect(decryptToken(await generateVaultKey(), stored)).rejects.toThrow();
  });

  it('la clave no se puede exportar', async () => {
    const key = await generateVaultKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('sin «recordar», no deja rastro en la base de datos', async () => {
    await setToken('ghp_efimero', false);
    expect(await getToken()).toBe('ghp_efimero');
    expect(JSON.stringify(await db.kv.toArray())).not.toContain('ghp_efimero');
    expect(await db.kv.count()).toBe(0);
  });

  it('nunca se guarda en localStorage', async () => {
    await setToken('ghp_secreto', false);
    expect(JSON.stringify({ ...localStorage })).not.toContain('ghp_secreto');
  });

  it('desconectar borra identidad y token', async () => {
    stubUser('public_repo');
    await connectWithToken('t', false);
    await disconnect();
    expect(identity.get()).toBeNull();
    expect(await getToken()).toBeNull();
  });

  it('con token, la cola se envía sola', async () => {
    const question = makeMcq();
    await db.cQuestions.put({ ...question, shardId: 's' });
    await db.attempts.put(attempt(question.id));
    await publishResults();
    await setToken('ghp_x', false);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_x');
      return new Response(JSON.stringify({ number: 9, html_url: 'https://github.com/o/r/issues/9' }), { status: 201 });
    });
    expect(await flushWithToken()).toBe(1);
    expect(calls).toEqual(['POST https://api.github.com/repos/owner/questionbank/issues']);
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: 'sent', issueNumber: 9 });
  });

  it('sin token, la cola espera al usuario', async () => {
    const question = makeMcq();
    await db.cQuestions.put({ ...question, shardId: 's' });
    await db.attempts.put(attempt(question.id));
    await publishResults();
    expect(await flushWithToken()).toBe(0);
    expect((await db.outbox.toArray())[0]?.status).toBe('queued');
  });
});

describe('publicar con token: fork, commit y PR', () => {
  /** Simula la API y registra el orden de las llamadas. */
  function stubGitHub(overrides: Record<string, () => Response> = {}) {
    const calls: { route: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const route = `${init.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`;
      calls.push({ route, body: init.body ? JSON.parse(init.body as string) : undefined });
      for (const [pattern, respond] of Object.entries(overrides)) if (route.includes(pattern)) return respond();
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (route.includes('/forks')) return json({}, 202);
      if (route.includes('/merge-upstream')) return json({});
      if (route.includes('/git/ref/heads/data')) return json({ object: { sha: 'headsha' } });
      if (route.includes('GET') && route.includes('/git/commits/')) return json({ tree: { sha: 'basetree' } });
      if (route.includes('/git/blobs')) return json({ sha: `blob${calls.length}` }, 201);
      if (route.includes('/git/trees')) return json({ sha: 'newtree' }, 201);
      if (route.includes('POST') && route.includes('/git/commits')) return json({ sha: 'newcommit' }, 201);
      if (route.includes('/git/refs')) return json({}, 201);
      if (route.includes('/pulls')) return json({ number: 77, html_url: 'https://github.com/owner/questionbank/pull/77' }, 201);
      throw new Error(`Ruta inesperada: ${route}`);
    });
    return calls;
  }

  async function setUp() {
    identity.set({ login: 'ana', id: 11, avatarUrl: 'https://avatars.githubusercontent.com/u/11', verifiedAt: 1, via: 'token' });
    await setToken('ghp_prueba', false);
    await db.lSubjects.put({ ...makeSubject({ createdBy: null }), local: { baseRev: null } });
    const question = makeMcq({ author: null });
    await saveLocalQuestion(question, null);
    return question;
  }

  it('hace las llamadas en orden y deja un commit atómico contra data', async () => {
    const question = await setUp();
    const calls = stubGitHub();
    const row = await publishViaPull([question.id], 'own');

    const routes = calls.map((c) => c.route);
    expect(routes[0]).toBe('POST /repos/owner/questionbank/forks');
    expect(routes[1]).toBe('POST /repos/ana/questionbank/merge-upstream');
    expect(routes[2]).toBe('GET /repos/ana/questionbank/git/ref/heads/data');
    const pull = calls.at(-1);
    expect(pull?.route).toBe('POST /repos/owner/questionbank/pulls');
    expect(pull?.body).toMatchObject({ base: 'data', maintainer_can_modify: false });
    expect((pull?.body as { head: string }).head).toMatch(/^ana:qb\//);
    expect((pull?.body as { body: string }).body).toContain('<!-- qb:license-accepted -->');

    const commit = calls.find((c) => c.route === 'POST /repos/ana/questionbank/git/commits');
    expect(commit?.body).toMatchObject({ parents: ['headsha'], tree: 'newtree' });
    const tree = calls.find((c) => c.route.includes('/git/trees'))?.body as { base_tree: string; tree: { path: string }[] };
    expect(tree.base_tree).toBe('basetree');
    expect(tree.tree.map((f) => f.path).sort()).toEqual([`questions/${SUBJECT_ID}/${question.id}.json`, `taxonomy/${SUBJECT_ID}.json`]);

    expect(row.channel).toBe('pull');
    const stored = await db.outbox.get(row.id);
    expect(stored).toMatchObject({ status: 'sent', issueNumber: 77, url: 'https://github.com/owner/questionbank/pull/77' });
    expect((await db.lQuestions.get(question.id))?.local.syncState).toBe('submitted');
  });

  it('los ficheros cumplen lo que exige la revisión: autor y creador son quien publica', async () => {
    const question = await setUp();
    const calls = stubGitHub();
    await publishViaPull([question.id], 'own');
    const blobs = calls.filter((c) => c.route.includes('/git/blobs')).map((c) => JSON.parse((c.body as { content: string }).content));
    const questionDoc = blobs.find((b) => b.statement);
    const subjectDoc = blobs.find((b) => b.units);
    expect(questionDoc.author).toEqual({ login: 'ana', id: 11 });
    expect(subjectDoc.createdBy).toEqual({ login: 'ana', id: 11 });
    expect(Question.safeParse(questionDoc).success).toBe(true);
    expect(SubjectDoc.safeParse(subjectDoc).success).toBe(true);
  });

  it('incluye las imágenes nuevas, en base64, y no las que ya están publicadas', async () => {
    identity.set({ login: 'ana', id: 11, avatarUrl: 'x', verifiedAt: 1, via: 'token' });
    await setToken('ghp_prueba', false);
    await db.cSubjects.put(makeSubject());
    const newHash = 'a'.repeat(64);
    const oldHash = 'b'.repeat(64);
    const image = (hash: string) => ({ hash, ext: 'webp' as const, width: 1, height: 1, bytes: 3, alt: '' });
    // El Blob de jsdom no tiene arrayBuffer(): el de Node sí, y es el que tienen los navegadores.
    await db.localImages.put({ ...image(newHash), blob: new NodeBlob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }) as unknown as Blob, createdAt: 1 });
    await db.cQuestions.put({ ...makeMcq({ statement: 'Otra pregunta con imagen', images: [image(oldHash)] }), shardId: 's' });
    const question = makeMcq({ author: null, images: [image(newHash), image(oldHash)] });
    await saveLocalQuestion(question, null);

    const calls = stubGitHub();
    await publishViaPull([question.id], 'own');
    const tree = calls.find((c) => c.route.includes('/git/trees'))?.body as { tree: { path: string }[] };
    expect(tree.tree.map((f) => f.path)).toContain(`images/${newHash}.webp`);
    expect(tree.tree.map((f) => f.path)).not.toContain(`images/${oldHash}.webp`);
    const blob = calls.find((c) => (c.body as { encoding?: string } | undefined)?.encoding === 'base64')?.body as { content: string };
    expect(blob.content).toBe('AQID');
  });

  it('si GitHub lo rechaza, no queda nada a medias y se puede reintentar', async () => {
    const question = await setUp();
    stubGitHub({ '/pulls': () => new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 }) });
    await expect(publishViaPull([question.id], 'own')).rejects.toThrow(/Validation Failed/);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.lQuestions.get(question.id))?.local.syncState).toBe('local');
  });

  it('el dueño del repositorio no hace fork: su rama va en el mismo repo', async () => {
    const question = await setUp();
    identity.set({ login: 'Owner', id: 11, avatarUrl: 'x', verifiedAt: 1, via: 'token' });
    const calls = stubGitHub();
    await publishViaPull([question.id], 'own');
    const routes = calls.map((c) => c.route);
    expect(routes.some((r) => r.includes('/forks'))).toBe(false);
    expect(routes.some((r) => r.includes('/merge-upstream'))).toBe(false);
    expect(routes[0]).toBe('GET /repos/owner/questionbank/git/ref/heads/data');
    expect((calls.at(-1)?.body as { head: string }).head).toMatch(/^qb\//);
  });

  it('aguanta un 5xx de GitHub a mitad del flujo', async () => {
    const question = await setUp();
    let failed = false;
    const calls = stubGitHub({
      '/git/trees': () => {
        if (!failed) {
          failed = true;
          return new Response('', { status: 502 });
        }
        return new Response(JSON.stringify({ sha: 'newtree' }), { status: 201 });
      },
    });
    await publishViaPull([question.id], 'own');
    expect(calls.filter((c) => c.route.includes('/git/trees'))).toHaveLength(2);
    expect(calls.at(-1)?.route).toContain('/pulls');
  }, 20000);

  it('si el PR ya existe tras un 5xx, lo reutiliza', async () => {
    const question = await setUp();
    stubGitHub({
      'POST /repos/owner/questionbank/pulls': () => new Response(JSON.stringify({ message: 'A pull request already exists' }), { status: 422 }),
      'GET /repos/owner/questionbank/pulls': () => new Response(JSON.stringify([{ number: 88, html_url: 'existente' }]), { status: 200 }),
    });
    const row = await publishViaPull([question.id], 'own');
    expect(await db.outbox.get(row.id)).toMatchObject({ status: 'sent', issueNumber: 88 });
  });

  it('sin token no se puede publicar por esta vía', async () => {
    const question = makeMcq({ author: null });
    await saveLocalQuestion(question, null);
    await expect(publishViaPull([question.id], 'own')).rejects.toThrow(/token/);
  });
});
