// @vitest-environment node
// core/ corre en Node dentro de Actions: se prueba en ese mismo entorno.
import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url, gunzip, gzip, sha256Hex } from '@core/util/encoding';
import { seededRandom, shuffle } from '@core/util/rng';
import { dayKey, monthKey, startOfIsoWeek, weekKey } from '@core/util/time';

describe('base64url', () => {
  it('ida y vuelta con todos los valores de byte', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = bytesToBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(text)).toEqual(bytes);
  });

  it('funciona con longitudes que necesitarían relleno', () => {
    for (const length of [0, 1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i + 200);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
  });
});

describe('gzip', () => {
  it('ida y vuelta', async () => {
    const data = new TextEncoder().encode('¿Cuál es? '.repeat(500));
    const compressed = await gzip(data);
    expect(compressed.length).toBeLessThan(data.length);
    expect(await gunzip(compressed)).toEqual(data);
  });

  it('corta una bomba de descompresión', async () => {
    const bomb = await gzip(new Uint8Array(2 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(10 * 1024);
    await expect(gunzip(bomb, 1024 * 1024)).rejects.toThrow(/supera/);
  });

  it('rechaza lo que no es gzip', async () => {
    await expect(gunzip(new TextEncoder().encode('no soy gzip'))).rejects.toThrow();
  });
});

describe('sha256', () => {
  it('coincide con el vector conocido', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('azar con semilla', () => {
  it('misma semilla, misma secuencia', () => {
    const a = seededRandom('semilla');
    const b = seededRandom('semilla');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('otra semilla, otra secuencia', () => {
    expect(seededRandom('uno')()).not.toBe(seededRandom('dos')());
  });

  it('barajar es reproducible y no pierde elementos', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const first = shuffle(items, seededRandom('s'));
    expect(first).toEqual(shuffle(items, seededRandom('s')));
    expect([...first].sort((x, y) => x - y)).toEqual(items);
    expect(first).not.toEqual(items);
  });
});

describe('tiempo', () => {
  it('semana ISO, incluidos los bordes de año', () => {
    expect(weekKey(Date.UTC(2026, 10, 5))).toBe('2026-W45');
    expect(weekKey(Date.UTC(2021, 0, 3))).toBe('2020-W53');
    expect(weekKey(Date.UTC(2024, 11, 30))).toBe('2025-W01');
    expect(weekKey(Date.UTC(2026, 0, 1))).toBe('2026-W01');
  });

  it('la semana empieza en lunes', () => {
    expect(new Date(startOfIsoWeek(Date.UTC(2026, 10, 8))).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(new Date(startOfIsoWeek(Date.UTC(2026, 10, 2))).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('claves de día y mes en UTC', () => {
    const ms = Date.UTC(2026, 10, 5, 23, 59);
    expect(dayKey(ms)).toBe('2026-11-05');
    expect(monthKey(ms)).toBe('2026-11');
  });
});
