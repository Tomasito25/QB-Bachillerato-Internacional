import { z } from 'zod';
import { bytesToBase64, base64ToBytes } from '@core/util/encoding';
import { toIso } from '@core/util/time';
import { db, kvGet, kvSet } from '@/infra/db/db';
import type { AttemptRow, DraftRow, LocalImageRow, LocalQuestionRow, LocalSubjectRow, ProgressRow, SessionRow } from '@/infra/db/types';

/**
 * Copia de seguridad de lo que es del usuario. No incluye el token ni la réplica comunitaria,
 * que se vuelve a bajar. También es la forma de llevar el progreso a otro dispositivo.
 */

const BackupFile = z.object({
  format: z.literal('questionbank-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  lQuestions: z.array(z.unknown()),
  lSubjects: z.array(z.unknown()),
  drafts: z.array(z.unknown()),
  attempts: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  progress: z.array(z.unknown()),
  images: z.array(z.object({ hash: z.string(), base64: z.string(), type: z.string() }).loose()),
  preferences: z.unknown(),
});

export async function buildBackup(): Promise<Blob> {
  const images = [];
  for (const image of await db.localImages.toArray()) {
    const { blob, ...meta } = image;
    images.push({ ...meta, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), type: blob.type });
  }
  const file = {
    format: 'questionbank-backup',
    version: 1,
    exportedAt: toIso(Date.now()),
    lQuestions: await db.lQuestions.toArray(),
    lSubjects: await db.lSubjects.toArray(),
    drafts: await db.drafts.toArray(),
    attempts: await db.attempts.toArray(),
    sessions: await db.sessions.toArray(),
    progress: await db.progress.toArray(),
    images,
    preferences: await kvGet('preferences'),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface RestoreReport {
  attempts: number;
  questions: number;
  progress: number;
}

/**
 * Combina, no sustituye: los intentos se suman por id; en el progreso gana lo más reciente; lo
 * local se conserva. Así se puede pasar de un dispositivo a otro y volver sin perder nada.
 */
export async function restoreBackup(file: File): Promise<RestoreReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new BackupError('El fichero no es JSON válido.');
  }
  const parsed = BackupFile.safeParse(raw);
  if (!parsed.success) throw new BackupError('No es una copia de seguridad de QuestionBank.');
  const data = parsed.data;

  const incomingProgress = data.progress as ProgressRow[];
  const report: RestoreReport = { attempts: 0, questions: 0, progress: 0 };

  await db.transaction('rw', [db.lQuestions, db.lSubjects, db.drafts, db.attempts, db.sessions, db.progress, db.localImages], async () => {
    for (const attempt of data.attempts as AttemptRow[]) {
      if (await db.attempts.get(attempt.id)) continue;
      await db.attempts.put(attempt);
      report.attempts += 1;
    }
    for (const row of incomingProgress) {
      const current = await db.progress.get(row.questionId);
      if (!current || row.lastAt > current.lastAt) {
        await db.progress.put(current ? { ...row, favorite: (current.favorite || row.favorite) as 0 | 1, hard: (current.hard || row.hard) as 0 | 1 } : row);
        report.progress += 1;
      }
    }
    for (const question of data.lQuestions as LocalQuestionRow[]) {
      const current = await db.lQuestions.get(question.id);
      if (!current || question.updatedAt > current.updatedAt) {
        await db.lQuestions.put(question);
        report.questions += 1;
      }
    }
    for (const subject of data.lSubjects as LocalSubjectRow[]) {
      const current = await db.lSubjects.get(subject.id);
      if (!current || subject.updatedAt > current.updatedAt) await db.lSubjects.put(subject);
    }
    for (const draft of data.drafts as DraftRow[]) {
      const current = await db.drafts.get(draft.id);
      if (!current || draft.updatedAt > current.updatedAt) await db.drafts.put(draft);
    }
    for (const session of data.sessions as SessionRow[]) {
      if (!(await db.sessions.get(session.id))) await db.sessions.put(session);
    }
    for (const image of data.images) {
      if (await db.localImages.get(image.hash)) continue;
      const { base64, type, ...meta } = image;
      await db.localImages.put({ ...(meta as unknown as Omit<LocalImageRow, 'blob'>), blob: new Blob([base64ToBytes(base64) as BlobPart], { type }) });
    }
  });
  if (data.preferences && !(await kvGet('preferences'))) await kvSet('preferences', data.preferences);
  return report;
}

/** Borra lo que hay en este dispositivo. La réplica comunitaria se volverá a bajar. */
export async function wipeLocalData(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}
