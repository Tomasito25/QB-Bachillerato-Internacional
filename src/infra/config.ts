/**
 * Configuración pública de este despliegue. Nada de esto es secreto: acaba en el bundle.
 */
const repo = (import.meta.env.VITE_COMMUNITY_REPO ?? '').trim();

export const config = {
  version: __APP_VERSION__,
  base: import.meta.env.BASE_URL,
  /** `propietario/nombre`, o cadena vacía si este despliegue no tiene comunidad. */
  repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : '',
  communityUrl: (path: string) => `${import.meta.env.BASE_URL}community/${path}`,
};

export const hasCommunity = (): boolean => config.repo !== '';
