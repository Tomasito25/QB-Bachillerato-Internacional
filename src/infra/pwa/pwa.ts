import { registerSW } from 'virtual:pwa-register';
import { createStore } from '../store';

export const updateAvailable = createStore<boolean>(false);
export const offlineReady = createStore<boolean>(false);
export const installPrompt = createStore<BeforeInstallPromptEvent | null>(null);

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

export function startPwa(): void {
  applyUpdate = registerSW({
    onNeedRefresh: () => updateAvailable.set(true),
    onOfflineReady: () => offlineReady.set(true),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Cada hora mientras la app está abierta y visible.
      window.setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) void registration.update();
      }, 60 * 60 * 1000);
    },
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt.set(event);
  });
  window.addEventListener('appinstalled', () => installPrompt.set(null));
}

export async function installUpdate(): Promise<void> {
  await applyUpdate?.(true);
}

export async function promptInstall(): Promise<void> {
  const event = installPrompt.get();
  if (!event) return;
  await event.prompt();
  await event.userChoice;
  installPrompt.set(null);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}

/**
 * Pide al navegador que no borre los datos bajo presión de espacio. Sin esto, Safari puede
 * eliminar el almacenamiento de una web sin usar tras 7 días; instalada como PWA, no.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
