// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Comprobaciones sobre el propio código. Protegen decisiones de seguridad que un cambio
 * inocente podría deshacer sin que falle ninguna otra prueba.
 */

const ROOT = join(__dirname, '../..');

function walk(dir: string, predicate: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === '.data' || name === 'community') return [];
    return statSync(full).isDirectory() ? walk(full, predicate) : predicate(name) ? [full] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const workflows = walk(join(ROOT, '.github'), (name) => /\.ya?ml$/.test(name));
const sources = walk(join(ROOT, 'src'), (name) => /\.tsx?$/.test(name));

describe('workflows de GitHub', () => {
  it.each(workflows.map((f) => [relative(ROOT, f), f]))('%s fija cada acción a un commit exacto', (_name, file) => {
    for (const match of read(file as string).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      const target = match[1] as string;
      if (target.startsWith('./')) continue;
      expect(target, `${target} debe ir fijada por SHA: una etiqueta se puede mover`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it.each(workflows.map((f) => [relative(ROOT, f), f]))('%s no mete datos del usuario en un shell', (_name, file) => {
    const text = read(file as string);
    // `run:` con expresiones que el usuario controla es inyección de comandos directa.
    const dangerous = /\$\{\{\s*github\.(event\.(issue|pull_request|comment|head_commit|review)|head_ref)[^}]*\}\}/g;
    for (const line of text.split('\n')) {
      if (/^\s*if:/.test(line)) continue;
      expect(line, `Expresión peligrosa en ${file}`).not.toMatch(dangerous);
    }
  });

  it('la revisión de PR nunca hace checkout del código del PR', () => {
    const text = read(join(ROOT, '.github/workflows/review-pr.yml'));
    expect(text).toContain('pull_request_target');
    const code = text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/github\.event\.pull_request\.head/);
    expect(code).not.toMatch(/refs\/pull\//);
    expect(code).not.toMatch(/github\.head_ref/);
  });

  it('declaran permisos explícitos', () => {
    for (const file of workflows.filter((f) => f.includes('/workflows/'))) {
      expect(read(file), file).toMatch(/^permissions:/m);
    }
  });

  it('el despliegue no da permisos de escritura al código que compila', () => {
    const text = read(join(ROOT, '.github/workflows/deploy.yml'));
    expect(text.split('jobs:')[0]).toMatch(/contents: read/);
    expect(text.split('jobs:')[0]).not.toMatch(/write/);
  });

  it('los escritores de datos instalan sin scripts y comparten cola', () => {
    for (const name of ['intake', 'review-pr', 'scheduler']) {
      const text = read(join(ROOT, `.github/workflows/${name}.yml`));
      expect(text).toContain('npm ci --ignore-scripts');
      expect(text).toContain('group: data-writer');
      expect(text).toContain('queue: max');
    }
  });
});

describe('código de la app', () => {
  it('el HTML generado sólo se inserta en un sitio, y va saneado', () => {
    const users = sources.filter((file) => read(file).includes('dangerouslySetInnerHTML'));
    expect(users.map((f) => relative(ROOT, f))).toEqual(['src/infra/markdown/Markdown.tsx']);
  });

  it('nadie usa innerHTML ni eval', () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, file).not.toMatch(/\.innerHTML\s*=/);
      expect(text, file).not.toMatch(/\beval\(/);
      expect(text, file).not.toMatch(/new Function\(/);
    }
  });

  it('localStorage sólo guarda el tema', () => {
    const users = sources.filter((file) => /localStorage\.\w+\(/.test(read(file)));
    expect(users.map((f) => relative(ROOT, f))).toEqual(['src/features/settings/preferences.ts']);
    expect(read(join(ROOT, 'src/features/settings/preferences.ts')).match(/localStorage\.\w+\(([^,)]+)/)?.[1]).toBe("'qb-theme'");
  });

  it('no hay credenciales escritas en el código', () => {
    const everything = [...sources, ...walk(join(ROOT, 'core'), (n) => n.endsWith('.ts')), ...walk(join(ROOT, 'tools'), (n) => /\.(ts|sh)$/.test(n)), ...workflows];
    for (const file of everything) {
      expect(read(file), file).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/);
    }
  });

  it('sólo se exponen al cliente variables públicas', () => {
    const used = new Set(sources.flatMap((file) => [...read(file).matchAll(/import\.meta\.env\.(\w+)/g)].map((m) => m[1])));
    expect([...used].sort()).toEqual(['BASE_URL', 'VITE_COMMUNITY_REPO']);
  });

  it('core no depende del navegador ni de Node', () => {
    for (const file of walk(join(ROOT, 'core'), (n) => n.endsWith('.ts'))) {
      const text = read(file);
      expect(text, file).not.toMatch(/from 'node:/);
      expect(text, file).not.toMatch(/from '(react|dexie)/);
      expect(text, file).not.toMatch(/from '@\//);
    }
  });

  it('la app declara una CSP estricta', () => {
    const config = read(join(ROOT, 'vite.config.ts'));
    const policy = config.slice(config.indexOf('CONTENT_SECURITY_POLICY = ['), config.indexOf("].join('; ')"));
    expect(policy).toContain(`"script-src 'self'"`);
    expect(policy).toContain(`"object-src 'none'"`);
    expect(policy).toContain(`"base-uri 'self'"`);
    expect(policy).toContain(`"connect-src 'self' https://api.github.com https://gist.githubusercontent.com"`);
    expect(policy).not.toMatch(/script-src[^"]*unsafe/);
    expect(policy).not.toMatch(/img-src[^"]*\bdata:/);
  });
});
