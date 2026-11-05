import { LIMITS } from '@core/schema/question';
import { sha256Hex } from '@core/util/encoding';
import { db } from '@/infra/db/db';
import type { LocalImageRow } from '@/infra/db/types';

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']);

export interface ProcessOptions {
  maxDimension: number;
  maxBytes: number;
}

export const DEFAULT_IMAGE_OPTIONS: ProcessOptions = { maxDimension: 1600, maxBytes: LIMITS.imageBytes };

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function extensionOf(type: string): 'webp' | 'png' | 'jpg' {
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  return 'jpg';
}

export interface ProcessedImage {
  hash: string;
  ext: 'webp' | 'png' | 'jpg';
  width: number;
  height: number;
  bytes: number;
  blob: Blob;
}

/**
 * Reduce y recodifica una imagen antes de guardarla. Además de ahorrar espacio, pasar por el
 * canvas elimina los metadatos (el GPS de una foto, por ejemplo) y cualquier contenido que
 * no sean píxeles. SVG se rechaza porque puede contener scripts.
 */
export async function processImage(file: Blob, options: ProcessOptions = DEFAULT_IMAGE_OPTIONS): Promise<ProcessedImage> {
  if (!ACCEPTED.has(file.type)) {
    throw new ImageError(file.type === 'image/svg+xml' ? 'No se admiten imágenes SVG.' : 'Formato no admitido. Usa JPG, PNG o WebP.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError('No se ha podido leer la imagen.');
  }

  try {
    let scale = Math.min(1, options.maxDimension / Math.max(bitmap.width, bitmap.height));
    let quality = 0.82;
    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new ImageError('Este navegador no puede procesar imágenes.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      let blob = await encode(canvas, 'image/webp', quality);
      // Safari no codifica WebP: devuelve PNG, que para una foto es enorme.
      if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality);
      if (!blob) throw new ImageError('No se ha podido convertir la imagen.');

      if (blob.size <= options.maxBytes) {
        const hash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
        return { hash, ext: extensionOf(blob.type), width, height, bytes: blob.size, blob };
      }
      if (quality > 0.55) quality -= 0.13;
      else scale *= 0.8;
    }
    throw new ImageError('La imagen es demasiado grande incluso después de reducirla.');
  } finally {
    bitmap.close();
  }
}

export async function saveLocalImage(image: ProcessedImage, alt = ''): Promise<LocalImageRow> {
  const row: LocalImageRow = {
    hash: image.hash,
    ext: image.ext,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    alt,
    blob: image.blob,
    createdAt: Date.now(),
  };
  await db.localImages.put(row);
  return row;
}
