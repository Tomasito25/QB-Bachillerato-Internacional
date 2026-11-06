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
const EAGER_STATUS_MS = 2 * 60 * 1000;

type OutboxTiming = Pick<OutboxRow, 'status' | 'updatedAt'>;

const recent = (outbox: readonly OutboxTiming[], now: number, statuses: readonly OutboxRow['status'][]) =>
  outbox.some((row) => statuses.includes(row.status) && now - row.updatedAt < EAGER_WINDOW_MS);

/**
 * Cada cuánto mirar si hay datos nuevos. Leer de Pages no gasta cuota de la API, así que tras un
 * envío se mira cada minuto: lo aceptado tarda un par de minutos en publicarse.
 */
export function syncInterval(outbox: readonly OutboxTiming[], now: number): number {
  return recent(outbox, now, ['awaiting-user', 'sent', 'accepted']) ? EAGER_SYNC_MS : AUTO_SYNC_MS;
}

/**
 * Cada cuánto preguntar a GitHub por los envíos, o `null` para no hacerlo. Sin token hay 60
 * consultas por hora y por IP: se pregunta justo después de enviar, que es cuando hay novedades.
 */
export function statusInterval(outbox: readonly OutboxTiming[], now: number, hasToken: boolean): number | null {
  if (recent(outbox, now, ['awaiting-user', 'sent'])) return EAGER_STATUS_MS;
  return hasToken ? STATUS_CHECK_MS : null;
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

  const tick = async (force = false) => {
    if (!navigator.onLine || !hasCommunity()) return;
    const now = Date.now();
    const outbox = await db.outbox.toArray();
    if (force || now - Math.max(syncState.get().lastSyncAt ?? 0, lastAttemptAt) >= syncInterval(outbox, now)) {
      lastAttemptAt = now;
      await syncCommunity();
    }
    // Así el estado de un envío se ve en cualquier pantalla, no sólo en la de sincronización.
    const hasToken = tokenReady.get();
    const every = statusInterval(outbox, now, hasToken);
    if (every !== null && (force || now - lastStatusCheckAt >= every)) {
      lastStatusCheckAt = now;
      if (hasToken) await flushWithToken();
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
