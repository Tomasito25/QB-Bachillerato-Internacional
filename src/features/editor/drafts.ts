import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/infra/db/db';
import type { DraftRow } from '@/infra/db/types';
import type { QuestionForm } from './form';

export async function saveDraft(form: QuestionForm): Promise<void> {
  const existing = await db.drafts.get(form.id);
  const now = Date.now();
  await db.drafts.put({
    id: form.id,
    form: structuredClone(form),
    baseRev: form.baseRev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function loadDraft(id: string): Promise<QuestionForm | null> {
  return ((await db.drafts.get(id))?.form as QuestionForm | undefined) ?? null;
}

export async function deleteDraft(id: string): Promise<void> {
  await db.drafts.delete(id);
}

export function useDrafts(): DraftRow[] | undefined {
  return useLiveQuery(() => db.drafts.orderBy('updatedAt').reverse().toArray(), []);
}
