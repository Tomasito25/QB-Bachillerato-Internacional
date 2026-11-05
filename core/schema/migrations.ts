import { SCHEMA_VERSION } from './common.ts';

/**
 * Migraciones de documentos comunitarios.
 *
 * Git conserva los ficheros tal como se escribieron: un documento antiguo puede seguir ahí
 * muchos años. Por eso se migran al leerlos, en cliente y en servidor, en vez de reescribir
 * el repositorio entero con cada cambio de esquema.
 *
 * Al subir `SCHEMA_VERSION` a N+1, añade `migrations[N]` que convierta un documento de la
 * versión N en uno de la N+1, y una prueba con un documento real de la versión anterior.
 */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {};

export class FutureSchemaError extends Error {
  constructor(version: number) {
    super(`Documento con esquema ${version}, más reciente que el ${SCHEMA_VERSION} de esta versión`);
    this.name = 'FutureSchemaError';
  }
}

export function migrateDocument(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  let doc = input as Record<string, unknown>;
  // Sin campo: anterior al versionado.
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) throw new FutureSchemaError(version);
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) return doc;
    doc = { ...step(doc), schemaVersion: version + 1 };
    version += 1;
  }
  return doc;
}
