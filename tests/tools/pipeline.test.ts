// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Manifest } from '@core/schema/derived';
import type { Submission } from '@core/schema/submission';
import { sha256Hex } from '@core/util/encoding';
import { runIntake } from '../../tools/actions/intake';
import { LICENSE_MARKER, pullClosed, reviewPull } from '../../tools/actions/review-pr';
import { runScheduler } from '../../tools/actions/scheduler';
import { buildCommunity } from '../../tools/build-community';
import { DataStore } from '../../tools/lib/data-store';
import type { PullData, PullFile } from '../../tools/lib/github';
import { makeMcq, makeSubject, SUBJECT_ID, uuid } from '../fixtures';
import { createRepo, FakeGitHub, issueFor, user } from './harness';

const NOW = Date.UTC(2026, 10, 5, 12);
const HOUR = 3_600_000;
const encoder = new TextEncoder();

let repo: ReturnType<typeof createRepo>;
let api: FakeGitHub;
let counter = 0;
const nonce = () => `pipeline${String(++counter).padStart(6, '0')}`;

const deps = (now = NOW) => ({ api, store: new DataStore(repo.work), git: repo.git, now: () => now, autoMerge: true, log: () => undefined, defaultBranch: 'main', repo: 'o/r' });

function applySquash(head: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo.work, stdio: 'ignore' });
  git('fetch', 'origin');
  git('checkout', '-B', 'merge-tmp', 'origin/data');
  git('merge', '--squash', `origin/${head}`);
  git('commit', '-m', 'squash');
  git('push', 'origin', 'HEAD:refs/heads/data');
}

beforeEach(() => {
  repo = createRepo();
  api = new FakeGitHub();
  api.onMerge = (_n, head) => applySquash(head);
});

afterEach(() => repo.cleanup());

function forkPull(number: number, login: string, files: Record<string, Uint8Array | string>, overrides: Partial<PullData> = {}): PullData {
  const list: PullFile[] = [];
  for (const [filename, content] of Object.entries(files)) {
    const sha = `sha-${filename}`;
    api.blobs.set(sha, typeof content === 'string' ? encoder.encode(content) : content);
    list.push({ filename, status: 'added', sha });
  }
  api.pullFiles.set(number, list);
  const pull: PullData = {
    number,
    title: 'Aportación',
    body: `Propuesta ${LICENSE_MARKER}`,
    state: 'open',
    merged: false,
    user: user(login, 500),
    html_url: `https://github.com/o/r/pull/${number}`,
    head: { sha: `head-${number}`, ref: 'qb/aportacion', repo: `${login}/questionbank` },
    base: { ref: 'data' },
    ...overrides,
  };
  api.pullData.set(number, pull);
  return pull;
}

const json = (value: unknown) => JSON.stringify(value);

describe('revisión de PR de un fork', () => {
  beforeEach(() => {
    // Un PR de fork de verdad se fusionaría en GitHub: aquí se aplican los ficheros al remoto.
    api.mergePull = async (number: number) => {
      api.merged.push(number);
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo.work, stdio: 'ignore' });
      git('fetch', 'origin');
      git('checkout', '-B', 'data', 'origin/data');
      for (const file of api.pullFiles.get(number) ?? []) {
        const path = join(repo.work, file.filename);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, api.blobs.get(file.sha) as Uint8Array);
      }
      git('add', '-A');
      git('commit', '-m', `squash ${number}`);
      git('push', 'origin', 'HEAD:refs/heads/data');
      return true;
    };
  });

  function contribution(login = 'marta') {
    const subject = makeSubject({ createdBy: { login, id: 500 } });
    const question = makeMcq({ author: { login, id: 500 } });
    return {
      subject,
      question,
      files: {
        [`taxonomy/${subject.id}.json`]: json(subject),
        [`questions/${subject.id}/${question.id}.json`]: json(question),
      },
    };
  }

  it('valida los ficheros como datos, fusiona y registra la aprobación', async () => {
    const { files, question } = contribution();
    forkPull(1, 'Marta', files);
    expect(await reviewPull(deps(), 1)).toBe('merged');
    expect(api.merged).toEqual([1]);
    expect(api.dispatched).toEqual(['deploy.yml']);
    await repo.git.syncData();
    const store = await new DataStore(repo.work).load();
    expect(store.question(question.id)?.author?.login).toBe('marta');
    expect((await store.allSystemEvents()).map((e) => e.by)).toEqual(['marta']);
  });

  it('rechaza tocar rutas reservadas: eventos, usuarios, moderación, workflows', async () => {
    for (const [i, path] of ['events/2026/11/marta.jsonl', 'users/marta.json', 'moderation/trusted.json', '.github/workflows/deploy.yml', 'competitions/x/competition.json', '../fuera.json'].entries()) {
      forkPull(10 + i, 'marta', { [path]: '{}' });
      expect(await reviewPull(deps(), 10 + i)).toBe('rejected');
    }
    expect(api.merged).toEqual([]);
  });

  it('rechaza borrar o mover ficheros', async () => {
    const { files } = contribution();
    forkPull(2, 'marta', files);
    const list = api.pullFiles.get(2) as PullFile[];
    (list[0] as PullFile).status = 'removed';
    expect(await reviewPull(deps(), 2)).toBe('rejected');
  });

  it('rechaza si la ruta no coincide con el contenido', async () => {
    const question = makeMcq({ author: { login: 'marta', id: 500 } });
    forkPull(3, 'marta', { [`taxonomy/${SUBJECT_ID}.json`]: json(makeSubject({ createdBy: { login: 'marta', id: 500 } })), [`questions/${SUBJECT_ID}/${uuid(77777)}.json`]: json(question) });
    expect(await reviewPull(deps(), 3)).toBe('rejected');
  });

  it('rechaza atribuirse a otra persona: el autor del PR lo certifica GitHub', async () => {
    const { files } = contribution('victima');
    forkPull(4, 'marta', files);
    expect(await reviewPull(deps(), 4)).toBe('rejected');
    expect(api.comments.get(4)?.at(-1)).toContain('autor');
  });

  it('una imagen disfrazada no pasa', async () => {
    const { subject } = contribution();
    const svg = encoder.encode('<svg onload="alert(1)"/>');
    const hash = await sha256Hex(svg);
    const question = makeMcq({ author: { login: 'marta', id: 500 }, images: [{ hash, ext: 'png', width: 1, height: 1, bytes: svg.length, alt: '' }] });
    forkPull(5, 'marta', { [`taxonomy/${subject.id}.json`]: json(subject), [`questions/${subject.id}/${question.id}.json`]: json(question), [`images/${hash}.png`]: svg });
    expect(await reviewPull(deps(), 5)).toBe('rejected');
  });

  it('sin aceptación de licencia queda para revisión humana', async () => {
    const { files } = contribution();
    forkPull(6, 'marta', files, { body: 'Hola' });
    expect(await reviewPull(deps(), 6)).toBe('review');
    expect(api.merged).toEqual([]);
  });

  it('fusiona sólo el commit validado', async () => {
    const { files } = contribution();
    forkPull(7, 'marta', files);
    let mergedSha = '';
    const merge = api.mergePull.bind(api);
    api.mergePull = async (number: number, sha: string, title: string) => {
      mergedSha = sha;
      return merge(number, sha, title);
    };
    await reviewPull(deps(), 7);
    expect(mergedSha).toBe('head-7');
  });

  it('si la fusión falla no se da por publicada', async () => {
    const { files } = contribution();
    forkPull(8, 'marta', files);
    api.mergePull = async () => false;
    expect(await reviewPull(deps(), 8)).toBe('review');
    expect(api.dispatched).toEqual([]);
  });

  it('una cuenta vetada no publica', async () => {
    await repo.git.syncData();
    mkdirSync(join(repo.work, 'moderation'), { recursive: true });
    writeFileSync(join(repo.work, 'moderation/banned.json'), json({ logins: ['marta'] }));
    await repo.git.commitAll('Veto');
    await repo.git.pushData();
    forkPull(9, 'marta', contribution().files);
    expect(await reviewPull(deps(), 9)).toBe('rejected');
  });

  it('una rama contrib/ de un fork no se salta la validación', async () => {
    forkPull(21, 'marta', { 'events/2026/11/marta.jsonl': '{}' }, { head: { sha: 'x', ref: 'contrib/issue-1', repo: 'marta/questionbank' } });
    expect(await reviewPull(deps(), 21)).toBe('rejected');
  });

  it('una rama contrib/ del propio repositorio ya viene validada por el intake', async () => {
    forkPull(22, 'github-actions[bot]', {}, { head: { sha: 'x', ref: 'contrib/issue-1', repo: 'o/r' } });
    expect(await reviewPull(deps(), 22)).toBe('skipped');
  });

  it('un PR que no va contra data se ignora', async () => {
    forkPull(20, 'marta', {}, { base: { ref: 'main' } });
    expect(await reviewPull(deps(), 20)).toBe('skipped');
  });
});

describe('PR cerrados por una persona', () => {
  it('al fusionarlo un mantenedor se registra la aprobación y se avisa al envío', async () => {
    // Primero, un envío que queda en revisión.
    const statement = 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole';
    const base: Submission = { v: 1, kind: 'questions', nonce: nonce(), questions: [makeMcq({ author: null, statement })], subjects: [makeSubject({ createdBy: null })], images: [], licenseAccepted: true, origin: 'own' };
    api.issues.push(await issueFor(base, user('ana', 11), NOW));
    await runIntake(deps());
    const near = makeMcq({ author: null, statement: `${statement} ventricular` });
    const issue = await issueFor({ v: 1, kind: 'questions', nonce: nonce(), questions: [near], subjects: [], images: [], licenseAccepted: true, origin: 'own' }, user('luis', 12), NOW);
    api.issues.push(issue);
    await runIntake(deps());
    const pull = api.pulls.at(-1);
    expect(api.labels.get(issue.number)).toContain('qb:review');

    // Una persona lo fusiona.
    applySquash(pull?.head as string);
    api.pullData.set(pull?.number as number, { number: pull?.number as number, title: pull?.title as string, body: pull?.body as string, state: 'closed', merged: true, user: user('github-actions[bot]', 1), html_url: pull?.html_url as string, head: { sha: 'x', ref: pull?.head as string, repo: 'o/r' }, base: { ref: 'data' } });
    api.pullFiles.set(pull?.number as number, [{ filename: `questions/${near.subjectId}/${near.id}.json`, status: 'added', sha: 'x' }]);
    api.dispatched = [];
    await pullClosed(deps(), pull?.number as number);

    await repo.git.syncData();
    const store = await new DataStore(repo.work).load();
    // La aprobación es de quien la escribió, no del bot que abrió el PR.
    expect((await store.allSystemEvents()).find((e) => e.q === near.id)?.by).toBe('luis');
    expect(api.labels.get(issue.number)).toContain('qb:accepted');
    expect(api.dispatched).toEqual(['deploy.yml']);
  });

  it('al cerrarlo sin fusionar, el envío queda rechazado', async () => {
    const issue = await issueFor({ v: 1, kind: 'connect', nonce: nonce() }, user('ana', 11), NOW);
    api.issues.push(issue);
    forkPull(30, 'github-actions[bot]', {}, { state: 'closed', merged: false, body: `x <!-- qb:issue=${issue.number} -->` });
    await pullClosed(deps(), 30);
    expect(api.labels.get(issue.number)).toContain('qb:rejected');
  });
});

describe('compilación de datos', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'qb-out-'));
  });

  afterEach(() => rmSync(out, { recursive: true, force: true }));

  const write = (path: string, content: string) => {
    const file = join(repo.work, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };

  async function seed() {
    const subject = makeSubject();
    const question = makeMcq();
    write(`taxonomy/${subject.id}.json`, json(subject));
    write(`questions/${subject.id}/${question.id}.json`, json(question));
    return { subject, question };
  }

  const build = () => buildCommunity({ dataDir: repo.work, outDir: out, now: NOW, commit: 'abc123' });
  const readJson = (path: string) => JSON.parse(readFileSync(join(out, path), 'utf8'));

  it('genera un manifiesto válido con fragmentos verificables', async () => {
    const { question } = await seed();
    const manifest = await build();
    expect(Manifest.safeParse(manifest).success).toBe(true);
    expect(manifest.dataCommit).toBe('abc123');
    expect(manifest.counts).toMatchObject({ questions: 1, subjects: 1 });
    expect(manifest.quarantined).toBe(0);
    const shard = manifest.shards.find((s) => s.kind === 'questions');
    expect(shard?.path).toContain(shard?.hash.slice(0, 12));
    const text = readFileSync(join(out, shard?.path as string), 'utf8');
    expect(await sha256Hex(text)).toBe(shard?.hash);
    expect(JSON.parse(text)[0].id).toBe(question.id);
    expect(readJson('manifest.json')).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  it('funciona sin datos: un repositorio recién creado', async () => {
    const manifest = await build();
    expect(manifest.counts.questions).toBe(0);
    expect(manifest.shards.map((s) => s.kind)).toEqual(expect.arrayContaining(['taxonomy', 'profiles', 'leaderboards', 'competitions']));
  });

  it('un documento roto se aparta sin tumbar el resto, y se cuenta', async () => {
    const { subject } = await seed();
    const other = makeMcq({ id: uuid() });
    write(`questions/${subject.id}/${uuid()}.json`, '{ esto no es json');
    write(`questions/${subject.id}/${other.id}.json`, json({ ...other, statement: '' }));
    write(`questions/${subject.id}/${uuid()}.json`, json(makeMcq({ id: uuid(), statement: 'Mal ubicada' })));
    write('users/intruso.json', json({ login: 'otro' }));
    const manifest = await build();
    expect(manifest.counts.questions).toBe(1);
    expect(manifest.quarantined).toBe(4);
    expect(readJson('integrity.json').quarantined).toHaveLength(4);
  });

  it('no publica preguntas ocultas ni retiradas, ni sus imágenes', async () => {
    const { subject } = await seed();
    const hidden = makeMcq({ id: uuid(), statement: 'Pregunta oculta por moderación' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const hash = await sha256Hex(png);
    const retired = makeMcq({ id: uuid(), statement: 'Pregunta retirada', images: [{ hash, ext: 'png', width: 1, height: 1, bytes: 8, alt: '' }] });
    write(`questions/${subject.id}/${hidden.id}.json`, json(hidden));
    write(`questions/${subject.id}/${retired.id}.json`, json(retired));
    mkdirSync(join(repo.work, 'images'), { recursive: true });
    writeFileSync(join(repo.work, `images/${hash}.png`), png);
    write('moderation/hidden.json', json({ questions: [hidden.id] }));
    write('moderation/retired.json', json({ questions: [retired.id] }));
    const manifest = await build();
    expect(manifest.counts.questions).toBe(1);
    expect(existsSync(join(out, `images/${hash}.png`))).toBe(false);
  });

  it('un cambio en una pregunta sólo cambia un fragmento', async () => {
    const { subject } = await seed();
    const another = makeMcq({ id: '10000000-0000-4000-8000-000000000001', statement: 'Otra pregunta en otro cubo distinto' });
    write(`questions/${subject.id}/${another.id}.json`, json(another));
    const before = await build();
    write(`questions/${subject.id}/${another.id}.json`, json({ ...another, statement: 'Enunciado cambiado de la otra pregunta' }));
    const after = await build();
    const changed = after.shards.filter((s) => s.hash !== before.shards.find((b) => b.id === s.id)?.hash).map((s) => s.id);
    expect(changed).toEqual([`q/${subject.id}/1`]);
  });

  it('dos compilaciones iguales producen lo mismo', async () => {
    await seed();
    expect((await build()).shards).toEqual((await build()).shards);
  });

  it('volver a compilar más tarde sin cambios no obliga a descargar nada de nuevo', async () => {
    await seed();
    const first = await buildCommunity({ dataDir: repo.work, outDir: out, now: NOW, commit: 'a' });
    const later = await buildCommunity({ dataDir: repo.work, outDir: out, now: NOW + HOUR, commit: 'a' });
    expect(later.shards.map((s) => s.hash)).toEqual(first.shards.map((s) => s.hash));
  });

  it('de los eventos salen los rankings: el ciclo completo', async () => {
    const { question } = await seed();
    write('users/luis.json', json({ schemaVersion: 1, login: 'luis', githubId: 2, avatarUrl: 'https://avatars.githubusercontent.com/u/2', registeredAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
    const event = { id: 'attempt0001', q: question.id, sel: ['a'], ms: 5000, at: Math.floor((NOW - HOUR) / 1000), m: 'practice', rcv: Math.floor((NOW - HOUR) / 1000) + 60, src: 1 };
    write('events/2026/11/luis.jsonl', `${json(event)}\n{línea corrupta\n${json({ ...event, id: 'attempt0002', sel: ['b'] })}\n`);
    const manifest = await build();
    expect(manifest.counts.answers).toBe(2);
    const shard = (kind: string) => readJson(manifest.shards.find((s) => s.kind === kind)?.path as string);
    const global = shard('leaderboards').find((b: { id: string }) => b.id === 'global');
    expect(global.entries[0]).toMatchObject({ login: 'luis', rank: 1, value: 3 });
    const profile = shard('profiles').find((p: { login: string }) => p.login === 'luis');
    expect(profile.stats).toMatchObject({ points: 3, answers: 2, mcqCorrect: 1, accuracy: 0.5 });
    expect(readJson('u/luis.json').activity[0]).toMatchObject({ kind: 'study', answers: 2 });
    expect(shard('question-stats')[0]).toMatchObject({ questionId: question.id, answers: 2, uniqueUsers: 1, correctRate: 0.5 });
  });
});

describe('competiciones de punta a punta', () => {
  async function seedBank(count = 12) {
    const subject = makeSubject();
    const questions = Array.from({ length: count }, (_, i) => makeMcq({ id: uuid(9100 + i), author: null, statement: `Pregunta número ${i} del banco de competición` }));
    api.issues.push(await issueFor({ v: 1, kind: 'questions', nonce: nonce(), questions: questions.slice(0, 12), subjects: [subject], images: [], licenseAccepted: true, origin: 'own' }, user('ana', 11), NOW));
    await runIntake(deps());
    return questions;
  }

  it('crear, invitar, entregar y clasificar', async () => {
    await seedBank();
    const create = await issueFor({ v: 1, kind: 'competition-create', nonce: nonce(), type: 'group', title: 'Liga de prueba', filters: {}, questionCount: 5, durationSec: 300, windowHours: 24, invited: ['bea'], maxParticipants: null }, user('ana', 11), NOW);
    api.issues.push(create);
    await runIntake(deps());
    expect(api.lastComment(create)).toMatch(/QB-[A-Z0-9]{6}/);
    expect(api.lastComment(create)).toContain('@bea');

    await repo.git.syncData();
    const store = await new DataStore(repo.work).load();
    const [competition] = await store.allCompetitions();
    expect(competition?.questionIds).toHaveLength(5);
    expect(competition?.createdBy?.login).toBe('ana');

    const answers = (competition?.questionIds ?? []).map((q) => ({ q, sel: ['a'], ms: 3000 }));
    const entry = await issueFor({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: competition?.id as string, durationMs: 60_000, answers }, user('Bea', 13), NOW + HOUR);
    api.issues.push(entry);
    await runIntake(deps(NOW + HOUR));
    expect(api.labels.get(entry.number)).toContain('qb:accepted');

    // Segunda entrega: sólo cuenta la primera.
    const again = await issueFor({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: competition?.id as string, durationMs: 1000, answers }, user('bea', 13), NOW + 2 * HOUR);
    api.issues.push(again);
    await runIntake(deps(NOW + 2 * HOUR));
    expect(api.labels.get(again.number)).toContain('qb:rejected');

    // Fuera de plazo, según la hora de GitHub.
    const late = await issueFor({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: competition?.id as string, durationMs: 1000, answers }, user('carlos', 14), NOW + 30 * HOUR);
    api.issues.push(late);
    await runIntake(deps(NOW + 30 * HOUR));
    expect(api.lastComment(late)).toContain('terminó');

    const out = mkdtempSync(join(tmpdir(), 'qb-out-'));
    try {
      await repo.git.syncData();
      const manifest = await buildCommunity({ dataDir: repo.work, outDir: out, now: NOW + 30 * HOUR, commit: 'x' });
      const shard = manifest.shards.find((s) => s.kind === 'competitions');
      const [derived] = JSON.parse(readFileSync(join(out, shard?.path as string), 'utf8'));
      expect(derived.participants).toEqual(['bea']);
      expect(derived.standings[0]).toMatchObject({ login: 'bea', correct: 5, total: 5, rank: 1 });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rechaza una competición si faltan preguntas', async () => {
    const create = await issueFor({ v: 1, kind: 'competition-create', nonce: nonce(), type: 'duel', title: 'Duelo', filters: {}, questionCount: 5, durationSec: 300, windowHours: 24, invited: [], maxParticipants: null }, user('ana', 11), NOW);
    api.issues.push(create);
    await runIntake(deps());
    expect(api.labels.get(create.number)).toContain('qb:rejected');
    expect(api.lastComment(create)).toContain('al menos 3');
  });

  it('torneo: inscripción, rondas y cierre de inscripción', async () => {
    await seedBank();
    const create = await issueFor({ v: 1, kind: 'competition-create', nonce: nonce(), type: 'tournament', title: 'Copa', filters: {}, questionCount: 3, durationSec: 300, windowHours: 24, invited: [], maxParticipants: 4, registrationHours: 24, roundHours: 24 }, user('ana', 11), NOW);
    api.issues.push(create);
    await runIntake(deps());
    await repo.git.syncData();
    const [competition] = await (await new DataStore(repo.work).load()).allCompetitions();
    const id = competition?.id as string;

    for (const [login, githubId] of [['ana', 11], ['bea', 13]] as const) api.issues.push(await issueFor({ v: 1, kind: 'competition-join', nonce: nonce(), competitionId: id }, user(login, githubId), NOW + HOUR));
    await runIntake(deps(NOW + HOUR));

    const tooLate = await issueFor({ v: 1, kind: 'competition-join', nonce: nonce(), competitionId: id }, user('carlos', 14), NOW + 25 * HOUR);
    api.issues.push(tooLate);
    await runIntake(deps(NOW + 25 * HOUR));
    expect(api.lastComment(tooLate)).toContain('inscripción');

    const answers = (competition?.rounds?.[0]?.questionIds ?? []).map((q) => ({ q, sel: ['a'], ms: 1000 }));
    const outsider = await issueFor({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: id, round: 0, durationMs: 1000, answers }, user('carlos', 14), NOW + 26 * HOUR);
    api.issues.push(outsider);
    await runIntake(deps(NOW + 26 * HOUR));
    expect(api.lastComment(outsider)).toContain('inscrito');

    const entry = await issueFor({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: id, round: 0, durationMs: 1000, answers }, user('ana', 11), NOW + 26 * HOUR);
    api.issues.push(entry);
    await runIntake(deps(NOW + 26 * HOUR));
    expect(api.labels.get(entry.number)).toContain('qb:accepted');
  });
});

describe('retos programados', () => {
  it('crea el reto del día y de la semana, una sola vez', async () => {
    const subject = makeSubject();
    const questions = Array.from({ length: 12 }, (_, i) => makeMcq({ id: uuid(9300 + i), author: null, statement: `Pregunta ${i} para los retos programados` }));
    api.issues.push(await issueFor({ v: 1, kind: 'questions', nonce: nonce(), questions, subjects: [subject], images: [], licenseAccepted: true, origin: 'own' }, user('ana', 11), NOW));
    await runIntake(deps());
    api.dispatched = [];

    expect(await runScheduler(deps())).toEqual(['daily-2026-11-05', 'weekly-2026-w45']);
    expect(api.dispatched).toEqual(['deploy.yml']);
    api.dispatched = [];
    expect(await runScheduler(deps(NOW + HOUR))).toEqual([]);
    expect(api.dispatched).toEqual([]);

    await repo.git.syncData();
    const all = await (await new DataStore(repo.work).load()).allCompetitions();
    expect(all.map((c) => c.type).sort()).toEqual(['daily', 'weekly']);
    expect(all.every((c) => c.createdBy === null)).toBe(true);
  });

  it('sin preguntas no crea nada ni falla', async () => {
    expect(await runScheduler(deps())).toEqual([]);
  });
});
