import { z } from 'zod';

/** Versión de los documentos comunitarios. Al subirla, añade su migración en `migrations.ts`. */
export const SCHEMA_VERSION = 1;

export const IsoDate = z.iso.datetime({ offset: false });
export const Uuid = z.uuid();
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Nombre de usuario de GitHub. Se guarda siempre en minúsculas: GitHub no distingue
 * mayúsculas y, si no, `Ana` y `ana` serían dos personas en el ranking.
 */
export const Login = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38})$/, 'Nombre de usuario de GitHub no válido');

export const UserRef = z.strictObject({
  login: Login,
  id: z.number().int().positive(),
});
export type UserRef = z.infer<typeof UserRef>;

/** Enlaces que se pueden pintar: nada de `javascript:` ni de `data:`. */
export const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2000);

export const Difficulty = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type Difficulty = z.infer<typeof Difficulty>;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'Muy fácil',
  2: 'Fácil',
  3: 'Intermedio',
  4: 'Difícil',
  5: 'Muy difícil',
};

export const DIFFICULTY_VALUES: readonly Difficulty[] = [1, 2, 3, 4, 5];

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}
