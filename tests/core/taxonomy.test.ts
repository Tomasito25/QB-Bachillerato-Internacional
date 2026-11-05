import { describe, expect, it } from 'vitest';
import { buildTaxonomyIndex, mergeSubject } from '@core/taxonomy/merge';
import { AT, makeSubject, SUBJECT_ID, TOPIC_ID, UNIT_ID, uuid } from '../fixtures';

const NOW = '2026-11-05T12:00:00.000Z';

describe('índice del temario', () => {
  it('resuelve cada tema a su unidad y asignatura', () => {
    const index = buildTaxonomyIndex([makeSubject()]);
    expect(index.topics.get(TOPIC_ID)).toMatchObject({ unitId: UNIT_ID, subjectId: SUBJECT_ID });
    expect(index.units.get(UNIT_ID)?.subjectId).toBe(SUBJECT_ID);
  });
});

describe('fusión de asignaturas', () => {
  it('una asignatura nueva se crea tal cual, en revisión 1', () => {
    const proposal = makeSubject({ rev: 7 });
    const { doc, changes, errors } = mergeSubject(null, proposal, NOW);
    expect(errors).toEqual([]);
    expect(doc.rev).toBe(1);
    expect(changes.added).toContain(TOPIC_ID);
  });

  it('añadir un tema no borra lo que no viene en la propuesta', () => {
    const existing = makeSubject();
    const newTopic = uuid(100);
    const otherUnit = uuid(101);
    const stored = makeSubject({
      units: [...existing.units, { id: otherUnit, name: 'Otra unidad', order: 1, topics: [] }],
    });
    const proposal = makeSubject({
      units: [{ id: UNIT_ID, name: 'Sistema locomotor', order: 0, topics: [{ id: TOPIC_ID, name: 'Huesos', order: 0 }, { id: newTopic, name: 'Articulaciones', order: 1 }] }],
    });
    const { doc, changes } = mergeSubject(stored, proposal, NOW);
    expect(doc.units.map((u) => u.id)).toContain(otherUnit);
    expect(doc.units[0]?.topics.map((t) => t.name)).toEqual(['Huesos', 'Articulaciones']);
    expect(changes.added).toEqual([newTopic]);
    expect(changes.renamed).toEqual([]);
    expect(doc.rev).toBe(2);
    expect(doc.updatedAt).toBe(NOW);
  });

  it('sin cambios no sube la revisión', () => {
    const existing = makeSubject();
    const { doc, changes } = mergeSubject(existing, makeSubject(), NOW);
    expect(changes).toEqual({ added: [], renamed: [], reordered: [] });
    expect(doc.rev).toBe(1);
    expect(doc.updatedAt).toBe(AT);
  });

  it('señala renombrados y reordenados, porque requieren revisión', () => {
    const proposal = makeSubject({
      name: 'Anatomía humana',
      units: [{ id: UNIT_ID, name: 'Locomotor', order: 3, topics: [{ id: TOPIC_ID, name: 'Osteología', order: 2 }] }],
    });
    const { changes, doc } = mergeSubject(makeSubject(), proposal, NOW);
    expect(changes.renamed).toEqual(expect.arrayContaining([SUBJECT_ID, UNIT_ID, TOPIC_ID]));
    expect(changes.reordered).toEqual(expect.arrayContaining([UNIT_ID, TOPIC_ID]));
    expect(doc.name).toBe('Anatomía humana');
  });

  it('no admite dos hermanos con el mismo nombre normalizado', () => {
    const proposal = makeSubject({
      units: [{ id: UNIT_ID, name: 'Sistema locomotor', order: 0, topics: [{ id: TOPIC_ID, name: 'Huesos', order: 0 }, { id: uuid(102), name: 'HUESOS', order: 1 }] }],
    });
    expect(mergeSubject(makeSubject(), proposal, NOW).errors).toHaveLength(1);
    const units = makeSubject({
      units: [
        { id: UNIT_ID, name: 'Cardio', order: 0, topics: [] },
        { id: uuid(103), name: 'cardio', order: 1, topics: [] },
      ],
    });
    expect(mergeSubject(null, units, NOW).errors).toHaveLength(1);
  });
});
