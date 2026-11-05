import { loadIdentity, tokenReady } from '@/features/account/identity';
import { hasCommunity } from '@/infra/config';
import { getToken } from '@/infra/crypto/tokenVault';
import { db } from '@/infra/db/db';
import type { OutboxRow } from '@/infra/db/types';
import { flushWithToken, refreshStatuses } from './outbox';
import { loadSyncState, syncCommunity, syncState } from './communitySync';

const TICK_MS = 60 * 1000;
const AUTO_SYNC_MS = 10 * 60 * 1000;
const EAGER_SYNC_MS = 60 * 1000;
const EAGER_WINDOW_MS = 15 * 60 * 1000;
const STATUS_CHECK_MS = 5 * 60 * 1000;

/**
 * Cada cuánto mirar si hay datos nuevos. Leer de Pages no gasta cuota de la API, así que tras un
 * envío se mira cada minuto: lo aceptado tarda un par de minutos en publicarse.
 */
export function syncInterval(outbox: readonly Pick<OutboxRow, 'status' | 'updatedAt'>[], now: number): number {
  const expecting = outbox.some((row) => (row.status === 'awaiting-user' || row.status === 'sent' || row.status === 'accepted') && now - row.updatedAt < EAGER_WINDOW_MS);
  return expecting ? EAGER_SYNC_MS : AUTO_SYNC_MS;
}

/**
 * Sincronización automática: al arrancar, al recuperar la conexión, al volver a la app y cada poco
 * mientras está a la vista. No usa Background Sync porque Safari y Firefox no lo tienen: esto
 * funciona igual en todas partes, y lo que queda en cola se envía la próxima vez que se abra la app.
 */
export function startBackgroundSync(): void {
  // Aparte de la última sincronización correcta: si falla, no se reintenta en cada vuelta.
  let lastAttemptAt = 0;
  let lastStatusCheckAt = 0;

  const syncIsDue = async (now: number) => {
    const last = Math.max(syncState.get().lastSyncAt ?? 0, lastAttemptAt);
    return now - last >= syncInterval(await db.outbox.toArray(), now);
  };

  const tick = async (force = false) => {
    if (!navigator.onLine || !hasCommunity()) return;
    const now = Date.now();
    if (force || (await syncIsDue(now))) {
      lastAttemptAt = now;
      await syncCommunity();
    }
    if (tokenReady.get() && (force || now - lastStatusCheckAt >= STATUS_CHECK_MS)) {
      lastStatusCheckAt = now;
      await flushWithToken();
      await refreshStatuses().catch(() => undefined);
    }
  };

  void (async () => {
    await Promise.all([loadIdentity(), loadSyncState()]);
    if (await getToken()) tokenReady.set(true);
    await tick();
  })();

  window.addEventListener('online', () => void tick(true));
  const tickIfVisible = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  window.setInterval(tickIfVisible, TICK_MS);
  // Al volver de la pestaña de GitHub es cuando más probable es que haya novedades.
  document.addEventListener('visibilitychange', tickIfVisible);
}
