import { describe, expect, it } from 'vitest';
import { detectDeletions, mergeRows, pruneTombstones, type MergeRules } from '@core/sync/merge';

interface Row {
  id: string;
  at: number;
}

const rules: MergeRules<Row> = { key: (r) => r.id, pick: (a, b) => (b.at > a.at ? b : a), editedAt: (r) => r.at };
const side = (rows: Row[], tombstones = {}) => ({ rows, tombstones });

describe('fusión entre dispositivos', () => {
  it('une lo de los dos lados y se queda con lo más reciente', () => {
    const { rows } = mergeRows(side([{ id: 'a', at: 1 }, { id: 'b', at: 5 }]), side([{ id: 'b', at: 3 }, { id: 'c', at: 2 }]), rules);
    expect(rows).toEqual(expect.arrayContaining([{ id: 'a', at: 1 }, { id: 'b', at: 5 }, { id: 'c', at: 2 }]));
    expect(rows).toHaveLength(3);
  });

  it('una fila que falta en el otro lado no se borra: sólo cuenta la marca de borrado', () => {
    expect(mergeRows(side([{ id: 'a', at: 1 }]), side([]), rules).rows).toHaveLength(1);
  });

  it('un borrado llega al otro dispositivo y se queda para el siguiente', () => {
    const result = mergeRows(side([{ id: 'a', at: 1 }]), side([], { a: 5 }), rules);
    expect(result.rows).toEqual([]);
    expect(result.tombstones).toEqual({ a: 5 });
  });

  it('editar después de borrar gana al borrado', () => {
    const result = mergeRows(side([{ id: 'a', at: 9 }]), side([], { a: 5 }), rules);
    expect(result.rows).toEqual([{ id: 'a', at: 9 }]);
    expect(result.tombstones).toEqual({});
  });

  it('sin fecha de edición, el borrado gana siempre', () => {
    const { rows } = mergeRows(side([{ id: 'a', at: 9 }]), side([], { a: 5 }), { key: rules.key, pick: rules.pick });
    expect(rows).toEqual([]);
  });

  it('detecta lo borrado aquí y conserva la primera fecha', () => {
    expect(detectDeletions(['a', 'b', 'c'], new Set(['b']), { c: 7 }, 100)).toEqual({ a: 100, c: 7 });
  });

  it('olvida las marcas muy antiguas', () => {
    const now = 400 * 24 * 60 * 60 * 1000;
    expect(pruneTombstones({ old: 1, recent: now - 1000 }, now)).toEqual({ recent: now - 1000 });
  });
});
