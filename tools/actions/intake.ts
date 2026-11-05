import { buildCompetition, buildBracket, activeInRound, CompetitionError, entryProblem } from '../../core/competitions/competitions.ts';
import { questionFingerprint } from '../../core/questions/normalize.ts';
import { normalizeLogin, type UserRef } from '../../core/schema/common.ts';
import { migrateDocument } from '../../core/schema/migrations.ts';
import { Question } from '../../core/schema/question.ts';
import type { Competition } from '../../core/schema/competition.ts';
import type { StoredAnswerEvent } from '../../core/schema/events.ts';
import { Submission, type InlineImage } from '../../core/schema/submission.ts';
import { decodeIssueBody, EnvelopeError, isSubmissionTitle } from '../../core/submissions/envelope.ts';
import { buildTaxonomyIndex } from '../../core/taxonomy/merge.ts';
import { base64ToBytes, sha256Hex } from '../../core/util/encoding.ts';
import { dayKey, monthKey, toIso } from '../../core/util/time.ts';
import { isAccepted, needsReview, validateContribution, type Finding, type ProposedImage } from '../../core/validation/contribution.ts';
import { POLICY } from '../../core/validation/policy.ts';
import type { DataStore } from '../lib/data-store.ts';
import { type GitPort } from '../lib/git.ts';
import { isMaintainerPermission, isTransientError, type GitHubApi, type IssueData } from '../lib/github.ts';

/**
 * Procesa los envíos: el «servidor» de la aplicación.
 *
 * Cada ejecución barre todos los issues abiertos con el prefijo, no sólo el que la disparó: la
 * cola de concurrencia de Actions puede desbordarse, y así ningún envío se queda atrás.
 *
 * Reglas de seguridad de este fichero:
 *   - El autor y la hora salen del issue, nunca de su contenido.
 *   - Lo recibido sólo se valida y se escribe como datos. Nunca se ejecuta ni se interpola.
 *   - Primero se guarda (push) y después se avisa: si algo falla a medias, el issue sigue
 *     abierto y el reproceso es idempotente. Reprocesar algo ya aplicado da «aceptado», nunca
 *     un falso rechazo: un 5xx de GitHub no garantiza que la operación no se aplicara.
 */

export const LABELS = {
  accepted: 'qb:accepted',
  rejected: 'qb:rejected',
  review: 'qb:review',
  report: 'qb:report',
  error: 'qb:error',
} as const;

export interface IntakeDeps {
  api: GitHubApi;
  store: DataStore;
  git: GitPort;
  now: () => number;
  autoMerge: boolean;
  log: (message: string) => void;
  /** Ref donde están los workflows. */
  defaultBranch: string;
}

type Status = 'accepted' | 'rejected' | 'review' | 'report';

interface Outcome {
  issue: IssueData;
  status: Status;
  message: string;
  /** El envío tocó los datos publicados. */
  changed: boolean;
}

function formatFindings(findings: readonly Finding[]): string {
  return findings.map((f) => `- ${f.level === 'error' ? '❌' : '👀'} ${f.message}`).join('\n');
}

function actorOf(issue: IssueData): UserRef {
  return { login: normalizeLogin(issue.user.login), id: issue.user.id };
}

function epoch(ms: number): number {
  return Math.floor(ms / 1000);
}

function clean(text: string | undefined): string | undefined {
  // Texto plano: fuera caracteres de control. Se muestra siempre como texto, nunca como HTML.
  // eslint-disable-next-line no-control-regex
  const value = text?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return value || undefined;
}

class Intake {
  private readonly deps: IntakeDeps;
  private readonly outcomes: Outcome[] = [];
  /** Hay commits locales en `data` que aún no se han subido. */
  private pendingPush = false;
  private dataChanged = false;

  constructor(deps: IntakeDeps) {
    this.deps = deps;
  }

  private async pushPending(): Promise<void> {
    if (!this.pendingPush) return;
    await this.deps.git.pushData();
    this.pendingPush = false;
    this.dataChanged = true;
  }

  private done(issue: IssueData, status: Status, message: string, changed = false): void {
    this.outcomes.push({ issue, status, message, changed });
  }

  private async ensureUser(issue: IssueData): Promise<void> {
    const { store } = this.deps;
    const actor = actorOf(issue);
    const existing = store.users.get(actor.login);
    if (existing?.githubId === actor.id) {
      if (existing.avatarUrl === issue.user.avatar_url) return;
      await store.putUser({ ...existing, avatarUrl: issue.user.avatar_url, updatedAt: toIso(this.deps.now()) });
      return;
    }
    await store.putUser({
      schemaVersion: 1,
      login: actor.login,
      githubId: actor.id,
      avatarUrl: issue.user.avatar_url.startsWith('https://avatars.githubusercontent.com/') ? issue.user.avatar_url : `https://avatars.githubusercontent.com/u/${actor.id}`,
      registeredAt: issue.created_at,
      updatedAt: toIso(this.deps.now()),
    });
  }

  /** Un login se puede reutilizar tras un cambio de nombre: el id numérico no. */
  private loginConflict(issue: IssueData): boolean {
    const actor = actorOf(issue);
    const existing = this.deps.store.users.get(actor.login);
    return existing !== undefined && existing.githubId !== actor.id;
  }

  /** El envío ya está dentro: lo aplicó una ejecución anterior que no llegó a avisar. */
  private async alreadyPublished(submission: Extract<Submission, { kind: 'questions' }>): Promise<boolean> {
    for (const raw of submission.questions) {
      const parsed = Question.safeParse(migrateDocument(raw));
      if (!parsed.success) return false;
      const existing = this.deps.store.question(parsed.data.id);
      if (!existing || (await questionFingerprint(existing)) !== (await questionFingerprint(parsed.data))) return false;
    }
    return true;
  }

  private async questions(issue: IssueData, submission: Extract<Submission, { kind: 'questions' }>): Promise<void> {
    const { api, store, git, now, autoMerge } = this.deps;
    const actor = actorOf(issue);
    const rcv = Date.parse(issue.created_at);

    if (await this.alreadyPublished(submission)) {
      this.done(issue, 'accepted', 'Estas preguntas ya están publicadas.', false);
      return;
    }

    const approvedToday = (await store.allSystemEvents()).filter((e) => e.t === 'question-approved' && e.by === actor.login && dayKey(e.at * 1000) === dayKey(now())).length;
    if (approvedToday + submission.questions.length > POLICY.maxQuestionsPerDay) {
      this.done(issue, 'rejected', `Has alcanzado el límite de ${POLICY.maxQuestionsPerDay} preguntas al día. Vuelve a intentarlo mañana.`);
      return;
    }

    const images: ProposedImage[] = submission.images.map((image: InlineImage) => ({ hash: image.hash, ext: image.ext, bytes: base64ToBytes(image.base64) }));
    const isMaintainer = isMaintainerPermission(await api.permission(actor.login));
    const result = await validateContribution({ actor: { ...actor, isMaintainer }, questions: submission.questions, subjects: submission.subjects, images, now: rcv, mode: 'issue' }, store);

    if (!isAccepted(result)) {
      this.done(issue, 'rejected', `No se ha podido aceptar:\n\n${formatFindings(result.findings)}`);
      return;
    }
    if (result.questions.length === 0 && result.subjects.length === 0) {
      this.done(issue, 'rejected', 'El envío no contiene nada que publicar.');
      return;
    }

    const branch = `contrib/issue-${issue.number}`;
    await git.startBranch(branch);
    for (const subject of result.subjects) await store.putSubject(subject);
    for (const image of result.images) await store.putImage(image.hash, image.ext, image.bytes);
    for (const question of result.questions) await store.putQuestion(question);
    const count = result.questions.length;
    const title = `${count} ${count === 1 ? 'pregunta' : 'preguntas'} de @${actor.login} (#${issue.number})`;
    await git.commitAll(title);
    await git.pushBranch(branch);
    const headSha = await git.headSha();

    const prBody = [
      `Aportación de @${actor.login} desde #${issue.number}.`,
      '',
      `Origen declarado: \`${submission.origin}\`. Licencia aceptada: ${result.questions[0]?.license ?? 'CC-BY-SA-4.0'}.`,
      '',
      `<!-- qb:issue=${issue.number} -->`,
      result.findings.length > 0 ? `\n## Requiere revisión\n\n${formatFindings(result.findings)}` : '',
    ].join('\n');
    const pull = await api.createPull({ title, body: prBody, head: branch, base: 'data' });

    let merged = false;
    if (autoMerge && !needsReview(result)) merged = await api.mergePull(pull.number, headSha, title);

    // Pase lo que pase, se vuelve a `data`: lo del PR no debe mezclarse con lo demás de este lote.
    await git.syncData();
    await store.load();
    await this.ensureUser(issue);

    if (!merged) {
      await api.addLabels(pull.number, [LABELS.review]).catch(() => undefined);
      const why = needsReview(result) ? `Necesita una revisión humana:\n\n${formatFindings(result.findings)}` : 'Está pendiente de revisión.';
      this.done(issue, 'review', `Se ha abierto ${pull.html_url} para revisión. ${why}`);
      return;
    }

    await api.deleteBranch(branch).catch(() => undefined);
    for (const id of result.newQuestionIds) {
      await store.appendSystemEvent({ t: 'question-approved', q: id, by: actor.login, at: epoch(now()), pr: pull.number });
    }
    this.done(issue, 'accepted', `Publicado en ${pull.html_url}. Aparecerá en la app en unos minutos.`, true);
  }

  private async results(issue: IssueData, submission: Extract<Submission, { kind: 'results' }>): Promise<void> {
    const { store, now } = this.deps;
    const actor = actorOf(issue);
    const rcvMs = Date.parse(issue.created_at);
    const rcv = epoch(rcvMs);
    const previousMonth = new Date(rcvMs);
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
    const existing = await store.readUserAnswers(actor.login, [monthKey(rcvMs), monthKey(previousMonth.getTime())]);
    const ids = new Set(existing.map((e) => e.id));
    const today = dayKey(now());
    let room = POLICY.maxAnswersPerDay - existing.filter((e) => dayKey(e.rcv * 1000) === today).length;

    const accepted: StoredAnswerEvent[] = [];
    const dropped = { duplicate: 0, unknown: 0, date: 0, quota: 0 };
    for (const answer of submission.answers) {
      if (ids.has(answer.id)) {
        dropped.duplicate += 1;
      } else if (!store.questions.has(answer.q)) {
        dropped.unknown += 1;
      } else if (answer.at > rcv + 60 || rcv - answer.at > POLICY.maxAnswerAgeDays * 86_400) {
        dropped.date += 1;
      } else if (room <= 0) {
        dropped.quota += 1;
      } else {
        ids.add(answer.id);
        room -= 1;
        accepted.push({ ...answer, rcv, src: issue.number });
      }
    }

    await this.ensureUser(issue);
    if (accepted.length > 0) await store.appendAnswers(actor.login, accepted);
    const notes: string[] = [];
    if (dropped.duplicate) notes.push(`${dropped.duplicate} ya estaban publicadas`);
    if (dropped.unknown) notes.push(`${dropped.unknown} de preguntas que no están publicadas`);
    if (dropped.date) notes.push(`${dropped.date} con fecha no admitida`);
    if (dropped.quota) notes.push(`${dropped.quota} por encima del límite diario`);
    const dropNote = notes.length > 0 ? ` Descartadas: ${notes.join(', ')}.` : '';
    this.done(issue, 'accepted', `${accepted.length} ${accepted.length === 1 ? 'respuesta aceptada' : 'respuestas aceptadas'}.${dropNote} Se corrigen aquí, sin fiarse del cliente, y contarán para los rankings en el próximo despliegue.`, accepted.length > 0);
  }

  private async connect(issue: IssueData): Promise<void> {
    await this.ensureUser(issue);
    this.done(issue, 'accepted', `Cuenta conectada: **@${actorOf(issue).login}**. Ya puedes volver a la app.`, true);
  }

  private async profile(issue: IssueData, submission: Extract<Submission, { kind: 'profile' }>): Promise<void> {
    const { store, now } = this.deps;
    await this.ensureUser(issue);
    const user = store.users.get(actorOf(issue).login);
    if (!user) throw new Error('Usuario no creado');
    await store.putUser({ ...user, displayName: clean(submission.displayName), bio: clean(submission.bio), updatedAt: toIso(now()) });
    this.done(issue, 'accepted', 'Perfil actualizado.', true);
  }

  private async retire(issue: IssueData, submission: Extract<Submission, { kind: 'retire' }>): Promise<void> {
    const { api, store } = this.deps;
    const actor = actorOf(issue);
    const question = store.questions.get(submission.questionId);
    if (!question) {
      this.done(issue, 'rejected', 'Esa pregunta no existe.');
      return;
    }
    const allowed = question.author?.login === actor.login || isMaintainerPermission(await api.permission(actor.login));
    if (!allowed) {
      this.done(issue, 'rejected', 'Sólo puede retirar una pregunta quien la creó o un mantenedor.');
      return;
    }
    await store.addRetired(question.id);
    this.done(issue, 'accepted', 'Pregunta retirada. Deja de aparecer y de sumar puntos. Sigue en el historial de Git.', true);
  }

  private async competitionCreate(issue: IssueData, submission: Extract<Submission, { kind: 'competition-create' }>): Promise<void> {
    const { store, git, now } = this.deps;
    const actor = actorOf(issue);
    const rcv = Date.parse(issue.created_at);
    const all = await store.allCompetitions();
    const previous = all.find((c) => c.issue === issue.number);
    if (previous) {
      this.done(issue, 'accepted', `Competición creada. Código para unirse: **\`${previous.code}\`**.`);
      return;
    }
    const createdToday = all.filter((c) => c.createdBy?.login === actor.login && dayKey(Date.parse(c.createdAt)) === dayKey(now())).length;
    if (createdToday >= POLICY.maxCompetitionsPerDay) {
      this.done(issue, 'rejected', `Has alcanzado el límite de ${POLICY.maxCompetitionsPerDay} competiciones al día.`);
      return;
    }
    // El creador no puede conocer esta semilla al enviar: depende del commit actual de `data`.
    const seed = await sha256Hex(`${issue.node_id}:${submission.nonce}:${await git.headSha()}`);
    const available = [...store.questions.values()].filter((q) => !store.hidden.has(q.id) && !store.retired.has(q.id));
    let competition: Competition;
    try {
      competition = buildCompetition(submission, actor, rcv, seed, available, buildTaxonomyIndex(store.subjects()), issue.number);
    } catch (error) {
      if (error instanceof CompetitionError) {
        this.done(issue, 'rejected', error.message);
        return;
      }
      throw error;
    }
    await this.ensureUser(issue);
    await store.putCompetition(competition);
    // La mención hace que GitHub avise de verdad a quien se invita.
    const invites = submission.invited.length > 0 ? `\n\nInvitación para ${submission.invited.map((login) => `@${login}`).join(' ')}.` : '';
    this.done(issue, 'accepted', `Competición creada. Código para unirse: **\`${competition.code}\`**.${invites}`, true);
  }

  private async competitionJoin(issue: IssueData, submission: Extract<Submission, { kind: 'competition-join' }>): Promise<void> {
    const { store } = this.deps;
    const actor = actorOf(issue);
    const competition = await store.readCompetition(submission.competitionId);
    if (!competition) {
      this.done(issue, 'rejected', 'Esa competición no existe.');
      return;
    }
    if (competition.type !== 'tournament') {
      this.done(issue, 'accepted', 'En esta competición no hace falta inscribirse: basta con entregar.');
      return;
    }
    const rcv = Date.parse(issue.created_at);
    if (competition.registrationClosesAt && rcv > Date.parse(competition.registrationClosesAt)) {
      this.done(issue, 'rejected', 'La inscripción ya ha terminado.');
      return;
    }
    const registered = await store.readRegistrations(competition.id);
    if (registered.some((r) => r.user.login === actor.login)) {
      this.done(issue, 'accepted', 'Ya estabas inscrito.');
      return;
    }
    if (competition.maxParticipants !== null && registered.length >= competition.maxParticipants) {
      this.done(issue, 'rejected', 'El torneo está completo.');
      return;
    }
    await this.ensureUser(issue);
    await store.putRegistration({ schemaVersion: 1, competitionId: competition.id, user: actor, registeredAt: issue.created_at, issue: issue.number });
    this.done(issue, 'accepted', 'Inscripción confirmada.', true);
  }

  private async competitionEntry(issue: IssueData, submission: Extract<Submission, { kind: 'competition-entry' }>): Promise<void> {
    const { store, now } = this.deps;
    const actor = actorOf(issue);
    const competition = await store.readCompetition(submission.competitionId);
    if (!competition) {
      this.done(issue, 'rejected', 'Esa competición no existe.');
      return;
    }
    const entries = await store.readEntries(competition.id);
    if (entries.some((e) => e.issue === issue.number)) {
      this.done(issue, 'accepted', 'Entrega recibida. La corrección y la clasificación se calculan en el próximo despliegue.');
      return;
    }
    const registered = competition.type === 'tournament' ? (await store.readRegistrations(competition.id)).map((r) => r.user.login) : [];
    let active: string[] | undefined;
    if (competition.type === 'tournament') {
      active = activeInRound(buildBracket(competition, registered, entries, store.questions, now()), submission.round ?? 0);
    }
    const problem = entryProblem({
      competition,
      login: actor.login,
      rcvMs: Date.parse(issue.created_at),
      round: submission.round,
      durationMs: submission.durationMs,
      alreadyEntered: store.entryExists(competition.id, actor.login, submission.round),
      participantCount: new Set(entries.map((e) => e.user.login)).size,
      registered,
      activeInRound: active,
    });
    if (problem) {
      this.done(issue, 'rejected', problem);
      return;
    }
    await this.ensureUser(issue);
    await store.putEntry({
      schemaVersion: 1,
      competitionId: competition.id,
      user: actor,
      ...(submission.round !== undefined ? { round: submission.round } : {}),
      submittedAt: issue.created_at,
      durationMs: submission.durationMs,
      answers: submission.answers,
      issue: issue.number,
    });
    this.done(issue, 'accepted', 'Entrega recibida. La corrección y la clasificación se calculan en el próximo despliegue.', true);
  }

  private async dispatch(issue: IssueData, submission: Submission): Promise<void> {
    switch (submission.kind) {
      case 'connect':
        return this.connect(issue);
      case 'profile':
        return this.profile(issue, submission);
      case 'questions':
        return this.questions(issue, submission);
      case 'results':
        return this.results(issue, submission);
      case 'retire':
        return this.retire(issue, submission);
      case 'competition-create':
        return this.competitionCreate(issue, submission);
      case 'competition-join':
        return this.competitionJoin(issue, submission);
      case 'competition-entry':
        return this.competitionEntry(issue, submission);
      case 'report':
        // Es para las personas: se deja abierto y marcado, sin tocar nada.
        this.done(issue, 'report', 'Gracias. Una persona lo revisará.');
        return;
    }
  }

  async run(): Promise<{ processed: number; published: boolean }> {
    const { api, store, git, log } = this.deps;
    // Un envío con cualquiera de estas etiquetas ya se resolvió: reabrirlo no lo reprocesa.
    // Para reintentarlo, un mantenedor le quita la etiqueta.
    const excluded: string[] = Object.values(LABELS);
    const pending = (await api.listOpenIssues())
      .filter((issue) => !issue.is_pull_request && isSubmissionTitle(issue.title) && !issue.labels.some((label) => excluded.includes(label)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, POLICY.maxSubmissionsPerRun);

    if (pending.length === 0) {
      log('No hay envíos pendientes.');
      return { processed: 0, published: false };
    }
    log(`${pending.length} envíos pendientes.`);
    await git.syncData();
    await store.load();

    // Las preguntas van primero: cada una usa su rama, y necesitan la copia de trabajo limpia.
    const decoded: { issue: IssueData; submission: Submission }[] = [];
    for (const issue of pending) {
      if (issue.user.type !== 'User') {
        this.done(issue, 'rejected', 'Sólo se admiten envíos de cuentas de usuario.');
        continue;
      }
      if (store.banned.has(normalizeLogin(issue.user.login))) {
        this.done(issue, 'rejected', 'Esta cuenta no puede publicar.');
        continue;
      }
      if (this.loginConflict(issue)) {
        this.done(issue, 'rejected', 'Este nombre de usuario ya perteneció a otra cuenta de GitHub. Un mantenedor debe revisarlo.');
        continue;
      }
      try {
        const parsed = Submission.safeParse(await decodeIssueBody(issue.body));
        if (!parsed.success) {
          const detail = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          this.done(issue, 'rejected', `El envío no tiene un formato válido (${detail}).`);
          continue;
        }
        decoded.push({ issue, submission: parsed.data });
      } catch (error) {
        if (!(error instanceof EnvelopeError)) throw error;
        this.done(issue, 'rejected', `${error.message}. ¿Se editó el texto del issue?`);
      }
    }
    decoded.sort((a, b) => Number(b.submission.kind === 'questions') - Number(a.submission.kind === 'questions'));

    const crashed: IssueData[] = [];
    let deferred = 0;
    for (const { issue, submission } of decoded) {
      try {
        await this.dispatch(issue, submission);
        // Cada envío, en su commit. Si otro falla después, sólo se deshace el suyo.
        if (await git.commitAll(`Envío #${issue.number}`)) this.pendingPush = true;
        // Las preguntas trabajan en ramas y vuelven a `origin/data`: lo pendiente debe estar ya
        // subido o se perdería al volver.
        if (submission.kind === 'questions') await this.pushPending();
      } catch (error) {
        log(`Error procesando #${issue.number}: ${(error as Error).stack ?? String(error)}`);
        // Un fallo pasajero de GitHub no dice nada del envío: queda abierto y sin marcar, y lo
        // retoma el siguiente barrido. Uno inesperado se marca, para no repetirlo eternamente.
        if (isTransientError(error)) deferred += 1;
        else crashed.push(issue);
        if (submission.kind === 'questions') await git.syncData();
        else await git.discardChanges();
        await store.load();
      }
    }

    await this.pushPending();
    // Sólo ahora, con los datos a salvo, se avisa a cada usuario. Un aviso que falla no impide
    // los demás: el envío sigue abierto y el reproceso dirá lo mismo.
    for (const outcome of this.outcomes) {
      try {
        const label = { accepted: LABELS.accepted, rejected: LABELS.rejected, review: LABELS.review, report: LABELS.report }[outcome.status];
        await api.comment(outcome.issue.number, outcome.message);
        await api.addLabels(outcome.issue.number, [label]);
        if (outcome.status !== 'report') await api.closeIssue(outcome.issue.number, outcome.status === 'rejected' ? 'not_planned' : 'completed');
      } catch (error) {
        log(`No se ha podido avisar en #${outcome.issue.number}: ${(error as Error).message}`);
      }
    }
    for (const issue of crashed) {
      try {
        await api.comment(issue.number, 'Ha habido un error interno al procesar este envío. Un mantenedor lo revisará.');
        await api.addLabels(issue.number, [LABELS.error]);
      } catch (error) {
        log(`No se ha podido avisar en #${issue.number}: ${(error as Error).message}`);
      }
    }
    if (deferred > 0) log(`${deferred} envíos aplazados por un fallo pasajero: se reintentan en el siguiente barrido.`);
    if (this.dataChanged) {
      // Lo hecho con GITHUB_TOKEN no dispara workflows: el despliegue hay que pedirlo. Si falla,
      // los datos ya están a salvo y los publicará el siguiente despliegue.
      await api.dispatchWorkflow('deploy.yml', this.deps.defaultBranch).catch((error: unknown) => log(`No se ha podido lanzar el despliegue: ${(error as Error).message}`));
    }
    return { processed: this.outcomes.length + crashed.length, published: this.dataChanged };
  }
}

export function runIntake(deps: IntakeDeps): Promise<{ processed: number; published: boolean }> {
  return new Intake(deps).run();
}
