import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/routes';
import { loadPreferences } from '@/features/settings/preferences';
import { startConnectivityWatch } from '@/infra/connectivity';
import { startPwa } from '@/infra/pwa/pwa';
import '@/styles/app.css';

startConnectivityWatch();
startPwa();

// Las preferencias se cargan antes de pintar; si IndexedDB fallara (modo privado estricto),
// la app arranca con los valores por defecto en lugar de quedarse en blanco.
void loadPreferences()
  .catch((error: unknown) => console.error('No se pudieron cargar las preferencias', error))
  .finally(() => {
    // Carga diferida: arrastra los esquemas de validación, que no hacen falta para el primer pintado.
    void import('@/features/sync/background').then(({ startBackgroundSync }) => startBackgroundSync());
    createRoot(document.getElementById('root') as HTMLElement).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });
