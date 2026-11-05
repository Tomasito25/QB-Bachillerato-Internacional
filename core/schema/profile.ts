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
  /** Hora de GitHub del primer issue de conexión. */
  registeredAt: IsoDate,
  updatedAt: IsoDate,
});
export type UserDoc = z.infer<typeof UserDoc>;
