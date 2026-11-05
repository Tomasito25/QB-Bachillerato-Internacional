import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { normalizedName } from '@core/questions/normalize';
import type { SubjectDoc, Topic, Unit } from '@core/schema/taxonomy';
import { buildTaxonomyIndex, mergeSubject, type TaxonomyIndex } from '@core/taxonomy/merge';
import { toIso } from '@core/util/time';
import { db } from '@/infra/db/db';
import type { LocalSubjectRow } from '@/infra/db/types';

export class TaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxonomyError';
  }
}

function stripLocal(row: LocalSubjectRow): SubjectDoc {
  const { local: _local, ...doc } = row;
  return doc;
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/**
 * Vista del temario: lo comunitario más lo que el usuario ha añadido encima. La fusión es la
 * misma función que aplica Actions al publicar, así que lo que se ve es lo que se obtendrá.
 */
export async function loadSubjects(): Promise<SubjectDoc[]> {
  const [community, local] = await Promise.all([db.cSubjects.toArray(), db.lSubjects.toArray()]);
  const byId = new Map(community.map((s) => [s.id, s]));
  for (const row of local) {
    const doc = stripLocal(row);
    const base = byId.get(doc.id);
    byId.set(doc.id, base ? mergeSubject(base, doc, doc.updatedAt).doc : doc);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export interface TaxonomyView {
  subjects: SubjectDoc[];
  index: TaxonomyIndex;
  /** Ids que ya existen en la comunidad: no se pueden borrar desde aquí. */
  communityIds: Set<string>;
  /** Ids con cambios sin publicar. */
  localSubjectIds: Set<string>;
}

interface RawTaxonomy {
  subjects: SubjectDoc[];
  communityIds: Set<string>;
  localSubjectIds: Set<string>;
}

async function loadTaxonomy(): Promise<RawTaxonomy> {
  const [subjects, community, local] = await Promise.all([loadSubjects(), db.cSubjects.toArray(), db.lSubjects.toCollection().primaryKeys()]);
  const communityIds = new Set<string>();
  for (const subject of community) {
    communityIds.add(subject.id);
    for (const unit of subject.units) {
      communityIds.add(unit.id);
      for (const topic of unit.topics) communityIds.add(topic.id);
    }
  }
  return { subjects, communityIds, localSubjectIds: new Set(local) };
}

export function useTaxonomy(): TaxonomyView | undefined {
  const raw = useLiveQuery(loadTaxonomy, []);
  return useMemo(() => (raw ? { ...raw, index: buildTaxonomyIndex(raw.subjects) } : undefined), [raw]);
}

/**
 * Modifica la capa local de una asignatura. Si es comunitaria y aún no se había tocado, parte
 * de una copia: la réplica comunitaria nunca se escribe desde aquí.
 */
async function withLocalSubject(subjectId: string, mutate: (doc: SubjectDoc) => void): Promise<void> {
  await db.transaction('rw', db.lSubjects, db.cSubjects, async () => {
    let row = await db.lSubjects.get(subjectId);
    if (!row) {
      const base = await db.cSubjects.get(subjectId);
      if (!base) throw new TaxonomyError('La asignatura ya no existe.');
      row = { ...structuredClone(base), local: { baseRev: base.rev } };
    }
    const community = await db.cSubjects.get(subjectId);
    const doc: SubjectDoc = community ? mergeSubject(community, stripLocal(row), toIso(Date.now())).doc : stripLocal(row);
    mutate(doc);
    doc.updatedAt = toIso(Date.now());
    await db.lSubjects.put({ ...doc, local: row.local });
  });
}

function assertUniqueName(existing: readonly { id: string; name: string }[], name: string, selfId?: string): void {
  const key = normalizedName(name);
  if (!key) throw new TaxonomyError('Escribe un nombre.');
  if (existing.some((item) => item.id !== selfId && normalizedName(item.name) === key)) {
    throw new TaxonomyError(`Ya existe «${name.trim()}».`);
  }
}

export async function createSubject(name: string, description?: string): Promise<string> {
  assertUniqueName(await loadSubjects(), name);
  const id = crypto.randomUUID();
  const now = toIso(Date.now());
  await db.lSubjects.put({
    schemaVersion: 1,
    id,
    name: name.trim(),
    description: description?.trim() || undefined,
    rev: 1,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    units: [],
    local: { baseRev: null },
  });
  return id;
}

export async function updateSubject(id: string, patch: { name: string; description?: string }): Promise<void> {
  assertUniqueName(await loadSubjects(), patch.name, id);
  await withLocalSubject(id, (doc) => {
    doc.name = patch.name.trim();
    doc.description = patch.description?.trim() || undefined;
  });
}

function findUnit(doc: SubjectDoc, unitId: string): Unit {
  const unit = doc.units.find((u) => u.id === unitId);
  if (!unit) throw new TaxonomyError('La unidad ya no existe.');
  return unit;
}

export async function addUnit(subjectId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await withLocalSubject(subjectId, (doc) => {
    assertUniqueName(doc.units, name);
    const order = doc.units.reduce((max, u) => Math.max(max, u.order + 1), 0);
    doc.units.push({ id, name: name.trim(), order, topics: [] });
  });
  return id;
}

export async function updateUnit(subjectId: string, unitId: string, name: string): Promise<void> {
  await withLocalSubject(subjectId, (doc) => {
    assertUniqueName(doc.units, name, unitId);
    findUnit(doc, unitId).name = name.trim();
  });
}

export async function addTopic(subjectId: string, unitId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await withLocalSubject(subjectId, (doc) => {
    const unit = findUnit(doc, unitId);
    assertUniqueName(unit.topics, name);
    const order = unit.topics.reduce((max, t) => Math.max(max, t.order + 1), 0);
    unit.topics.push({ id, name: name.trim(), order });
  });
  return id;
}

export async function updateTopic(subjectId: string, unitId: string, topicId: string, name: string): Promise<void> {
  await withLocalSubject(subjectId, (doc) => {
    const unit = findUnit(doc, unitId);
    assertUniqueName(unit.topics, name, topicId);
    const topic = unit.topics.find((t) => t.id === topicId);
    if (!topic) throw new TaxonomyError('El tema ya no existe.');
    topic.name = name.trim();
  });
}

/** Mueve un elemento y renumera: el orden queda siempre 0, 1, 2… */
function moveItem<T extends { id: string; order: number }>(items: T[], id: string, delta: -1 | 1): void {
  const sorted = [...items].sort(byOrder);
  const from = sorted.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sorted.length) return;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved as T);
  sorted.forEach((item, i) => {
    item.order = i;
  });
}

export async function moveUnit(subjectId: string, unitId: string, delta: -1 | 1): Promise<void> {
  await withLocalSubject(subjectId, (doc) => {
    moveItem(doc.units, unitId, delta);
    doc.units.sort(byOrder);
  });
}

export async function moveTopic(subjectId: string, unitId: string, topicId: string, delta: -1 | 1): Promise<void> {
  await withLocalSubject(subjectId, (doc) => {
    const unit = findUnit(doc, unitId);
    moveItem<Topic>(unit.topics, topicId, delta);
    unit.topics.sort(byOrder);
  });
}

async function questionsUsing(topicIds: ReadonlySet<string>): Promise<number> {
  const [local, community] = await Promise.all([db.lQuestions.toArray(), db.cQuestions.toArray()]);
  return [...local, ...community].filter((q) => q.topicIds.some((id) => topicIds.has(id))).length;
}

function assertDeletable(count: number): void {
  if (count > 0) {
    throw new TaxonomyError(`Hay ${count} ${count === 1 ? 'pregunta' : 'preguntas'} en este nivel. Muévelas o bórralas primero.`);
  }
}

/** Sólo se puede borrar lo que aún no se ha publicado. Lo comunitario lo retiran los mantenedores. */
export async function deleteTopic(subjectId: string, unitId: string, topicId: string): Promise<void> {
  assertDeletable(await questionsUsing(new Set([topicId])));
  await withLocalSubject(subjectId, (doc) => {
    const unit = findUnit(doc, unitId);
    unit.topics = unit.topics.filter((t) => t.id !== topicId);
  });
}

export async function deleteUnit(subjectId: string, unitId: string): Promise<void> {
  const row = await db.lSubjects.get(subjectId);
  const unit = row?.units.find((u) => u.id === unitId);
  assertDeletable(await questionsUsing(new Set(unit?.topics.map((t) => t.id))));
  await withLocalSubject(subjectId, (doc) => {
    doc.units = doc.units.filter((u) => u.id !== unitId);
  });
}

export async function deleteSubject(subjectId: string): Promise<void> {
  const row = await db.lSubjects.get(subjectId);
  if (!row) return;
  const topics = row.units.flatMap((u) => u.topics.map((t) => t.id));
  const [local, community] = await Promise.all([db.lQuestions.where('subjectId').equals(subjectId).count(), db.cQuestions.where('subjectId').equals(subjectId).count()]);
  assertDeletable(local + community + (await questionsUsing(new Set(topics))));
  await db.lSubjects.delete(subjectId);
}

export function topicPath(index: TaxonomyIndex, topicId: string): { subject: string; unit: string; topic: string } | null {
  const entry = index.topics.get(topicId);
  if (!entry) return null;
  return {
    subject: index.subjects.get(entry.subjectId)?.name ?? '',
    unit: index.units.get(entry.unitId)?.unit.name ?? '',
    topic: entry.topic.name,
  };
}
