/**
 * Genera los iconos de la PWA a partir de un único dibujo.
 *   npm run icons
 * Los PNG se versionan: `sharp` no hace falta para compilar ni para desplegar.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');

const ACCENT = '#4f5bd5';
const CANVAS = '#fbfbfa';

/** La «Q», dibujada sobre un lienzo de 512. `scale` la reduce para la zona segura del icono adaptable. */
function glyph(scale = 1): string {
  const s = (n: number) => (n * scale).toFixed(2);
  const c = (n: number) => (256 + (n - 256) * scale).toFixed(2);
  return `
    <circle cx="${c(242)}" cy="${c(238)}" r="${s(116)}" fill="none" stroke="#fff" stroke-width="${s(46)}"/>
    <path d="M${c(306)} ${c(302)} L${c(394)} ${c(390)}" fill="none" stroke="#fff" stroke-width="${s(46)}" stroke-linecap="round"/>`;
}

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${ACCENT}"/>${glyph()}</svg>`;
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${ACCENT}"/>${glyph(0.72)}</svg>`;

const png = (svg: string, size: number) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const SPLASH_SIZES: readonly [number, number][] = [
  [1290, 2796],
  [1179, 2556],
  [1170, 2532],
  [1125, 2436],
  [828, 1792],
  [750, 1334],
  [1536, 2048],
  [1668, 2388],
  [2048, 2732],
];

async function main() {
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'favicon.svg'), rounded);
  await writeFile(resolve(outDir, 'icon-192.png'), await png(rounded, 192));
  await writeFile(resolve(outDir, 'icon-512.png'), await png(rounded, 512));
  await writeFile(resolve(outDir, 'maskable-512.png'), await png(fullBleed, 512));
  // iOS recorta las esquinas él mismo y pinta de negro la transparencia.
  await writeFile(resolve(outDir, 'apple-touch-icon.png'), await png(fullBleed, 180));

  for (const [width, height] of SPLASH_SIZES) {
    const icon = await png(rounded, Math.round(Math.min(width, height) * 0.22));
    const image = await sharp({ create: { width, height, channels: 3, background: CANVAS } })
      .composite([{ input: icon, gravity: 'center' }])
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    await writeFile(resolve(outDir, `splash-${width}x${height}.png`), image);
  }
  console.log(`Iconos generados en ${outDir}`);
}

await main();
