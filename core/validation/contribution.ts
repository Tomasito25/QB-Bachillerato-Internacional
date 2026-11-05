import { duplicateIndexEntry, findDuplicates, type DuplicateIndexEntry } from '../questions/normalize.ts';
import { scanImageReferences } from '../questions/refs.ts';
import { FutureSchemaError, migrateDocument } from '../schema/migrations.ts';
import { LIMITS, Question } from '../schema/question.ts';
import { SubjectDoc } from '../schema/taxonomy.ts';
import { alignSubject, buildTaxonomyIndex, mergeSubject } from '../taxonomy/merge.ts';
import { sha256Hex } from '../util/encoding.ts';
import { sniffImage } from './images.ts';
import { POLICY } from './policy.ts';

/**
 * Reglas de aceptación de una aportación: la frontera de seguridad del sistema.
 *
 * Se ejecutan en Actions, con el mismo código para las dos vías de publicación. Todo lo que
 * llega es entrada hostil hasta que pasa por aquí. No se ejecuta nada de lo recibido: sólo se
 * lee como datos.
 */

export interface Actor {
  login: string;
  id: number;
  /** Tiene permiso de escritura en el repositorio. */
  isMaintainer: boolean;
}

/** Lo que el validador necesita saber del estado actual de los datos. */
export interface DataView {
  question(id: string): Question | null;
  subject(id: string): SubjectDoc | null;
  subjects(): SubjectDoc[];
  duplicateEntries(): DuplicateIndexEntry[];
  imageExists(hash: string, ext: string): boolean;
  isRetired(id: string): boolean;
}

export interface ProposedImage {
  hash: string;
  ext: 'webp' | 'png' | 'jpg';
  bytes: Uint8Array;
}

export interface ContributionInput {
  actor: Actor;
  questions: readonly unknown[];
  subjects: readonly unknown[];
  images: readonly ProposedImage[];
  now: number;
  /**
   * `issue`: Actions escribe los ficheros, así que fija autor y fechas él mismo.
   * `pr`: los ficheros los escribió el usuario; se comprueban y, si no cuadran, se rechazan.
   */
  mode: 'issue' | 'pr';
}

export type FindingLevel =
  /** Impide aceptar. */
  | 'error'
  /** Se acepta sólo tras revisión humana. */
  | 'review';

export type FindingCode =
  | 'schema'
  | 'future-schema'
  | 'rev-conflict'
  | 'retired'
  | 'author-mismatch'
  | 'foreign-edit'
  | 'bad-dates'
  | 'taxonomy-missing'
  | 'taxonomy-name'
  | 'taxonomy-edit'
  | 'taxonomy-too-big'
  | 'taxonomy-removal'
  | 'external-image'
  | 'raw-html'
  | 'image-missing'
  | 'image-invalid'
  | 'duplicate'
  | 'near-duplicate';

export interface Finding {
  level: FindingLevel;
  code: FindingCode;
  message: string;
  ref?: string;
}

export interface ContributionResult {
  findings: Finding[];
  questions: Question[];
  newQuestionIds: string[];
  subjects: SubjectDoc[];
  images: ProposedImage[];
}

export const isAccepted = (result: ContributionResult): boolean => !result.findings.some((f) => f.level === 'error');
export const needsReview = (result: ContributionResult): boolean => result.findings.some((f) => f.level === 'review');

function parseDocument<T>(raw: unknown, schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, label: string, findings: Finding[]): T | null {
  let migrated: unknown;
  try {
    migrated = migrateDocument(raw);
  } catch (error) {
    if (error instanceof FutureSchemaError) {
      findings.push({ level: 'error', code: 'future-schema', message: `${label}: se creó con una versión más nueva de la app. Actualiza el despliegue.` });
      return null;
    }
    throw error;
  }
  const parsed = schema.safeParse(migrated);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'documento'}: ${i.message}`);
    findings.push({ level: 'error', code: 'schema', message: `${label} no es válido: ${issues.join('; ')}` });
    return null;
  }
  return parsed.data;
}

export async function validateContribution(input: ContributionInput, view: DataView): Promise<ContributionResult> {
  const { actor, mode, now } = input;
  const findings: Finding[] = [];
  const nowIso = new Date(now).toISOString();
  const authoredBy = { login: actor.login, id: actor.id };

  // Temario
  const idMap = new Map<string, string>();
  const subjects: SubjectDoc[] = [];
  let newNodes = 0;
  for (const raw of input.subjects) {
    const proposal = parseDocument<SubjectDoc>(raw, SubjectDoc, 'Una asignatura', findings);
    if (!proposal) continue;
    const aligned = alignSubject(view.subjects(), proposal);
    for (const [from, to] of aligned.idMap) idMap.set(from, to);
    const existing = view.subject(aligned.doc.id);
    const merged = mergeSubject(existing, aligned.doc, nowIso);
    for (const error of merged.errors) findings.push({ level: 'error', code: 'taxonomy-name', message: error, ref: proposal.id });
    newNodes += merged.changes.added.length;
    const isOwner = existing?.createdBy?.login === actor.login || actor.isMaintainer;
    if (existing && !isOwner && merged.changes.renamed.length + merged.changes.reordered.length > 0) {
      findings.push({ level: 'review', code: 'taxonomy-edit', message: `Cambia el nombre o el orden de «${existing.name}», que creó otra persona.`, ref: existing.id });
    }
    if (mode === 'pr' && existing) {
      // Un PR trae el fichero entero: si le falta algo que existía, estaría borrándolo.
      const proposed = new Set(aligned.doc.units.flatMap((u) => [u.id, ...u.topics.map((t) => t.id)]));
      const removed = existing.units.flatMap((u) => [u.id, ...u.topics.map((t) => t.id)]).filter((id) => !proposed.has(id));
      if (removed.length > 0) findings.push({ level: 'error', code: 'taxonomy-removal', message: `No se pueden borrar nodos de «${existing.name}» desde una aportación.`, ref: existing.id });
    }
    const doc = existing ? merged.doc : { ...merged.doc, createdBy: authoredBy, createdAt: mode === 'issue' ? nowIso : merged.doc.createdAt };
    if (mode === 'pr' && !existing && proposal.createdBy?.login !== actor.login) {
      findings.push({ level: 'error', code: 'author-mismatch', message: `«${proposal.name}» declara otro creador.`, ref: proposal.id });
    }
    subjects.push(doc);
  }
  if (newNodes > POLICY.maxNewTaxonomyNodes) {
    findings.push({ level: 'error', code: 'taxonomy-too-big', message: `Añade ${newNodes} elementos de temario de una vez; el máximo es ${POLICY.maxNewTaxonomyNodes}.` });
  }
  const proposedIds = new Set(subjects.map((s) => s.id));
  const index = buildTaxonomyIndex([...view.subjects().filter((s) => !proposedIds.has(s.id)), ...subjects]);

  // Imágenes
  const validImages = new Map<string, ProposedImage>();
  for (const image of input.images) {
    const sniffed = sniffImage(image.bytes);
    if (sniffed === null || sniffed !== image.ext) {
      findings.push({ level: 'error', code: 'image-invalid', message: `Una imagen no es el formato que dice ser (.${image.ext}).`, ref: image.hash });
      continue;
    }
    if (image.bytes.length > LIMITS.imageBytes) {
      findings.push({ level: 'error', code: 'image-invalid', message: `Una imagen supera los ${Math.round(LIMITS.imageBytes / 1024)} KB.`, ref: image.hash });
      continue;
    }
    if ((await sha256Hex(image.bytes)) !== image.hash) {
      findings.push({ level: 'error', code: 'image-invalid', message: 'El contenido de una imagen no coincide con su hash.', ref: image.hash });
      continue;
    }
    validImages.set(image.hash, image);
  }

  // Preguntas
  const known = view.duplicateEntries();
  const questions: Question[] = [];
  const newQuestionIds: string[] = [];
  const usedImages = new Set<string>();
  for (const raw of input.questions) {
    const parsed = parseDocument<Question>(raw, Question, 'Una pregunta', findings);
    if (!parsed) continue;
    const label = `«${parsed.statement.slice(0, 50)}${parsed.statement.length > 50 ? '…' : ''}»`;
    const before = findings.length;

    let question: Question = {
      ...parsed,
      subjectId: idMap.get(parsed.subjectId) ?? parsed.subjectId,
      topicIds: parsed.topicIds.map((id) => idMap.get(id) ?? id),
    };

    if (view.isRetired(question.id)) {
      findings.push({ level: 'error', code: 'retired', message: `${label} se retiró y no se puede volver a publicar.`, ref: question.id });
    }

    const existing = view.question(question.id);
    if (existing) {
      if (question.rev !== existing.rev + 1) {
        findings.push({ level: 'error', code: 'rev-conflict', message: `${label} se ha modificado mientras la editabas (base ${question.rev - 1}, actual ${existing.rev}).`, ref: question.id });
      }
      const isOwner = existing.author?.login === actor.login;
      if (!isOwner && !actor.isMaintainer) {
        findings.push({ level: 'review', code: 'foreign-edit', message: `${label} es de @${existing.author?.login ?? 'otra persona'}: la edición propuesta requiere revisión.`, ref: question.id });
      }
    } else if (question.rev !== 1) {
      findings.push({ level: 'error', code: 'rev-conflict', message: `${label} es nueva y debería tener revisión 1.`, ref: question.id });
    }

    if (mode === 'pr') {
      const expected = existing ? existing.author?.login : actor.login;
      if (question.author?.login !== expected) {
        findings.push({ level: 'error', code: 'author-mismatch', message: `${label} declara un autor que no corresponde.`, ref: question.id });
      }
      if (existing && question.createdAt !== existing.createdAt) {
        findings.push({ level: 'error', code: 'bad-dates', message: `${label} cambia su fecha de creación.`, ref: question.id });
      }
      if (Date.parse(question.createdAt) > now + POLICY.clockSkewMs || Date.parse(question.updatedAt) > now + POLICY.clockSkewMs) {
        findings.push({ level: 'error', code: 'bad-dates', message: `${label} tiene una fecha futura.`, ref: question.id });
      }
    } else {
      // Autor y fechas no los decide el cliente: salen del issue y de lo que ya existe.
      question = {
        ...question,
        author: existing?.author ?? authoredBy,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
    }

    for (const topicId of question.topicIds) {
      if (!index.topics.has(topicId)) {
        findings.push({ level: 'error', code: 'taxonomy-missing', message: `${label} usa un tema que no existe.`, ref: topicId });
      }
    }
    const subjectsOfTopics = question.topicIds.map((id) => index.topics.get(id)?.subjectId);
    if (!index.subjects.has(question.subjectId) || !subjectsOfTopics.includes(question.subjectId)) {
      findings.push({ level: 'error', code: 'taxonomy-missing', message: `${label} no pertenece a la asignatura que declara.`, ref: question.subjectId });
    }

    const references = scanImageReferences(question);
    if (references.external.length > 0) {
      findings.push({ level: 'error', code: 'external-image', message: `${label} usa imágenes de otras webs.`, ref: question.id });
    }
    if (references.rawHtml) {
      findings.push({ level: 'error', code: 'raw-html', message: `${label} contiene HTML no permitido.`, ref: question.id });
    }
    const attached = new Set(question.images.map((i) => i.hash));
    for (const hash of references.hashes) {
      if (!attached.has(hash)) findings.push({ level: 'error', code: 'image-missing', message: `${label} usa una imagen que no adjunta.`, ref: hash });
    }
    for (const image of question.images) {
      usedImages.add(image.hash);
      if (!validImages.has(image.hash) && !view.imageExists(image.hash, image.ext)) {
        findings.push({ level: 'error', code: 'image-missing', message: `${label} adjunta una imagen que no se ha recibido.`, ref: image.hash });
      }
    }

    const duplicates = findDuplicates(question, known);
    const exact = duplicates.find((d) => d.exact);
    if (exact) {
      findings.push({ level: 'error', code: 'duplicate', message: `${label} ya existe en el banco.`, ref: exact.id });
    } else if (duplicates[0]) {
      findings.push({ level: 'review', code: 'near-duplicate', message: `${label} se parece un ${Math.round(duplicates[0].similarity * 100)} % a otra pregunta.`, ref: duplicates[0].id });
    }

    if (findings.slice(before).every((f) => f.level !== 'error')) {
      questions.push(question);
      if (!existing) newQuestionIds.push(question.id);
      // Dos copias dentro del mismo envío también son duplicados.
      known.push(duplicateIndexEntry(question));
    }
  }

  const images = [...validImages.values()].filter((image) => usedImages.has(image.hash));
  return { findings, questions, newQuestionIds, subjects, images };
}
