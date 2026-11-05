import { createStore } from './store';

/**
 * Estado de conexión. `navigator.onLine` sólo sabe si hay red, no si hay internet; por eso
 * un fallo real de `fetch` también cuenta, y un acierto lo devuelve a «en línea».
 */
export const online = createStore<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

export function startConnectivityWatch(): () => void {
  const up = () => online.set(true);
  const down = () => online.set(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  return () => {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
  };
}

export function reportNetworkFailure(): void {
  if (!navigator.onLine) online.set(false);
}
