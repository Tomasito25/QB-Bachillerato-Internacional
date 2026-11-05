import type { SubjectDoc, Topic, Unit } from '../schema/taxonomy.ts';
import { normalizedName } from '../questions/normalize.ts';

/** Índices para resolver un tema a su unidad y a su asignatura. */
export interface TaxonomyIndex {
  subjects: Map<string, SubjectDoc>;
  units: Map<string, { unit: Unit; subjectId: string }>;
  topics: Map<string, { topic: Topic; unitId: string; subjectId: string }>;
}

export function buildTaxonomyIndex(subjects: Iterable<SubjectDoc>): TaxonomyIndex {
  const index: TaxonomyIndex = { subjects: new Map(), units: new Map(), topics: new Map() };
  for (const subject of subjects) {
    index.subjects.set(subject.id, subject);
    for (const unit of subject.units) {
      index.units.set(unit.id, { unit, subjectId: subject.id });
      for (const topic of unit.topics) {
        index.topics.set(topic.id, { topic, unitId: unit.id, subjectId: subject.id });
      }
    }
  }
  return index;
}

export interface MergeChanges {
  added: string[];
  renamed: string[];
  reordered: string[];
}

export interface MergeResult {
  doc: SubjectDoc;
  changes: MergeChanges;
  /** Errores de nombre: dos hermanos no pueden llamarse igual. */
  errors: string[];
}

function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}

/**
 * Fusiona lo que propone un usuario con lo que ya existe.
 *
 * Es aditivo a propósito: lo ausente en la propuesta no se borra. Un usuario añade el tema
 * que le falta a su pregunta sin arrastrar una copia vieja del árbol que borre lo de otros.
 */
export function mergeSubject(existing: SubjectDoc | null, proposal: SubjectDoc, nowIso: string): MergeResult {
  const changes: MergeChanges = { added: [], renamed: [], reordered: [] };
  const errors: string[] = [];

  if (!existing) {
    changes.added.push(proposal.id);
    for (const unit of proposal.units) {
      changes.added.push(unit.id);
      for (const topic of unit.topics) changes.added.push(topic.id);
    }
    const doc: SubjectDoc = { ...proposal, rev: 1, updatedAt: nowIso };
    errors.push(...siblingNameErrors(doc));
    return { doc, changes, errors };
  }

  const units = new Map(existing.units.map((u) => [u.id, u]));
  for (const proposed of proposal.units) {
    const current = units.get(proposed.id);
    if (!current) {
      units.set(proposed.id, proposed);
      changes.added.push(proposed.id);
      for (const topic of proposed.topics) changes.added.push(topic.id);
      continue;
    }
    let name = current.name;
    let order = current.order;
    let description = current.description;
    if (proposed.name !== current.name || proposed.description !== current.description) {
      name = proposed.name;
      description = proposed.description;
      changes.renamed.push(proposed.id);
    }
    if (proposed.order !== current.order) {
      order = proposed.order;
      changes.reordered.push(proposed.id);
    }
    const topics = new Map(current.topics.map((t) => [t.id, t]));
    for (const topic of proposed.topics) {
      const known = topics.get(topic.id);
      if (!known) {
        topics.set(topic.id, topic);
        changes.added.push(topic.id);
        continue;
      }
      if (known.name !== topic.name) changes.renamed.push(topic.id);
      if (known.order !== topic.order) changes.reordered.push(topic.id);
      topics.set(topic.id, topic);
    }
    units.set(proposed.id, { ...current, name, description, order, topics: [...topics.values()].sort(byOrder) });
  }

  const renamedSubject = proposal.name !== existing.name || proposal.description !== existing.description;
  if (renamedSubject) changes.renamed.push(existing.id);

  const changed = changes.added.length + changes.renamed.length + changes.reordered.length > 0;
  const doc: SubjectDoc = {
    ...existing,
    name: proposal.name,
    description: proposal.description,
    units: [...units.values()].sort(byOrder),
    rev: changed ? existing.rev + 1 : existing.rev,
    updatedAt: changed ? nowIso : existing.updatedAt,
  };
  errors.push(...siblingNameErrors(doc));
  return { doc, changes, errors };
}

function siblingNameErrors(doc: SubjectDoc): string[] {
  const errors: string[] = [];
  const unitNames = new Set<string>();
  for (const unit of doc.units) {
    const key = normalizedName(unit.name);
    if (unitNames.has(key)) errors.push(`Unidad repetida en «${doc.name}»: «${unit.name}»`);
    unitNames.add(key);
    const topicNames = new Set<string>();
    for (const topic of unit.topics) {
      const topicKey = normalizedName(topic.name);
      if (topicNames.has(topicKey)) errors.push(`Tema repetido en «${unit.name}»: «${topic.name}»`);
      topicNames.add(topicKey);
    }
  }
  return errors;
}

export interface AlignResult {
  doc: SubjectDoc;
  /** Id propuesto → id existente, para reescribir las preguntas que los usan. */
  idMap: Map<string, string>;
}

/**
 * Alinea una asignatura propuesta con lo que ya existe, por nombre normalizado.
 *
 * Si dos personas crean «Anatomía» por su cuenta, cada una tiene su UUID. Sin esto, acabarían
 * dos asignaturas iguales. Los nodos que ya existen adoptan el id existente; los nuevos
 * conservan el suyo.
 */
export function alignSubject(existing: readonly SubjectDoc[], proposal: SubjectDoc): AlignResult {
  const idMap = new Map<string, string>();
  const sameId = existing.find((s) => s.id === proposal.id);
  const target = sameId ?? existing.find((s) => normalizedName(s.name) === normalizedName(proposal.name));
  if (!target) return { doc: proposal, idMap };
  if (!sameId) idMap.set(proposal.id, target.id);

  // Lo encontrado por nombre es el mismo nodo escrito de otra forma, no una edición: conserva
  // su nombre y su orden. Si no, «ANATOMÍA» contaría como renombrar «Anatomía».
  const units = proposal.units.map((unit) => {
    const unitById = target.units.find((u) => u.id === unit.id);
    const knownUnit = unitById ?? target.units.find((u) => normalizedName(u.name) === normalizedName(unit.name));
    if (!knownUnit) return unit;
    if (!unitById) idMap.set(unit.id, knownUnit.id);
    const topics = unit.topics.map((topic) => {
      const topicById = knownUnit.topics.find((t) => t.id === topic.id);
      if (topicById) return topic;
      const topicByName = knownUnit.topics.find((t) => normalizedName(t.name) === normalizedName(topic.name));
      if (!topicByName) return topic;
      idMap.set(topic.id, topicByName.id);
      return topicByName;
    });
    return unitById ? { ...unit, topics } : { ...knownUnit, topics };
  });
  const doc = sameId ? { ...proposal, units } : { ...proposal, id: target.id, name: target.name, description: target.description, units };
  return { doc, idMap };
}
