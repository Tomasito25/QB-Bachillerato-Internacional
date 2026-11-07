/**
 * Configuración pública de este despliegue. Nada de esto es secreto: acaba en el bundle.
 */
const raw = (import.meta.env.VITE_COMMUNITY_REPO ?? '').trim();
const repo = /^[\w.-]+\/[\w.-]+$/.test(raw) ? raw : '';

export const config = {
  version: __APP_VERSION__,
  appName: __APP_NAME__,
  base: import.meta.env.BASE_URL,
  /** `propietario/nombre`, o cadena vacía si este despliegue no tiene comunidad. */
  repo,
  /** Una página de este repositorio en GitHub. */
  repoUrl: (path = '') => `https://github.com/${repo}${path}`,
  communityUrl: (path: string) => `${import.meta.env.BASE_URL}community/${path}`,
};

export const hasCommunity = (): boolean => config.repo !== '';
