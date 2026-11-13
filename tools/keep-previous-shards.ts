import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Manifest } from '../core/schema/derived.ts';
import { sha256Hex } from '../core/util/encoding.ts';

/**
 * Copia en la versión nueva los fragmentos de la versión publicada que ya no existen en ella.
 *
 * El CDN de Pages sirve `manifest.json` hasta 10 minutos después de un despliegue, y no se puede
 * saltar esa caché. Quien recibe el manifiesto viejo pide fragmentos con el hash anterior en el
 * nombre; si el despliegue los ha borrado, ve un 404. Con esto, durante ese rato, siguen ahí.
 */
export async function keepPreviousShards(site: string, outDir: string, get: typeof fetch = fetch): Promise<number> {
  const base = `${site.replace(/\/+$/, '')}/community/`;
  const response = await get(`${base}manifest.json`, { cache: 'no-store' });
  // Primera publicación o sitio caído: no hay nada que conservar.
  if (!response.ok) return 0;
  const parsed = Manifest.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return 0;

  const root = resolve(outDir);
  let kept = 0;
  for (const shard of parsed.data.shards) {
    const file = resolve(root, shard.path);
    if (!file.startsWith(root + sep)) continue; // la ruta no puede salir de la carpeta
    if (await access(file).then(() => true, () => false)) continue;
    const old = await get(base + shard.path);
    if (!old.ok) continue;
    const text = await old.text();
    // El CDN también puede guardar copias viejas: sólo se conserva lo que cuadra con su hash.
    if ((await sha256Hex(text)) !== shard.hash) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    kept += 1;
  }
  return kept;
}

async function main() {
  const { values } = parseArgs({ options: { site: { type: 'string' }, out: { type: 'string', default: 'dist/community' } } });
  if (!values.site) throw new Error('Falta --site con la URL del sitio publicado.');
  const kept = await keepPreviousShards(values.site, values.out);
  console.log(`Fragmentos de la versión anterior conservados: ${kept}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
