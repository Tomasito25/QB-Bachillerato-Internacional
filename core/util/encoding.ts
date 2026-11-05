/** Codificación binaria común al navegador y a Node. */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64url: no necesita escaparse en una URL, y eso importa con un límite de 6 000 caracteres. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function collect(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`El contenido descomprimido supera ${maxBytes} bytes`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function transform(data: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }) {
  const writer = stream.writable.getWriter();
  // Un fallo de escritura también aparece al leer: aquí sólo se evita el rechazo sin atender.
  writer.write(data).then(() => writer.close()).catch(() => undefined);
  return stream.readable as ReadableStream<Uint8Array>;
}

export function gzip(data: Uint8Array): Promise<Uint8Array> {
  return collect(transform(data, new CompressionStream('gzip')), Number.MAX_SAFE_INTEGER);
}

/**
 * Descomprime con tope. El cuerpo de un issue es entrada no confiable y, sin límite, unos
 * pocos KB pueden expandirse a varios GB y tumbar la Action (bomba de descompresión).
 */
export function gunzip(data: Uint8Array, maxBytes = 8 * 1024 * 1024): Promise<Uint8Array> {
  return collect(transform(data, new DecompressionStream('gzip')), maxBytes);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
