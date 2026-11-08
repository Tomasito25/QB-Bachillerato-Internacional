import { base64UrlToBytes, bytesToBase64Url } from '@core/util/encoding';

/**
 * Vincular un dispositivo nuevo sin teclear el token. El enlace lleva los datos cifrados con un
 * código que se escribe a mano: así el enlace solo, aunque quede en un historial, no sirve de nada.
 * Va en el fragmento de la URL, que el navegador no envía a ningún servidor.
 */
export interface DeviceLink {
  token: string;
  gistId: string;
  /** Clave AES-256 de los datos, en base64url. */
  key: string;
}

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Sin 0, O, 1 ni I, que se confunden al copiarlos de una pantalla. 32 símbolos: 40 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function newPairingCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export const normalizeCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealLink(link: DeviceLink, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(normalizeCode(code), salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(link))));
  return bytesToBase64Url(new Uint8Array([...salt, ...iv, ...cipher]));
}

export async function openLink(sealed: string, code: string): Promise<DeviceLink> {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(sealed.trim());
  } catch {
    throw new PairingError('El enlace no está completo.');
  }
  if (bytes.length <= SALT_BYTES + IV_BYTES) throw new PairingError('El enlace no está completo.');
  const key = await deriveKey(normalizeCode(code), bytes.slice(0, SALT_BYTES));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES) as BufferSource }, key, bytes.slice(SALT_BYTES + IV_BYTES) as BufferSource);
    const link = JSON.parse(new TextDecoder().decode(plain)) as DeviceLink;
    if (typeof link.token !== 'string' || typeof link.gistId !== 'string' || typeof link.key !== 'string') throw new Error('incompleto');
    return link;
  } catch {
    throw new PairingError('El código no coincide con este enlace.');
  }
}

/** Acepta el enlace entero o sólo lo que va detrás de `#pair=`. */
export const sealedFromInput = (input: string): string => input.trim().replace(/^.*#pair=/, '');

export const pairingUrl = (sealed: string): string => new URL(`${import.meta.env.BASE_URL}sync#pair=${sealed}`, window.location.origin).href;
