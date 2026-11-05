import { db } from '@/infra/db/db';
import type { SyncLogRow } from '@/infra/db/types';

const MAX_ROWS = 200;

export async function logSync(level: SyncLogRow['level'], message: string): Promise<void> {
  await db.syncLog.add({ at: Date.now(), level, message });
  const count = await db.syncLog.count();
  if (count > MAX_ROWS) {
    const excess = await db.syncLog.orderBy('seq').limit(count - MAX_ROWS).primaryKeys();
    await db.syncLog.bulkDelete(excess);
  }
}
