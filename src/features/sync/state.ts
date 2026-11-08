import { createStore } from '@/infra/store';

/** Estado de la sincronización. Aparte de su lógica: se pinta en todas las pantallas. */

export type SyncStatusKind = 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatusKind;
  message: string | null;
  done: number;
  total: number;
  lastSyncAt: number | null;
  /** Este despliegue todavía no ha publicado datos. */
  noCommunity: boolean;
}

export const syncState = createStore<SyncState>({ status: 'idle', message: null, done: 0, total: 0, lastSyncAt: null, noCommunity: false });

export interface DeviceSyncStatus {
  enabled: boolean;
  status: 'idle' | 'syncing' | 'error';
  message: string | null;
  lastSyncAt: number | null;
}

export const deviceSync = createStore<DeviceSyncStatus>({ enabled: false, status: 'idle', message: null, lastSyncAt: null });
