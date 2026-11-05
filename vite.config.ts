import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/**
 * Ruta de la que cuelga la app. GitHub Pages la sirve en `/<repo>/`; el workflow
 * de despliegue la lee de `actions/configure-pages` y la pasa aquí.
 */
const base = process.env.QB_BASE || '/';
const escapedBase = base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Política de seguridad de contenido.
 *
 * Pages no permite cabeceras propias, así que va en una etiqueta `<meta>`, y por eso
 * no incluye `frame-ancestors`, que el navegador ignora ahí. Sólo se añade al compilar:
 * en desarrollo, Vite necesita scripts en línea y su WebSocket.
 *
 * `style-src-attr` es necesario porque KaTeX coloca los símbolos con `style`. `connect-src`
 * es también la última barrera si un XSS intentara sacar el token: sólo puede hablar con
 * la propia página y con la API de GitHub.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' blob: https://avatars.githubusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'qb-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

/**
 * Enlaces profundos en Pages.
 *
 * Pages no reescribe rutas: `/repo/q/123` daría 404 si la app no está instalada. Su
 * página de error personalizada es una copia de `index.html`, que arranca el router y
 * pinta la ruta correcta. Una vez activo el Service Worker, ya no se pasa por aquí.
 */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'qb-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const index = resolve(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    // Nada incrustado como `data:`: la CSP lo bloquearía, como les pasaba a las fuentes de KaTeX.
    assetsInlineLimit: 0,
  },
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    spaFallback(),
    VitePWA({
      // La actualización la decide el usuario: un examen a medias no se recarga solo.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'QuestionBank',
        short_name: 'QuestionBank',
        description: 'Banco de preguntas colaborativo para estudiar, repasar y competir, también sin conexión.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#4f5bd5',
        background_color: '#fbfbfa',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Estudiar', url: `${base}study`, icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Crear pregunta', url: `${base}create`, icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico}'],
        // Los datos comunitarios viven en IndexedDB y las pantallas de inicio de iOS sólo
        // las usa el sistema: precachearlos sería gastar espacio dos veces.
        globIgnores: ['community/**', 'icons/splash-*.png'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${escapedBase}community/`)],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Direccionadas por hash: lo descargado una vez no cambia nunca.
            urlPattern: new RegExp(`${escapedBase}community/images/`),
            handler: 'CacheFirst',
            options: {
              cacheName: 'qb-images',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/avatars\.githubusercontent\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'qb-avatars',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
