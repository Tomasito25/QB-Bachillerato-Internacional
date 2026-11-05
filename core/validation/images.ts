/** Identifica el tipo real por sus primeros bytes. La extensión del nombre no prueba nada. */
export function sniffImage(bytes: Uint8Array): 'webp' | 'png' | 'jpg' | null {
  const at = (offset: number, signature: readonly number[]) => signature.every((value, i) => bytes[offset + i] === value);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  return null;
}
