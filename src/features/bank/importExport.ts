import { z } from 'zod';
import { IsoDate } from '@core/schema/common';
import { migrateDocument } from '@core/schema/migrations';
import { Question, QuestionImage, type Question as QuestionDoc } from '@core/schema/question';
import { SubjectDoc } from '@core/schema/taxonomy';
import { duplicateIndexEntry, findDuplicates } from '@core/questions/normalize';
import { alignSubject, buildTaxonomyIndex, mergeSubject } from '@core/taxonomy/merge';
import { base64ToBytes, bytesToBase64, sha256Hex } from '@core/util/encoding';
import { toIso } from '@core/util/time';
import { config } from '@/infra/config';
import { db } from '@/infra/db/db';
import type { LocalImageRow } from '@/infra/db/types';
import { loadSubjects } from '@/features/taxonomy/taxonomyRepo';
import { loadQuestions, toQuestion, type ViewQuestion } from './questionsRepo';

const FORMAT = 'questionbank-export';

const ExportImage = z.strictObject({ ...QuestionImage.shape, base64: z.string() });

const ExportFile = z.strictObject({
  format: z.literal(FORMAT),
  version: z.literal(1),
  exportedAt: IsoDate,
  subjects: z.array(z.unknown()),
  questions: z.array(z.unknown()),
  images: z.array(ExportImage),
});

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function imageBytes(image: QuestionImage): Promise<Uint8Array | null> {
  const local = await db.localImages.get(image.hash);
  if (local) return new Uint8Array(await local.blob.arrayBuffer());
  try {
    const response = await fetch(config.communityUrl(`images/${image.hash}.${image.ext}`));
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Fichero autónomo: incluye el temario y las imágenes, y se puede importar en cualquier dispositivo. */
export async function buildExport(questions: readonly ViewQuestion[]): Promise<Blob> {
  const documents = questions.map(toQuestion);
  const usedSubjects = new Set(documents.map((q) => q.subjectId));
  const subjects = (await loadSubjects()).filter((s) => usedSubjects.has(s.id));
  const seen = new Set<string>();
  const images: z.infer<typeof ExportImage>[] = [];
  for (const image of documents.flatMap((q) => q.images)) {
    if (seen.has(image.hash)) continue;
    seen.add(image.hash);
    const bytes = await imageBytes(image);
    if (bytes) images.push({ ...image, base64: bytesToBase64(bytes) });
  }
  const file = { format: FORMAT, version: 1, exportedAt: toIso(Date.now()), subjects, questions: documents, images };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export interface ImportReport {
  imported: number;
  existing: number;
  duplicates: number;
  invalid: number;
  images: number;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** Lo importado queda como local y sin autor: al publicarlo, el autor será quien lo publique. */
export async function importFile(file: File): Promise<ImportReport> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('El fichero es demasiado grande.');
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new ImportError('El fichero no es JSON válido.');
  }
  const parsed = ExportFile.safeParse(raw);
  if (!parsed.success) throw new ImportError('No es un fichero exportado desde esta app.');

  const report: ImportReport = { imported: 0, existing: 0, duplicates: 0, invalid: 0, images: 0 };
  const now = toIso(Date.now());

  const existingSubjects = await loadSubjects();
  const idMap = new Map<string, string>();
  const subjects: SubjectDoc[] = [];
  for (const rawSubject of parsed.data.subjects) {
    const subject = SubjectDoc.safeParse(migrateDocument(rawSubject));
    if (!subject.success) continue;
    const aligned = alignSubject(existingSubjects, subject.data);
    for (const [from, to] of aligned.idMap) idMap.set(from, to);
    subjects.push(aligned.doc);
  }

  const known = await loadQuestions();
  const knownIds = new Set(known.map((q) => q.id));
  const entries = known.map(duplicateIndexEntry);
  const accepted: QuestionDoc[] = [];
  for (const rawQuestion of parsed.data.questions) {
    let doc: unknown;
    try {
      doc = migrateDocument(rawQuestion);
    } catch {
      report.invalid += 1;
      continue;
    }
    const question = Question.safeParse(doc);
    if (!question.success) {
      report.invalid += 1;
      continue;
    }
    if (knownIds.has(question.data.id)) {
      report.existing += 1;
      continue;
    }
    const remapped: QuestionDoc = {
      ...question.data,
      rev: 1,
      author: null,
      subjectId: idMap.get(question.data.subjectId) ?? question.data.subjectId,
      topicIds: question.data.topicIds.map((id) => idMap.get(id) ?? id),
    };
    if (findDuplicates(remapped, entries).some((m) => m.exact)) {
      report.duplicates += 1;
      continue;
    }
    entries.push(duplicateIndexEntry(remapped));
    knownIds.add(remapped.id);
    accepted.push(remapped);
  }

  const taxonomyIndex = buildTaxonomyIndex([...existingSubjects, ...subjects]);
  const valid = accepted.filter((q) => {
    const ok = q.topicIds.every((id) => taxonomyIndex.topics.has(id));
    if (!ok) report.invalid += 1;
    return ok;
  });

  // Las imágenes se comprueban contra su hash: el nombre no se da por bueno sin más.
  const images: LocalImageRow[] = [];
  for (const image of parsed.data.images) {
    const bytes = base64ToBytes(image.base64);
    if ((await sha256Hex(bytes)) !== image.hash) continue;
    const { base64: _base64, ...meta } = image;
    const type = image.ext === 'jpg' ? 'image/jpeg' : `image/${image.ext}`;
    images.push({ ...meta, blob: new Blob([bytes as BlobPart], { type }), createdAt: Date.now() });
  }

  await db.transaction('rw', [db.lQuestions, db.lSubjects, db.localImages, db.cSubjects], async () => {
    for (const subject of subjects) {
      const community = await db.cSubjects.get(subject.id);
      const row = await db.lSubjects.get(subject.id);
      const base = row ?? community ?? null;
      const doc = base ? mergeSubject(base, subject, now).doc : subject;
      await db.lSubjects.put({ ...doc, local: { baseRev: community?.rev ?? null } });
    }
    await db.lQuestions.bulkPut(valid.map((q) => ({ ...q, local: { baseRev: null, syncState: 'local' as const, outboxId: null, note: null } })));
    await db.localImages.bulkPut(images);
  });

  report.imported = valid.length;
  report.images = images.length;
  return report;
}
