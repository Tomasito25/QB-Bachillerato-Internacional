import { useLiveQuery } from 'dexie-react-hooks';
import type { Submission } from '@core/schema/submission';
import { chooseIssueTransport, encodeSubmission, type IssueTransport } from '@core/submissions/envelope';
import { identity } from '@/features/account/identity';
import { config } from '@/infra/config';
import { getToken } from '@/infra/crypto/tokenVault';
import { db } from '@/infra/db/db';
import type { OutboxRow, OutboxStatus } from '@/infra/db/types';
import { createIssue, listIssueComments, listRecentIssues } from '@/infra/github/client';
import { logSync } from './log';

/**
 * Cola de envíos. Publicar nunca falla por falta de conexión: se guarda aquí y se envía cuando
 * se pueda. Con token se envía sola; sin token necesita un clic del usuario en GitHub.
 */

export const LABEL_TO_STATUS: Record<string, OutboxStatus> = {
  'qb:accepted': 'accepted',
  'qb:rejected': 'rejected',
  'qb:review': 'review',
  'qb:report': 'accepted',
  'qb:error': 'failed',
};

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  queued: 'En cola',
  'awaiting-user': 'Falta confirmar en GitHub',
  sent: 'Enviado; procesándose',
  accepted: 'Aceptado',
  review: 'En revisión',
  rejected: 'Rechazado',
  failed: 'Error al procesarlo',
};

export function useOutbox(): OutboxRow[] | undefined {
  return useLiveQuery(() => db.outbox.orderBy('createdAt').reverse().toArray(), []);
}

/** Los que todavía no están resueltos. */
export function isOpen(row: OutboxRow): boolean {
  return row.status === 'queued' || row.status === 'awaiting-user' || row.status === 'sent';
}

/**
 * Los que aún pueden cambiar en GitHub. Un error interno también: un mantenedor puede reintentarlo,
 * y sin mirarlo se quedaría así para siempre aunque el envío acabe aceptado.
 */
export function awaitsGitHub(row: OutboxRow): boolean {
  return row.status === 'awaiting-user' || row.status === 'sent' || row.status === 'review' || row.status === 'failed';
}

export async function enqueue(submission: Submission, summary: string, related: OutboxRow['related'], channel: OutboxRow['channel'] = 'issue'): Promise<OutboxRow> {
  const encoded = await encodeSubmission(submission, summary);
  const row: OutboxRow = {
    id: crypto.randomUUID(),
    kind: submission.kind,
    nonce: submission.nonce,
    summary,
    payload: submission,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    issueTitle: encoded.title,
    issueBody: encoded.body,
    channel,
    issueNumber: null,
    url: null,
    error: null,
    attempts: 0,
    related,
  };
  await db.outbox.put(row);
  return row;
}

/** Cómo enviar a mano este elemento: por la URL o copiando y pegando. */
export function manualTransport(row: OutboxRow): IssueTransport {
  return chooseIssueTransport(config.repo, { title: row.issueTitle, body: row.issueBody });
}

export async function markAwaitingUser(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'awaiting-user', updatedAt: Date.now(), error: null });
}

async function applyStatus(row: OutboxRow, status: OutboxStatus, patch: Partial<OutboxRow> = {}): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.outbox, db.lQuestions, db.attempts, async () => {
    await db.outbox.update(row.id, { status, updatedAt: now, ...patch });
    if (status === 'accepted' && row.related.attempts?.length) {
      // Sólo ahora dejan de estar «sin publicar»: nunca antes de la confirmación.
      await db.attempts.where('id').anyOf(row.related.attempts).modify({ published: 1 });
    }
    if (row.related.questions?.length) {
      const note = patch.error ?? null;
      // Un error interno no es un rechazo: nadie ha dicho nada malo de la pregunta.
      const syncState = status === 'rejected' ? 'rejected' : status === 'queued' ? 'queued' : 'submitted';
      await db.lQuestions.where('id').anyOf(row.related.questions).modify((q) => {
        q.local = { ...q.local, syncState, note, outboxId: row.id };
      });
    }
  });
}

/** Envía con token lo que esté en cola. Sin token no hace nada: hace falta el usuario. */
export async function flushWithToken(): Promise<number> {
  const token = await getToken();
  if (!token || !config.repo || !navigator.onLine) return 0;
  const queued = await db.outbox.where('status').equals('queued').toArray();
  let sent = 0;
  for (const row of queued) {
    if (row.channel === 'pull') continue;
    try {
      const issue = await createIssue(token, row.issueTitle, row.issueBody);
      await applyStatus(row, 'sent', { issueNumber: issue.number, url: issue.html_url, attempts: row.attempts + 1 });
      sent += 1;
    } catch (error) {
      await db.outbox.update(row.id, { attempts: row.attempts + 1, error: (error as Error).message, updatedAt: Date.now() });
      await logSync('error', `No se ha podido enviar «${row.summary}»: ${(error as Error).message}`);
      break;
    }
  }
  return sent;
}

export async function markSent(row: OutboxRow, patch: Partial<OutboxRow>): Promise<void> {
  await applyStatus(row, 'sent', patch);
}

export async function discardItem(row: OutboxRow): Promise<void> {
  await db.transaction('rw', db.outbox, db.lQuestions, async () => {
    await db.outbox.delete(row.id);
    if (row.related.questions?.length) {
      await db.lQuestions.where('id').anyOf(row.related.questions).modify((q) => {
        q.local = { ...q.local, syncState: 'local', outboxId: null, note: null };
      });
    }
  });
}

/**
 * Pregunta a GitHub por el estado de los envíos. Una sola petición cubre todos, y sólo se hace
 * si hay algo pendiente. Va sin token si no lo hay, y por eso no puede hacerse a menudo.
 */
export async function refreshStatuses(): Promise<number> {
  if (!config.repo) return 0;
  const pending = (await db.outbox.toArray()).filter(awaitsGitHub);
  if (pending.length === 0) return 0;
  const token = await getToken();
  const issues = await listRecentIssues({ token, creator: identity.get()?.login });
  let updated = 0;
  /** Un envío repetido tras un 5xx deja dos issues con el mismo nonce: manda el que entró. */
  const rank = (labels: readonly { name: string }[]) => (labels.some((l) => l.name === 'qb:accepted') ? 2 : labels.some((l) => l.name === 'qb:review') ? 1 : 0);
  for (const row of pending) {
    const issue = issues.filter((candidate) => candidate.title.endsWith(row.nonce)).sort((a, b) => rank(b.labels) - rank(a.labels))[0];
    if (!issue) continue;
    const label = issue.labels.map((l) => l.name).find((name) => name in LABEL_TO_STATUS);
    const status: OutboxStatus = label ? (LABEL_TO_STATUS[label] as OutboxStatus) : 'sent';
    if (status === row.status && issue.number === row.issueNumber) continue;
    let error: string | null = null;
    if (status === 'rejected' || status === 'failed') {
      // El motivo está en el último comentario del bot. Sólo se pide cuando hace falta.
      const comments = await listIssueComments(issue.number, token).catch(() => []);
      error = comments.filter((c) => c.user.type === 'Bot').at(-1)?.body ?? 'Rechazado. Mira el issue en GitHub.';
    }
    await applyStatus(row, status, { issueNumber: issue.number, url: issue.html_url, error });
    await logSync(status === 'rejected' ? 'warn' : 'info', `#${issue.number}: ${OUTBOX_STATUS_LABELS[status]} (${row.summary}).`);
    updated += 1;
  }
  return updated;
}
