import { z } from 'zod';
import { IsoDate, Login } from './common.ts';

/**
 * Documento del usuario en la rama `data`. Lo escribe sólo Actions. Lo único que decide
 * el usuario son `displayName` y `bio`; el resto viene de GitHub.
 */
export const UserDoc = z.strictObject({
  schemaVersion: z.literal(1),
  login: Login,
  /** Id numérico de GitHub. Un login se puede reutilizar; el id, no. */
  githubId: z.number().int().positive(),
  avatarUrl: z.string().startsWith('https://avatars.githubusercontent.com/').max(300),
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(280).optional(),
  /** Hora de GitHub del issue que cambió el nombre por última vez. Marca la espera. */
  nameChangedAt: IsoDate.optional(),
  /** Hora de GitHub del primer issue de conexión. */
  registeredAt: IsoDate,
  updatedAt: IsoDate,
});
export type UserDoc = z.infer<typeof UserDoc>;

/** Cada cuánto se puede cambiar el nombre visible. Lo hace cumplir Actions, con la hora del issue. */
export const NAME_COOLDOWN_DAYS = 30;
export const NAME_LENGTH = { min: 2, max: 40 } as const;

/** Fuera caracteres de control e invisibles, que harían pasar por distintos dos nombres iguales. */
export function cleanDisplayName(name: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  const value = name?.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return value || undefined;
}

/** Para comparar: sin mayúsculas, tildes, espacios ni signos. «Ána G.» choca con «ana-g». */
export function nameKey(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Por qué no vale un nombre, o `null` si vale. `others`: nombres y logins de las demás cuentas. */
export function displayNameProblem(name: string, others: Iterable<string>): string | null {
  if (name.length > NAME_LENGTH.max) return `Como mucho ${NAME_LENGTH.max} caracteres.`;
  const key = nameKey(name);
  if (key.length < NAME_LENGTH.min) return `Necesita al menos ${NAME_LENGTH.min} letras o números.`;
  for (const other of others) if (nameKey(other) === key) return 'Ese nombre ya lo usa otra persona, o es su usuario de GitHub.';
  return null;
}

/** Cuándo se podrá volver a cambiar el nombre (epoch en ms), o `null` si ya se puede. */
export function nextNameChange(changedAt: string | undefined, now: number): number | null {
  if (!changedAt) return null;
  const at = Date.parse(changedAt) + NAME_COOLDOWN_DAYS * 86_400_000;
  return at > now ? at : null;
}
