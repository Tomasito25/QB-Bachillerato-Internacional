import { loadIdentity, tokenReady } from '@/features/account/identity';
import { hasCommunity } from '@/infra/config';
import { getToken } from '@/infra/crypto/tokenVault';
import { flushWithToken, refreshStatuses } from './outbox';
import { loadSyncState, syncCommunity, syncState } from './communitySync';

const AUTO_SYNC_MS = 30 * 60 * 1000;

/**
 * Sincronización automática: al arrancar, al recuperar la conexión y cada 30 minutos con la app
 * a la vista. No usa Background Sync porque Safari y Firefox no lo tienen: esto funciona igual
 * en todas partes, y lo que queda en cola se envía la próxima vez que se abra la app.
 */
export function startBackgroundSync(): void {
  const stale = () => {
    const { lastSyncAt } = syncState.get();
    return lastSyncAt === null || Date.now() - lastSyncAt > AUTO_SYNC_MS;
  };

  const tick = async (force = false) => {
    if (!navigator.onLine || !hasCommunity()) return;
    if (force || stale()) await syncCommunity();
    if (tokenReady.get()) {
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
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void tick();
  }, 5 * 60 * 1000);
}
