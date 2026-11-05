import { kvDelete, kvGet, kvSet } from '@/infra/db/db';

/**
 * Dónde vive el token de GitHub, si el usuario decide usar uno.
 *
 * - Nunca en el bundle ni en localStorage.
 * - Por defecto, sólo en memoria: se pierde al cerrar la pestaña.
 * - Con «recordar», cifrado con AES-GCM. La clave es una `CryptoKey` no extraíble guardada en
 *   IndexedDB: el navegador la usa, pero ni un script puede leer sus bytes.
 *
 * Qué protege y qué no: evita que el token aparezca en claro en una copia del perfil del
 * navegador o en un volcado de almacenamiento. NO protege de un XSS activo, que podría pedir
 * descifrarlo. Contra eso están la CSP y el saneamiento de contenido.
 */

const KEY_NAME = 'vault-key';
const TOKEN_NAME = 'vault-token';

interface StoredToken {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

let memoryToken: string | null = null;

export function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(key: CryptoKey, token: string): Promise<StoredToken> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(token));
  return { iv, ciphertext };
}

export async function decryptToken(key: CryptoKey, stored: StoredToken): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as BufferSource }, key, stored.ciphertext);
  return new TextDecoder().decode(plain);
}

export async function setToken(token: string, remember: boolean): Promise<void> {
  memoryToken = token;
  if (!remember) {
    await forgetStoredToken();
    return;
  }
  const key = (await kvGet<CryptoKey>(KEY_NAME)) ?? (await generateVaultKey());
  await kvSet(KEY_NAME, key);
  await kvSet(TOKEN_NAME, await encryptToken(key, token));
}

async function forgetStoredToken(): Promise<void> {
  await kvDelete(TOKEN_NAME);
  await kvDelete(KEY_NAME);
}

export async function getToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  const [key, stored] = await Promise.all([kvGet<CryptoKey>(KEY_NAME), kvGet<StoredToken>(TOKEN_NAME)]);
  if (!key || !stored) return null;
  try {
    memoryToken = await decryptToken(key, stored);
    return memoryToken;
  } catch {
    await forgetStoredToken();
    return null;
  }
}

export async function hasRememberedToken(): Promise<boolean> {
  return (await kvGet(TOKEN_NAME)) !== undefined;
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  await forgetStoredToken();
}
