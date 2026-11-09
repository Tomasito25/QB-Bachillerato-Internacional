// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnswerEvent } from '@core/schema/events';
import { LIMITS } from '@core/schema/question';
import type { Submission } from '@core/schema/submission';
import { partNonce } from '@core/submissions/envelope';
import { validateContribution } from '@core/validation/contribution';
import { POLICY } from '@core/validation/policy';
import { sha256Hex, bytesToBase64, bytesToBase64Url, gzip } from '@core/util/encoding';
import { LABELS, runIntake } from '../../tools/actions/intake';
import { DataStore } from '../../tools/lib/data-store';
import { GitHubHttpError } from '../../tools/lib/github';
import { makeMcq, makeSubject, SUBJECT_ID, uuid } from '../fixtures';
import { createRepo, FakeGitHub, issueFor, user } from './harness';

const NOW = Date.UTC(2026, 10, 5, 12);
const ANA = user('Ana', 11);
const LUIS = user('luis', 12);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Repo = ReturnType<typeof createRepo>;
let repo: Repo;
let api: FakeGitHub;
let nonceCounter = 0;
const nonce = () => `nonce${String(++nonceCounter).padStart(6, '0')}`;

function run(autoMerge = true) {
  return runIntake({ api, store: new DataStore(repo.work), git: repo.git, now: () => NOW, autoMerge, log: () => undefined, defaultBranch: 'main' });
}

function questionsSubmission(overrides: Partial<Extract<Submission, { kind: 'questions' }>> = {}): Extract<Submission, { kind: 'questions' }> {
  return { v: 1, kind: 'questions', nonce: nonce(), questions: [makeMcq({ author: null })], subjects: [makeSubject({ createdBy: null })], images: [], licenseAccepted: true, origin: 'own', ...overrides };
}

async function send(submission: Submission, author = ANA, at = NOW - 60_000) {
  const issue = await issueFor(submission, author, at);
  api.issues.push(issue);
  return issue;
}

async function loadRemote(): Promise<DataStore> {
  await repo.git.syncData();
  return new DataStore(repo.work).load();
}

beforeEach(() => {
  repo = createRepo();
  api = new FakeGitHub();
  // Simula el «squash merge» de GitHub, sobre el remoto de verdad.
  api.onMerge = (_number, head) => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo.work, stdio: 'ignore' });
    git('fetch', 'origin');
    git('checkout', '-B', 'merge-tmp', 'origin/data');
    git('merge', '--squash', `origin/${head}`);
    git('commit', '-m', 'squash');
    git('push', 'origin', 'HEAD:refs/heads/data');
  };
});

afterEach(() => repo.cleanup());

describe('intake: publicar preguntas', () => {
  it('no hay tope de preguntas al día', async () => {
    const lote = (n: number) => questionsSubmission({ questions: Array.from({ length: n }, (_, i) => makeMcq({ author: null, id: uuid(), statement: `Pregunta ${n}-${i} para comprobar que entran todas las que se envíen` })) });
    const primero = await send(lote(40));
    const segundo = await send(lote(41));
    await run();
    for (const issue of [primero, segundo]) expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
    expect((await loadRemote()).questions.size).toBe(81);
  });

  it('crea el PR, lo fusiona, publica y avisa', async () => {
    const issue = await send(questionsSubmission());
    const result = await run();
    expect(result).toEqual({ processed: 1, published: true });
    expect(api.pulls).toHaveLength(1);
    expect(api.pulls[0]?.base).toBe('data');
    expect(api.pulls[0]?.head).toBe(`contrib/issue-${issue.number}`);
    expect(api.merged).toEqual([api.pulls[0]?.number]);
    expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
    expect(api.closed.get(issue.number)).toBe('completed');
    expect(api.dispatched).toEqual(['deploy.yml']);
    expect(api.deletedBranches).toEqual([`contrib/issue-${issue.number}`]);

    const store = await loadRemote();
    expect(store.questions.size).toBe(1);
    const [question] = store.questions.values();
    // El autor sale del issue, en minúsculas; el cliente lo enviaba vacío.
    expect(question?.author).toEqual({ login: 'ana', id: 11 });
    expect(store.subjects()[0]?.createdBy).toEqual({ login: 'ana', id: 11 });
    expect(store.users.get('ana')).toMatchObject({ githubId: 11 });
    const events = await store.allSystemEvents();
    expect(events).toEqual([expect.objectContaining({ t: 'question-approved', by: 'ana', q: question?.id })]);
  });

  it('un envío inválido se rechaza y no toca los datos', async () => {
    const issue = await send(questionsSubmission({ questions: [{ basura: true }] }));
    await run();
    expect(api.pulls).toEqual([]);
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect(api.closed.get(issue.number)).toBe('not_planned');
    expect(api.lastComment(issue)).toContain('no es válido');
    expect(api.dispatched).toEqual([]);
    expect((await loadRemote()).questions.size).toBe(0);
  });

  it('un error en una pregunta rechaza todo el envío: o entra entero o no entra', async () => {
    const issue = await send(questionsSubmission({ questions: [makeMcq({ author: null }), { basura: true }] }));
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect((await loadRemote()).questions.size).toBe(0);
  });

  it('una pregunta dudosa queda abierta para revisión humana', async () => {
    const statement = 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole';
    await send(questionsSubmission({ questions: [makeMcq({ author: null, statement })] }));
    await run();
    api.dispatched = [];
    const near = await send(questionsSubmission({ subjects: [], questions: [makeMcq({ author: null, statement: `${statement} ventricular` })] }), LUIS);
    await run();
    expect(api.labels.get(near.number)).toContain(LABELS.review);
    expect(api.merged).toHaveLength(1);
    expect(api.pulls).toHaveLength(2);
    expect(api.lastComment(near)).toContain('revisión');
    expect((await loadRemote()).questions.size).toBe(1);
  });

  it('con la fusión automática desactivada, todo pasa por revisión', async () => {
    const issue = await send(questionsSubmission());
    await run(false);
    expect(api.merged).toEqual([]);
    expect(api.labels.get(issue.number)).toContain(LABELS.review);
    expect((await loadRemote()).questions.size).toBe(0);
  });

  it('escribe las imágenes con su hash y rechaza las disfrazadas', async () => {
    const hash = await sha256Hex(PNG);
    const question = makeMcq({ author: null, statement: `Mira ![x](qbimg:${hash})`, images: [{ hash, ext: 'png', width: 1, height: 1, bytes: PNG.length, alt: '' }] });
    await send(questionsSubmission({ questions: [question], images: [{ hash, ext: 'png', base64: bytesToBase64(PNG) }] }));
    await run();
    const store = await loadRemote();
    expect(store.imageExists(hash, 'png')).toBe(true);
    expect(new Uint8Array(readFileSync(store.path('images', `${hash}.png`)))).toEqual(PNG);

    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
    const evilHash = await sha256Hex(svg);
    const evil = makeMcq({ id: uuid(), author: null, statement: `Otra ![x](qbimg:${evilHash})`, images: [{ hash: evilHash, ext: 'png', width: 1, height: 1, bytes: svg.length, alt: '' }] });
    const issue = await send(questionsSubmission({ subjects: [], questions: [evil], images: [{ hash: evilHash, ext: 'png', base64: bytesToBase64(svg) }] }));
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect(existsSync(store.path('images', `${evilHash}.png`))).toBe(false);
  });

  it('el autor edita su pregunta, otra persona necesita revisión', async () => {
    const question = makeMcq({ author: null });
    await send(questionsSubmission({ questions: [question] }));
    await run();
    const edit = { ...question, rev: 2, statement: 'Enunciado corregido por su autora, con más detalle' };
    await send(questionsSubmission({ subjects: [], questions: [edit] }));
    await run();
    let store = await loadRemote();
    expect(store.question(question.id)?.rev).toBe(2);

    const foreign = { ...edit, rev: 3, statement: 'Enunciado corregido por otra persona distinta' };
    const issue = await send(questionsSubmission({ subjects: [], questions: [foreign] }), LUIS);
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.review);
    store = await loadRemote();
    expect(store.question(question.id)?.rev).toBe(2);
  });

  it('una edición sobre base obsoleta se rechaza como conflicto', async () => {
    const question = makeMcq({ author: null });
    await send(questionsSubmission({ questions: [question] }));
    await run();
    const issue = await send(questionsSubmission({ subjects: [], questions: [{ ...question, rev: 1, statement: 'Otra edición sobre una base vieja' }] }));
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect(api.lastComment(issue)).toContain('modificado');
  });
});

describe('intake: lotes con varios envíos', () => {
  const statement = 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole';

  it('una pregunta que va a revisión no borra lo aprobado antes en el mismo lote', async () => {
    await send(questionsSubmission({ questions: [makeMcq({ author: null, statement })] }));
    await run();
    const accepted = makeMcq({ id: uuid(), author: null, statement: 'Pregunta aceptada en el mismo lote que otra dudosa' });
    await send(questionsSubmission({ subjects: [], questions: [accepted] }), LUIS);
    await send(questionsSubmission({ subjects: [], questions: [makeMcq({ id: uuid(), author: null, statement: `${statement} ventricular` })] }), user('marta', 13));
    const results = await send({ v: 1, kind: 'connect', nonce: nonce() }, user('nuria', 14));
    await run();

    const store = await loadRemote();
    expect((await store.allSystemEvents()).map((e) => e.q)).toContain(accepted.id);
    expect(store.users.has('luis')).toBe(true);
    expect(store.users.has('marta')).toBe(true);
    expect(store.users.has('nuria')).toBe(true);
    expect(api.labels.get(results.number)).toContain(LABELS.accepted);
  });

  it('un fallo inesperado sólo afecta a su envío: lo demás se guarda y se avisa', async () => {
    const question = makeMcq({ author: null });
    await send(questionsSubmission({ questions: [question] }));
    await run();
    const before = await send({ v: 1, kind: 'connect', nonce: nonce() }, LUIS);
    const crashing = await send({ v: 1, kind: 'retire', nonce: nonce(), questionId: question.id }, user('marta', 13));
    const after = await send({ v: 1, kind: 'profile', nonce: nonce(), bio: 'Después del fallo' }, user('nuria', 14));
    const permission = api.permission.bind(api);
    api.permission = async () => {
      throw new Error('fallo inesperado de la API');
    };
    const result = await run();
    api.permission = permission;

    expect(result.processed).toBe(3);
    expect(api.labels.get(crashing.number)).toContain(LABELS.error);
    expect(api.closed.has(crashing.number)).toBe(false);
    expect(api.labels.get(before.number)).toContain(LABELS.accepted);
    expect(api.labels.get(after.number)).toContain(LABELS.accepted);
    const store = await loadRemote();
    expect(store.users.has('luis')).toBe(true);
    expect(store.users.get('nuria')?.bio).toBe('Después del fallo');
    expect(store.isRetired(question.id)).toBe(false);
    // No se reintenta en cada barrido.
    expect((await run()).processed).toBe(0);
  });

  it('un fallo a medias no deja escritura parcial', async () => {
    const issue = await send({ v: 1, kind: 'profile', nonce: nonce(), bio: 'Hola' });
    const good = await send({ v: 1, kind: 'connect', nonce: nonce() }, LUIS);
    const put = DataStore.prototype.putUser;
    let calls = 0;
    DataStore.prototype.putUser = async function patched(this: DataStore, doc) {
      calls += 1;
      await put.call(this, doc);
      // El primer usuario se escribe y el envío falla justo después.
      if (calls === 1) throw new Error('fallo tras escribir');
    };
    try {
      await run();
    } finally {
      DataStore.prototype.putUser = put;
    }
    expect(api.labels.get(issue.number)).toContain(LABELS.error);
    expect(api.labels.get(good.number)).toContain(LABELS.accepted);
    const store = await loadRemote();
    expect(store.users.has('ana')).toBe(false);
    expect(store.users.has('luis')).toBe(true);
  });

  it('un fallo pasajero de GitHub no marca el envío: queda abierto y entra en el siguiente barrido', async () => {
    const issue = await send(questionsSubmission());
    const createPull = api.createPull.bind(api);
    api.createPull = async () => {
      throw new GitHubHttpError(502, 'Server Error');
    };
    expect((await run()).processed).toBe(0);
    expect(api.labels.get(issue.number)).toBeUndefined();
    expect(api.comments.has(issue.number)).toBe(false);
    expect(api.closed.has(issue.number)).toBe(false);
    expect((await loadRemote()).questions.size).toBe(0);

    api.createPull = createPull;
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
    expect((await loadRemote()).questions.size).toBe(1);
  });

  it('si se aplicó pero no se pudo avisar, el siguiente barrido no da un falso rechazo', async () => {
    const question = makeMcq({ author: null });
    const issue = await send(questionsSubmission({ questions: [question] }));
    const comment = api.comment.bind(api);
    api.comment = async () => {
      throw new GitHubHttpError(500, '');
    };
    await run();
    expect(api.closed.has(issue.number)).toBe(false);
    expect((await loadRemote()).questions.size).toBe(1);

    api.comment = comment;
    await run();
    expect(api.labels.get(issue.number)).toEqual([LABELS.accepted]);
    expect(api.lastComment(issue)).toContain('ya están publicadas');
    expect(api.pulls).toHaveLength(1);
  });

  it('un issue creado sin pegar los datos se rechaza explicando qué pasó', async () => {
    const issue = await send(questionsSubmission());
    issue.body = '';
    await run();
    expect(api.labels.get(issue.number)).toEqual([LABELS.rejected]);
    expect(api.lastComment(issue)).toContain('sin los datos del envío');
  });

  it('si GitHub falla justo después de fusionar, el reproceso anota la aprobación', async () => {
    const issue = await send(questionsSubmission());
    const merge = api.onMerge;
    const syncData = repo.git.syncData.bind(repo.git);
    api.onMerge = (number, head) => {
      merge(number, head);
      // La fusión ya está hecha; el `git fetch` que viene detrás falla como un 5xx.
      repo.git.syncData = async () => {
        repo.git.syncData = syncData;
        throw new TypeError('fetch failed');
      };
    };
    await run();
    expect(api.labels.get(issue.number) ?? []).toEqual([]);

    api.onMerge = merge;
    await run();
    expect(api.lastComment(issue)).toContain('ya están publicadas');
    expect(await (await loadRemote()).allSystemEvents()).toEqual([expect.objectContaining({ t: 'question-approved', by: 'ana' })]);
  });

  it('una entrega ya guardada no se rechaza al reprocesarla', async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeMcq({ id: uuid(), author: null, statement: `Pregunta ${i} para reprocesar una entrega` }));
    await send(questionsSubmission({ questions }));
    await send({ v: 1, kind: 'competition-create', nonce: nonce(), type: 'group', title: 'Reproceso', filters: {}, questionCount: 3, durationSec: 300, windowHours: 24, invited: [], maxParticipants: null });
    await run();
    const [competition] = await (await loadRemote()).allCompetitions();
    const entry = await send({ v: 1, kind: 'competition-entry', nonce: nonce(), competitionId: competition?.id as string, durationMs: 1000, answers: (competition?.questionIds ?? []).map((q) => ({ q, sel: ['a'], ms: 1000 })) }, ANA, NOW);
    const comment = api.comment.bind(api);
    api.comment = async () => {
      throw new GitHubHttpError(500, '');
    };
    await run();
    api.comment = comment;
    await run();
    expect(api.labels.get(entry.number)).toEqual([LABELS.accepted]);
  });

  it('crear una competición dos veces por un reproceso no la duplica', async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeMcq({ id: uuid(), author: null, statement: `Pregunta ${i} para reprocesar una creación` }));
    await send(questionsSubmission({ questions }));
    await run();
    const create = await send({ v: 1, kind: 'competition-create', nonce: nonce(), type: 'group', title: 'Una sola', filters: {}, questionCount: 3, durationSec: 300, windowHours: 24, invited: [], maxParticipants: null });
    const comment = api.comment.bind(api);
    api.comment = async () => {
      throw new GitHubHttpError(500, '');
    };
    await run();
    api.comment = comment;
    await run();
    expect(await (await loadRemote()).allCompetitions()).toHaveLength(1);
    expect(api.lastComment(create)).toMatch(/QB-[A-Z0-9]{6}/);
  });

  it('si no se puede lanzar el despliegue, los datos ya están a salvo', async () => {
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() });
    api.dispatchWorkflow = async () => {
      throw new GitHubHttpError(500, '');
    };
    await expect(run()).resolves.toMatchObject({ published: true });
    expect(api.closed.get(issue.number)).toBe('completed');
  });

  it('reabrir un envío ya resuelto no lo vuelve a procesar', async () => {
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() });
    await run();
    const comments = api.comments.get(issue.number)?.length;
    issue.state = 'open';
    expect((await run()).processed).toBe(0);
    expect(api.comments.get(issue.number)?.length).toBe(comments);
  });
});

describe('intake: resultados', () => {
  const answer = (q: string, id: string, overrides: Partial<AnswerEvent> = {}): AnswerEvent => ({ id, q, sel: ['a'], ms: 5000, at: Math.floor((NOW - 3_600_000) / 1000), m: 'practice', ...overrides });

  async function published() {
    const question = makeMcq({ author: null });
    await send(questionsSubmission({ questions: [question] }), LUIS);
    await run();
    api.dispatched = [];
    return question;
  }

  it('guarda las respuestas con hora y origen del issue, y no acepta declarar más', async () => {
    const question = await published();
    const issue = await send({ v: 1, kind: 'results', nonce: nonce(), answers: [answer(question.id, 'attempt0001')] });
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
    expect(api.dispatched).toEqual(['deploy.yml']);
    const events = await (await loadRemote()).readUserAnswers('ana', ['2026-11']);
    expect(events).toEqual([expect.objectContaining({ id: 'attempt0001', src: issue.number, rcv: Math.floor((NOW - 60_000) / 1000) })]);
    // Nada de «correct» ni de puntos en el registro.
    expect(Object.keys(events[0] as object).sort()).toEqual(['at', 'id', 'm', 'ms', 'q', 'rcv', 'sel', 'src']);
  });

  it('reenviar el mismo lote es inocuo', async () => {
    const question = await published();
    const payload: Submission = { v: 1, kind: 'results', nonce: nonce(), answers: [answer(question.id, 'attempt0002')] };
    await send(payload);
    await run();
    const again = await send({ ...payload, nonce: nonce() });
    await run();
    expect(api.lastComment(again)).toContain('ya estaban publicadas');
    expect(await (await loadRemote()).readUserAnswers('ana', ['2026-11'])).toHaveLength(1);
  });

  it('descarta preguntas sin publicar y fechas no admitidas, y lo explica', async () => {
    const question = await published();
    const issue = await send({
      v: 1,
      kind: 'results',
      nonce: nonce(),
      answers: [
        answer(question.id, 'attempt0003'),
        answer(uuid(), 'attempt0004'),
        answer(question.id, 'attempt0005', { at: Math.floor((NOW + 86_400_000) / 1000) }),
        answer(question.id, 'attempt0006', { at: Math.floor((NOW - 30 * 86_400_000) / 1000) }),
      ],
    });
    await run();
    expect(await (await loadRemote()).readUserAnswers('ana', ['2026-11'])).toHaveLength(1);
    expect(api.lastComment(issue)).toContain('1 de preguntas que no están publicadas');
    expect(api.lastComment(issue)).toContain('2 con fecha no admitida');
  });
});

describe('intake: identidad y seguridad', () => {
  it('registra la cuenta con la fecha del issue', async () => {
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() }, ANA, NOW - 5000);
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
    const account = (await loadRemote()).users.get('ana');
    expect(account).toMatchObject({ login: 'ana', githubId: 11, registeredAt: new Date(NOW - 5000).toISOString() });
    expect(account?.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//);
  });

  it('el perfil limpia caracteres de control y sólo toca a quien envía', async () => {
    await send({ v: 1, kind: 'connect', nonce: nonce() }, LUIS);
    await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Ana\u0007 G.', bio: 'Estudio\u0000 medicina' });
    await run();
    const store = await loadRemote();
    // En el nombre los invisibles se quitan sin dejar hueco; en la bio se cambian por espacios.
    expect(store.users.get('ana')).toMatchObject({ displayName: 'Ana G.', bio: 'Estudio  medicina' });
    expect(store.users.get('luis')?.bio).toBeUndefined();
  });

  it('el nombre se cambia como mucho una vez cada 30 días, con la hora del issue', async () => {
    const DAY = 86_400_000;
    await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Ana García' }, ANA, NOW - 40 * DAY);
    await run();
    expect((await loadRemote()).users.get('ana')).toMatchObject({ displayName: 'Ana García', nameChangedAt: new Date(NOW - 40 * DAY).toISOString() });

    const early = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Ana G.', bio: 'Hola' }, ANA, NOW - 20 * DAY);
    await run();
    expect(api.labels.get(early.number)).toContain(LABELS.rejected);
    const untouched = (await loadRemote()).users.get('ana');
    expect(untouched?.displayName).toBe('Ana García');
    expect(untouched?.bio).toBeUndefined();

    // Cambiar sólo la biografía no gasta el cambio de nombre.
    const bioOnly = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Ana García', bio: 'Sólo la bio' }, ANA, NOW - 19 * DAY);
    await run();
    expect(api.labels.get(bioOnly.number)).toContain(LABELS.accepted);
    expect((await loadRemote()).users.get('ana')).toMatchObject({ bio: 'Sólo la bio', nameChangedAt: new Date(NOW - 40 * DAY).toISOString() });

    const later = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Ana G.' }, ANA, NOW - 5 * DAY);
    await run();
    expect(api.labels.get(later.number)).toContain(LABELS.accepted);
    expect((await loadRemote()).users.get('ana')).toMatchObject({ displayName: 'Ana G.', nameChangedAt: new Date(NOW - 5 * DAY).toISOString() });
  });

  it('no deja usar el nombre ni el usuario de otra cuenta', async () => {
    await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Luisa M.' }, LUIS);
    await run();
    const copy = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'luisa m' });
    const login = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'L U I S' });
    const symbols = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: '★ ★' });
    // Un espacio de anchura cero no basta para que parezca otro nombre.
    const hidden = await send({ v: 1, kind: 'profile', nonce: nonce(), displayName: 'Lu\u200bisa M.' });
    await run();
    for (const issue of [copy, login, symbols, hidden]) expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect((await loadRemote()).users.get('ana')?.displayName).toBeUndefined();
  });

  it('no permite suplantar un login reutilizado por otra cuenta', async () => {
    await send({ v: 1, kind: 'connect', nonce: nonce() }, user('ana', 11));
    await run();
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() }, user('ana', 999));
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect((await loadRemote()).users.get('ana')?.githubId).toBe(11);
  });

  it('rechaza bots y cuentas vetadas', async () => {
    const bot = await send({ v: 1, kind: 'connect', nonce: nonce() }, { ...user('robot', 3), type: 'Bot' });
    await run();
    expect(api.labels.get(bot.number)).toContain(LABELS.rejected);

    await repo.git.syncData();
    execFileSync('mkdir', ['-p', join(repo.work, 'moderation')]);
    writeFileSync(join(repo.work, 'moderation/banned.json'), JSON.stringify({ logins: ['ana'] }));
    await repo.git.commitAll('Veto');
    await repo.git.pushData();
    const banned = await send({ v: 1, kind: 'connect', nonce: nonce() });
    await run();
    expect(api.labels.get(banned.number)).toContain(LABELS.rejected);
    expect((await loadRemote()).users.has('ana')).toBe(false);
  });

  it('ignora issues normales y PRs', async () => {
    const normal = await send({ v: 1, kind: 'connect', nonce: nonce() });
    normal.title = 'Un issue cualquiera sobre un error';
    const pr = await send({ v: 1, kind: 'connect', nonce: nonce() });
    pr.is_pull_request = true;
    expect(await run()).toEqual({ processed: 0, published: false });
    expect(api.comments.size).toBe(0);
  });

  it('un cuerpo manipulado se rechaza sin romper el lote', async () => {
    const broken = await send({ v: 1, kind: 'connect', nonce: nonce() });
    broken.body = 'He borrado el bloque de datos';
    const fine = await send({ v: 1, kind: 'connect', nonce: nonce() }, LUIS);
    await run();
    expect(api.labels.get(broken.number)).toContain(LABELS.rejected);
    expect(api.labels.get(fine.number)).toContain(LABELS.accepted);
  });

  it('una bomba de descompresión no tumba el proceso', async () => {
    const bomb = await send({ v: 1, kind: 'connect', nonce: nonce() });
    const payload = bytesToBase64Url(await gzip(new Uint8Array(50 * 1024 * 1024)));
    bomb.body = `\`\`\`qb1\n${payload}\n\`\`\``;
    await run();
    expect(api.labels.get(bomb.number)).toContain(LABELS.rejected);
  });

  it('un JSON con forma incorrecta se rechaza', async () => {
    const bad = await send({ v: 1, kind: 'connect', nonce: nonce() });
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, kind: 'results', nonce: 'corto', answers: 'no' }));
    bad.body = `\`\`\`qb1\n${bytesToBase64Url(await gzip(json))}\n\`\`\``;
    await run();
    expect(api.lastComment(bad)).toContain('formato válido');
  });

  it('el título no puede inyectar nada en git', async () => {
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() });
    issue.title = '[QB:connect] $(touch /tmp/qb-pwned) `rm -rf /` ; echo hola';
    await run();
    expect(existsSync('/tmp/qb-pwned')).toBe(false);
    expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
  });

  it('los reportes quedan abiertos para las personas y no se reprocesan', async () => {
    const report = await send({ v: 1, kind: 'report', nonce: nonce(), questionId: uuid(), reason: 'copyright', detail: 'Copiada de un examen' });
    await run();
    expect(api.labels.get(report.number)).toContain(LABELS.report);
    expect(api.closed.has(report.number)).toBe(false);
    expect(await run()).toEqual({ processed: 0, published: false });
  });

  it('procesa como máximo un lote y deja el resto para el siguiente barrido', async () => {
    for (let i = 0; i < 27; i++) await send({ v: 1, kind: 'connect', nonce: nonce() }, user(`usuario${i}`, 2000 + i));
    expect((await run()).processed).toBe(25);
    expect((await run()).processed).toBe(2);
    expect((await loadRemote()).users.size).toBe(27);
  });

  it('solo avisa después de guardar: si el push falla, el issue sigue abierto', async () => {
    const issue = await send({ v: 1, kind: 'connect', nonce: nonce() });
    const original = repo.git.pushData.bind(repo.git);
    repo.git.pushData = async () => {
      throw new Error('push falló');
    };
    await expect(run()).rejects.toThrow('push falló');
    expect(api.comments.size).toBe(0);
    expect(api.closed.size).toBe(0);
    repo.git.pushData = original;
    await run();
    expect(api.closed.get(issue.number)).toBe('completed');
  });

  it('el autor de la retirada debe ser el dueño o un mantenedor', async () => {
    const question = makeMcq({ author: null });
    await send(questionsSubmission({ questions: [question] }));
    await run();
    const foreign = await send({ v: 1, kind: 'retire', nonce: nonce(), questionId: question.id }, LUIS);
    await run();
    expect(api.labels.get(foreign.number)).toContain(LABELS.rejected);
    expect((await loadRemote()).isRetired(question.id)).toBe(false);
    await send({ v: 1, kind: 'retire', nonce: nonce(), questionId: question.id });
    await run();
    expect((await loadRemote()).isRetired(question.id)).toBe(true);
  });

  it('funde la asignatura con la existente aunque el cliente use otro id', async () => {
    await send(questionsSubmission());
    await run();
    const otherTopic = uuid();
    const proposal = makeSubject({ id: uuid(), name: 'ANATOMÍA', createdBy: null, units: [{ id: uuid(), name: 'sistema locomotor', order: 0, topics: [{ id: otherTopic, name: 'Articulaciones', order: 1 }] }] });
    await send(questionsSubmission({ subjects: [proposal], questions: [makeMcq({ id: uuid(), author: null, subjectId: proposal.id, topicIds: [otherTopic], statement: 'Otra pregunta diferente sobre articulaciones' })] }), LUIS);
    await run();
    const store = await loadRemote();
    expect(store.subjects()).toHaveLength(1);
    expect(store.subjects()[0]?.id).toBe(SUBJECT_ID);
    expect(store.subjects()[0]?.units[0]?.topics.map((t) => t.name)).toEqual(['Huesos', 'Articulaciones']);
    expect([...store.questions.values()].every((q) => q.subjectId === SUBJECT_ID)).toBe(true);
  });
});

describe('intake: envíos en varias partes', () => {
  const images = async (n: number) =>
    Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const bytes = new Uint8Array([...PNG, i]);
        const hash = await sha256Hex(bytes);
        return { hash, ext: 'png' as const, bytes, base64: bytesToBase64(bytes) };
      }),
    );

  async function partsOf(group: string, n: number, author = ANA) {
    const all = await images(n);
    const inlined = all.map(({ hash, ext, base64 }) => ({ hash, ext, base64 }));
    const question = makeMcq({ id: uuid(), author: null, statement: `Con muchas figuras ${group}: ${all.map((image) => `![x](qbimg:${image.hash})`).join(' ')}`, images: all.map((image) => ({ hash: image.hash, ext: 'png', width: 1, height: 1, bytes: image.bytes.length, alt: '' })) });
    const out = [];
    for (const [index, image] of inlined.entries()) out.push(await send(questionsSubmission({ nonce: partNonce(group, index, n + 1), questions: [], subjects: [], images: [image] }), author));
    out.push(await send(questionsSubmission({ nonce: partNonce(group, n, n + 1), questions: [question], images: [] }), author));
    return { issues: out, images: all };
  }

  it('junta las partes, publica la pregunta entera y cierra todas', async () => {
    const { issues, images: all } = await partsOf('grupoAB12', 12);
    await run();
    const store = await loadRemote();
    expect(store.questions.size).toBe(1);
    expect(all.every((image) => store.imageExists(image.hash, 'png'))).toBe(true);
    expect(api.pulls).toHaveLength(1);
    for (const issue of issues) {
      expect(api.labels.get(issue.number)).toContain(LABELS.accepted);
      expect(api.closed.get(issue.number)).toBe('completed');
    }
    // Un solo comentario: con muchas partes se pasaría del límite de creaciones por minuto.
    expect([...api.comments.keys()]).toEqual([issues[issues.length - 1]?.number]);
  });

  it('espera a que lleguen todas sin tocar nada', async () => {
    const { issues } = await partsOf('grupoCD34', 2);
    api.issues = api.issues.filter((issue) => issue !== issues[1]);
    await run();
    expect(api.pulls).toEqual([]);
    expect(api.closed.size).toBe(0);
    expect(api.comments.size).toBe(0);
  });

  it('no mezcla las partes de dos cuentas aunque usen el mismo identificador', async () => {
    const mine = await partsOf('grupoEF56', 1);
    api.issues = api.issues.filter((issue) => issue !== mine.issues[1]);
    await partsOf('grupoEF56', 1, LUIS);
    api.issues = api.issues.filter((issue) => issue.user.login === 'ana' || issue.title.includes('p2of2'));
    await run();
    expect(api.pulls).toEqual([]);
    expect(api.closed.size).toBe(0);
  });

  it('lo incompleto no tapa la cola', async () => {
    for (let i = 0; i < POLICY.maxSubmissionsPerRun + 3; i++) await send(questionsSubmission({ nonce: partNonce(`grupoEspera${i}`, 0, 2), questions: [], subjects: [], images: [] }), ANA, NOW - 120_000);
    const normal = await send(questionsSubmission());
    await run();
    expect(api.labels.get(normal.number)).toContain(LABELS.accepted);
  });

  it('si no llegan todas a tiempo, avisa y no publica nada', async () => {
    const issue = await send(questionsSubmission({ nonce: partNonce('grupoViejo', 0, 2), questions: [], subjects: [], images: [] }), ANA, NOW - POLICY.maxPartWaitMs - 60_000);
    await run();
    expect(api.labels.get(issue.number)).toContain(LABELS.rejected);
    expect(api.comments.get(issue.number)?.[0]).toMatch(/partes/);
    expect(api.pulls).toEqual([]);
  });
});

describe('intake: límites de imágenes', () => {
  it('una pregunta admite muchas más imágenes que antes', async () => {
    expect(LIMITS.images).toBeGreaterThanOrEqual(50);
  });

  it('rechaza un envío que supera el peso máximo de imágenes', async () => {
    const big = new Uint8Array(POLICY.maxImageBytesPerSubmission + 1);
    big.set(PNG);
    const hash = await sha256Hex(big);
    const result = await validateContribution({ actor: { login: 'ana', id: 11, isMaintainer: false }, questions: [], subjects: [], images: [{ hash, ext: 'png', bytes: big }], now: NOW, mode: 'issue' }, await new DataStore(repo.work).load());
    expect(result.findings.map((f) => f.code)).toContain('image-invalid');
  });
});
