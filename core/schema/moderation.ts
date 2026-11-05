import { z } from 'zod';
import { Login, Uuid } from './common.ts';

/** Ficheros de `moderation/`. Sólo los cambian los mantenedores, con un commit a `data`. */
export const BannedFile = z.strictObject({ logins: z.array(Login) });
export const HiddenFile = z.strictObject({ questions: z.array(Uuid) });
/** Cuentas revisadas a mano: no se les aplica la marca automática de sospecha. */
export const TrustedFile = z.strictObject({ logins: z.array(Login) });
/** Preguntas retiradas por su autor. Las escribe Actions. */
export const RetiredFile = z.strictObject({ questions: z.array(Uuid) });
