import { questionFingerprint } from '@core/questions/normalize';
import { alignSubject, mergeSubject } from '@core/taxonomy/merge';
import { toIso } from '@core/util/time';
import { toQuestion } from '@/features/bank/questionsRepo';
import { db } from '@/infra/db/db';
import type { LocalMeta, LocalQuestionRow } from '@/infra/db/types';

/**
 * Qué hacer con una pregunta local cuando llega una versión comunitaria con el mismo id.
 *
 * Es la parte delicada: nunca se puede perder trabajo del usuario en silencio. Ante la duda, se
 * marca como conflicto y decide la persona.
 */
export type LocalDecision =
  /** La comunitaria ya contiene esta edición: la copia local sobra. */
  | 'promoted'
  /** Las dos han cambiado por su cuenta. */
  | 'conflict'
  /** Nada que hacer. */
  | 'keep';

export function classifyLocal(local: { rev: number; local: LocalMeta }, community: { rev: number } | undefined, sameContent: boolean): LocalDecision {
  if (!community) return 'keep';
  const { syncState, baseRev } = local.local;
  if (syncState === 'conflict') return sameContent ? 'promoted' : 'keep';
  if (sameContent) return 'promoted';
  if (syncState === 'submitted' || syncState === 'queued') {
    // Lo enviado aún no ha llegado, y lo que hay es igual o anterior a su base: seguir esperando.
    if (community.rev < local.rev) return 'keep';
    return 'conflict';
  }
  // Sin base: es nueva aquí, pero ya existe en la comunidad con otro contenido.
  if (baseRev === null) return 'conflict';
  return community.rev > baseRev ? 'conflict' : 'keep';
}

export interface ReconcileReport {
  promoted: number;
  conflicts: number;
  overlaysRemoved: number;
}

/**
 * Si creaste «Fisica» y resulta que la comunidad ya tiene «Física», son la misma asignatura:
 * tu capa local y tus preguntas pasan a usar los identificadores comunitarios. Sin esto se
 * verían dos asignaturas casi iguales hasta el momento de publicar.
 */
export async function alignLocalTaxonomy(): Promise<number> {
  const community = await db.cSubjects.toArray();
  let aligned = 0;
  for (const overlay of await db.lSubjects.toArray()) {
    const { local: _local, ...doc } = overlay;
    const result = alignSubject(community, doc);
    if (result.idMap.size === 0) continue;
    const base = community.find((s) => s.id === result.doc.id);
    const merged = base ? mergeSubject(base, result.doc, toIso(Date.now())).doc : result.doc;
    const map = (id: string) => result.idMap.get(id) ?? id;
    await db.transaction('rw', db.lSubjects, db.lQuestions, db.attempts, async () => {
      await db.lSubjects.delete(overlay.id);
      await db.lSubjects.put({ ...merged, local: { baseRev: base?.rev ?? null } });
      await db.lQuestions.toCollection().modify((q) => {
        q.subjectId = map(q.subjectId);
        q.topicIds = q.topicIds.map(map);
      });
      await db.attempts.where('subjectId').anyOf([...result.idMap.keys()]).modify((a) => {
        a.subjectId = map(a.subjectId);
      });
    });
    aligned += 1;
  }
  return aligned;
}

/** Tras cada descarga: ajusta lo local a lo que acaba de llegar. */
export async function reconcileLocal(): Promise<ReconcileReport> {
  const report: ReconcileReport = { promoted: 0, conflicts: 0, overlaysRemoved: 0 };
  await alignLocalTaxonomy();
  const rows = await db.lQuestions.toArray();
  const communityRows = await db.cQuestions.bulkGet(rows.map((row) => row.id));
  for (const [index, row] of rows.entries()) {
    const community = communityRows[index];
    if (!community) continue;
    const [mine, theirs] = await Promise.all([questionFingerprint(toQuestion(row)), questionFingerprint(toQuestion(community))]);
    const decision = classifyLocal(row, community, mine === theirs);
    if (decision === 'promoted') {
      await db.lQuestions.delete(row.id);
      report.promoted += 1;
    } else if (decision === 'conflict') {
      if (row.local.syncState !== 'conflict') {
        await db.lQuestions.put({ ...row, local: { ...row.local, syncState: 'conflict', note: `La versión comunitaria es ahora la ${community.rev}.` } });
      }
      report.conflicts += 1;
    }
  }

  // Temario: si todo lo añadido aquí ya está en la comunidad, la capa local sobra.
  for (const overlay of await db.lSubjects.toArray()) {
    const community = await db.cSubjects.get(overlay.id);
    if (!community) continue;
    const { local: _local, ...doc } = overlay;
    const { changes } = mergeSubject(community, doc, doc.updatedAt);
    if (changes.added.length + changes.renamed.length + changes.reordered.length === 0) {
      await db.lSubjects.delete(overlay.id);
      report.overlaysRemoved += 1;
    }
  }
  return report;
}

export type ConflictChoice = 'use-community' | 'rebase-mine' | 'keep-as-new';

export async function resolveConflict(id: string, choice: ConflictChoice): Promise<void> {
  const row = await db.lQuestions.get(id);
  const community = await db.cQuestions.get(id);
  if (!row) return;
  if (choice === 'use-community') {
    await db.lQuestions.delete(id);
    return;
  }
  const clean: LocalMeta = { baseRev: null, syncState: 'local', outboxId: null, note: null };
  if (choice === 'rebase-mine') {
    if (!community) return;
    // Lo escrito se conserva, ahora como la siguiente revisión de lo que hay publicado.
    await db.lQuestions.put({ ...row, rev: community.rev + 1, author: community.author, createdAt: community.createdAt, local: { ...clean, baseRev: community.rev } });
    return;
  }
  const newId = crypto.randomUUID();
  const copy: LocalQuestionRow = { ...row, id: newId, rev: 1, author: null, derivedFrom: id, local: clean } as LocalQuestionRow;
  await db.transaction('rw', db.lQuestions, async () => {
    await db.lQuestions.delete(id);
    await db.lQuestions.put(copy);
  });
}

