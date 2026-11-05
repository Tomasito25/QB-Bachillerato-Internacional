import { z } from 'zod';
import { IsoDate, UserRef, Uuid } from './common.ts';

const Name = z.string().trim().min(1).max(120);
const Description = z.string().max(1000).optional();

export const Topic = z.strictObject({
  id: Uuid,
  name: Name,
  order: z.number().int().min(0),
});
export type Topic = z.infer<typeof Topic>;

export const Unit = z.strictObject({
  id: Uuid,
  name: Name,
  description: Description,
  order: z.number().int().min(0),
  topics: z.array(Topic).max(200),
});
export type Unit = z.infer<typeof Unit>;

/**
 * Asignatura con su árbol. Se guarda como un solo documento porque así un cambio se lee
 * bien en el diff de un PR y dos usuarios no pueden dejar la jerarquía a medias.
 */
export const SubjectDoc = z.strictObject({
  schemaVersion: z.literal(1),
  id: Uuid,
  name: Name,
  description: Description,
  rev: z.number().int().positive(),
  createdBy: UserRef.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  units: z.array(Unit).max(200),
});
export type SubjectDoc = z.infer<typeof SubjectDoc>;
