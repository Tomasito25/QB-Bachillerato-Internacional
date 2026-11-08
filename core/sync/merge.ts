/**
 * Fusión de los datos de una persona entre sus dispositivos. Es lógica pura.
 *
 * Los borrados viajan como marcas explícitas y no se deducen de que falte una fila: si dos
 * dispositivos escriben a la vez, el último pisa al primero, y una fila ausente no significa
 * que alguien la borrara. Lo que se deduce así se vuelve a subir en la siguiente vuelta.
 */

/** Momento del borrado de cada id. */
export type Tombstones = Record<string, number>;

export interface MergeSide<T> {
  rows: readonly T[];
  tombstones: Tombstones;
}

export interface MergeRules<T> {
  key: (row: T) => string;
  /** Si está en los dos lados, cuál se queda. */
  pick: (local: T, remote: T) => T;
  /** Última edición. Si es posterior al borrado, la fila sigue viva. Sin esto, el borrado gana. */
  editedAt?: (row: T) => number;
}

export interface MergeResult<T> {
  rows: T[];
  tombstones: Tombstones;
}

export function mergeRows<T>(local: MergeSide<T>, remote: MergeSide<T>, rules: MergeRules<T>): MergeResult<T> {
  const byId = new Map<string, T>();
  for (const row of local.rows) byId.set(rules.key(row), row);
  for (const row of remote.rows) {
    const id = rules.key(row);
    const mine = byId.get(id);
    byId.set(id, mine === undefined ? row : rules.pick(mine, row));
  }
  const tombstones: Tombstones = { ...local.tombstones };
  for (const [id, at] of Object.entries(remote.tombstones)) tombstones[id] = Math.max(at, tombstones[id] ?? 0);
  for (const [id, at] of Object.entries(tombstones)) {
    const row = byId.get(id);
    if (row === undefined) continue;
    if (rules.editedAt && rules.editedAt(row) > at) delete tombstones[id];
    else byId.delete(id);
  }
  return { rows: [...byId.values()], tombstones };
}

/** Lo que estaba en la última sincronización y ya no está aquí es que se ha borrado aquí. */
export function detectDeletions(base: readonly string[], current: ReadonlySet<string>, previous: Tombstones, now: number): Tombstones {
  const tombstones: Tombstones = { ...previous };
  for (const id of base) if (!current.has(id)) tombstones[id] ??= now;
  return tombstones;
}

const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** shortcut: un dispositivo apagado más de 180 días puede resucitar lo borrado; sin esta poda, la lista crece sin fin. */
export function pruneTombstones(tombstones: Tombstones, now: number): Tombstones {
  return Object.fromEntries(Object.entries(tombstones).filter(([, at]) => now - at < TOMBSTONE_TTL_MS));
}
