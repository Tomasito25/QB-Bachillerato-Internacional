import { readFileSync } from 'node:fs';
import { normalizeLogin } from '../../core/schema/common.ts';
import { isAccepted, needsReview, validateContribution, type Finding, type ProposedImage } from '../../core/validation/contribution.ts';
import type { DataStore } from '../lib/data-store.ts';
import type { GitPort } from '../lib/git.ts';
import { isMaintainerPermission, type GitHubApi, type PullData } from '../lib/github.ts';
import { LABELS } from './intake.ts';

/**
 * Revisión de un PR contra `data`.
 *
 * Corre con `pull_request_target`, es decir, con permisos de escritura y el código de `main`.
 * Esto es seguro sólo si se cumple una regla, y aquí se cumple: **no se hace checkout del PR ni
 * se ejecuta nada suyo**. Sus ficheros se leen por la API, como bytes, y pasan por el validador.
 */

export const LICENSE_MARKER = '<!-- qb:license-accepted -->';
const LINKED_ISSUE = /<!-- qb:issue=(\d+) -->/;

const QUESTION_PATH = /^questions\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.json$/;
const SUBJECT_PATH = /^taxonomy\/([0-9a-f-]{36})\.json$/;
const IMAGE_PATH = /^images\/([0-9a-f]{64})\.(webp|png|jpg)$/;

export interface ReviewDeps {
  api: GitHubApi;
  store: DataStore;
  git: GitPort;
  now: () => number;
  autoMerge: boolean;
  log: (message: string) => void;
  defaultBranch: string;
  /** `propietario/nombre` de este repositorio. */
  repo: string;
}

function summarize(findings: readonly Finding[]): string {
  return findings.map((f) => `- ${f.level === 'error' ? '❌' : '👀'} ${f.message}`).join('\n');
}

const decoder = new TextDecoder();

/** Lee los ficheros del PR como datos y comprueba que cada ruta encaje con su contenido. */
async function readContribution(api: GitHubApi, pull: PullData): Promise<{ questions: unknown[]; subjects: unknown[]; images: ProposedImage[]; problems: string[] }> {
  const questions: unknown[] = [];
  const subjects: unknown[] = [];
  const images: ProposedImage[] = [];
  const problems: string[] = [];
  const repo = pull.head.repo;
  if (!repo) return { questions, subjects, images, problems: ['El fork de origen ya no existe.'] };

  for (const file of await api.listPullFiles(pull.number)) {
    if (file.status !== 'added' && file.status !== 'modified') {
      problems.push(`\`${file.filename}\`: una aportación no puede borrar ni mover ficheros.`);
      continue;
    }
    const question = QUESTION_PATH.exec(file.filename);
    const subject = SUBJECT_PATH.exec(file.filename);
    const image = IMAGE_PATH.exec(file.filename);
    if (!question && !subject && !image) {
      // Eventos, usuarios y moderación sólo los escribe Actions.
      problems.push(`\`${file.filename}\`: esta ruta no se puede modificar desde una aportación.`);
      continue;
    }
    const bytes = await api.getBlob(repo, file.sha);
    if (image) {
      images.push({ hash: image[1] as string, ext: image[2] as ProposedImage['ext'], bytes });
      continue;
    }
    let parsed: { id?: unknown; subjectId?: unknown };
    try {
      parsed = JSON.parse(decoder.decode(bytes)) as { id?: unknown; subjectId?: unknown };
    } catch {
      problems.push(`\`${file.filename}\` no es JSON válido.`);
      continue;
    }
    if (question) {
      if (parsed.id !== question[2] || parsed.subjectId !== question[1]) problems.push(`\`${file.filename}\`: la ruta no coincide con el contenido.`);
      else questions.push(parsed);
    } else if (subject) {
      if (parsed.id !== subject[1]) problems.push(`\`${file.filename}\`: la ruta no coincide con el contenido.`);
      else subjects.push(parsed);
    }
  }
  return { questions, subjects, images, problems };
}

async function emitApproved(deps: ReviewDeps, questionIds: readonly string[], login: string, pull: number): Promise<void> {
  const { store, git, now } = deps;
  if (questionIds.length === 0) return;
  await git.syncData();
  await store.load();
  const already = new Set((await store.allSystemEvents()).filter((e) => e.t === 'question-approved').map((e) => e.q));
  let wrote = false;
  for (const id of questionIds) {
    if (already.has(id)) continue;
    await store.appendSystemEvent({ t: 'question-approved', q: id, by: login, at: Math.floor(now() / 1000), pr: pull });
    wrote = true;
  }
  if (wrote && (await git.commitAll(`Aprobadas ${questionIds.length} preguntas de @${login} (#${pull})`))) await git.pushData();
}

export async function reviewPull(deps: ReviewDeps, number: number): Promise<'merged' | 'review' | 'rejected' | 'skipped'> {
  const { api, store, git, now, autoMerge, log } = deps;
  const pull = await api.getPull(number);
  if (pull.base.ref !== 'data' || pull.state !== 'open') return 'skipped';
  // Las ramas `contrib/` de este repositorio las crea el intake, que ya las ha validado. Un
  // fork puede llamar igual a su rama: por eso se comprueba también de dónde viene.
  if (pull.head.ref.startsWith('contrib/') && pull.head.repo === deps.repo) return 'skipped';

  await git.syncData();
  await store.load();

  const login = normalizeLogin(pull.user.login);
  if (store.banned.has(login)) {
    await api.comment(number, 'Esta cuenta no puede publicar.');
    await api.addLabels(number, [LABELS.rejected]);
    return 'rejected';
  }

  const contribution = await readContribution(api, pull);
  const result = await validateContribution(
    {
      actor: { login, id: pull.user.id, isMaintainer: isMaintainerPermission(await api.permission(login)) },
      questions: contribution.questions,
      subjects: contribution.subjects,
      images: contribution.images,
      now: now(),
      mode: 'pr',
    },
    store,
  );

  const pathProblems = contribution.problems.map((message): Finding => ({ level: 'error', code: 'schema', message }));
  const licenseMissing: Finding[] = (pull.body ?? '').includes(LICENSE_MARKER) ? [] : [{ level: 'review', code: 'schema', message: 'No consta la aceptación de la licencia en la descripción del PR.' }];
  const findings = [...pathProblems, ...licenseMissing, ...result.findings];
  const rejected = !isAccepted({ ...result, findings });

  if (rejected) {
    await api.comment(number, `No se puede aceptar esta aportación:\n\n${summarize(findings)}\n\nCorrige los ficheros y vuelve a subir la rama: se revisará de nuevo.`);
    await api.addLabels(number, [LABELS.rejected]);
    log(`PR #${number} rechazado.`);
    return 'rejected';
  }

  if (needsReview({ ...result, findings }) || !autoMerge) {
    const body = findings.length > 0 ? `Pasa la validación, pero necesita una revisión humana:\n\n${summarize(findings)}` : 'Pasa la validación. Queda pendiente de revisión.';
    await api.comment(number, body);
    await api.addLabels(number, [LABELS.review]);
    return 'review';
  }

  const merged = await api.mergePull(number, pull.head.sha, pull.title.slice(0, 200));
  if (!merged) {
    await api.comment(number, 'La validación es correcta, pero no se ha podido fusionar automáticamente. Un mantenedor lo revisará.');
    await api.addLabels(number, [LABELS.review]);
    return 'review';
  }
  await api.addLabels(number, [LABELS.accepted]);
  await api.comment(number, 'Validado y publicado. Aparecerá en la app en unos minutos. ¡Gracias!');
  await emitApproved(deps, result.newQuestionIds, login, number);
  await api.dispatchWorkflow('deploy.yml', deps.defaultBranch);
  return 'merged';
}

/**
 * Un PR que se cerró: si lo fusionó una persona hay que registrar la aprobación (lo que hace un
 * mantenedor sí dispara este evento). Si se cerró sin fusionar, se avisa al envío de origen.
 */
export async function pullClosed(deps: ReviewDeps, number: number): Promise<void> {
  const { api, store } = deps;
  const pull = await api.getPull(number);
  if (pull.base.ref !== 'data') return;
  const linked = LINKED_ISSUE.exec(pull.body ?? '');
  const issueNumber = linked?.[1] ? Number(linked[1]) : null;

  if (!pull.merged) {
    if (issueNumber) {
      await api.comment(issueNumber, `La propuesta se ha cerrado sin publicar (${pull.html_url}). Mira allí los comentarios.`);
      await api.addLabels(issueNumber, [LABELS.rejected]);
    }
    return;
  }

  const added = (await api.listPullFiles(number)).filter((f) => f.status === 'added').flatMap((f) => {
    const match = QUESTION_PATH.exec(f.filename);
    return match?.[2] ? [match[2]] : [];
  });
  await deps.git.syncData();
  await store.load();
  // El autor de un PR del intake es el bot: el de verdad está en cada pregunta.
  const byAuthor = new Map<string, string[]>();
  for (const id of added) {
    const author = store.question(id)?.author?.login;
    if (!author) continue;
    byAuthor.set(author, [...(byAuthor.get(author) ?? []), id]);
  }
  for (const [author, ids] of byAuthor) await emitApproved(deps, ids, author, number);
  if (issueNumber) {
    await api.comment(issueNumber, `Publicado tras la revisión (${pull.html_url}).`);
    await api.addLabels(issueNumber, [LABELS.accepted]);
  }
  await api.deleteBranch(pull.head.ref).catch(() => undefined);
  await api.dispatchWorkflow('deploy.yml', deps.defaultBranch);
}

export function pullNumberFromEvent(path: string): { number: number; action: string } {
  const event = JSON.parse(readFileSync(path, 'utf8')) as { action: string; pull_request: { number: number } };
  return { number: event.pull_request.number, action: event.action };
}
