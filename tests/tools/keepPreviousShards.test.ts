// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../core/util/encoding';
import { keepPreviousShards } from '../../tools/keep-previous-shards';

const SITE = 'https://example.github.io/repo';
let out: string;

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'qb-keep-'));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

async function shard(id: string, path: string, body: string) {
  return { id, kind: 'questions' as const, path, hash: await sha256Hex(body), count: 1 };
}

function site(files: Record<string, string>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const path = String(url).replace(`${SITE}/community/`, '');
    return path in files ? new Response(files[path], { status: 200 }) : new Response('no', { status: 404 });
  }) as typeof fetch;
}

const manifest = (shards: unknown[]) =>
  JSON.stringify({ schemaVersion: 1, generatedAt: '2026-11-13T05:59:05.015Z', dataCommit: 'abc', shards, counts: { questions: 0, subjects: 0, users: 0, answers: 0, competitions: 0 }, quarantined: 0 });

describe('conservar los fragmentos de la versión publicada', () => {
  it('copia los que faltan, deja los que ya están y descarta los que no cuadran con su hash', async () => {
    const viejo = await shard('taxonomy', 'taxonomy.aaaaaaaaaaaa.json', '[1]');
    const presente = await shard('q/s/0', 'q/s/0.bbbbbbbbbbbb.json', '[2]');
    const corrupto = { ...(await shard('q/s/1', 'q/s/1.cccccccccccc.json', '[3]')), hash: 'f'.repeat(64) };
    mkdirSync(join(out, 'q/s'), { recursive: true });
    writeFileSync(join(out, 'q/s/0.bbbbbbbbbbbb.json'), 'nuevo');

    const kept = await keepPreviousShards(`${SITE}/`, out, site({
      'manifest.json': manifest([viejo, presente, corrupto]),
      'taxonomy.aaaaaaaaaaaa.json': '[1]',
      'q/s/0.bbbbbbbbbbbb.json': '[2]',
      'q/s/1.cccccccccccc.json': '[3]',
    }));

    expect(kept).toBe(1);
    expect(readFileSync(join(out, 'taxonomy.aaaaaaaaaaaa.json'), 'utf8')).toBe('[1]');
    expect(readFileSync(join(out, 'q/s/0.bbbbbbbbbbbb.json'), 'utf8')).toBe('nuevo');
    expect(existsSync(join(out, 'q/s/1.cccccccccccc.json'))).toBe(false);
  });

  it('en la primera publicación no hace nada', async () => {
    expect(await keepPreviousShards(SITE, out, site({}))).toBe(0);
  });

  it('no escribe fuera de la carpeta aunque el manifiesto lo pida', async () => {
    const fuera = await shard('x', '../fuera.json', '[9]');
    const kept = await keepPreviousShards(SITE, out, site({ 'manifest.json': manifest([fuera]), '../fuera.json': '[9]' }));
    expect(kept).toBe(0);
    expect(existsSync(join(out, '..', 'fuera.json'))).toBe(false);
  });
});
