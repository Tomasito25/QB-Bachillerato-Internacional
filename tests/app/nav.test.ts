import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, navFor, sectionOf } from '@/app/nav';

const allPaths = (sections: typeof NAV_SECTIONS) => sections.flatMap((section) => [section.to, ...section.pages.map((page) => page.to)]);

describe('menús', () => {
  it('el menú no pasa de cinco entradas y no repite páginas', () => {
    expect(NAV_SECTIONS.length).toBeLessThanOrEqual(5);
    const pages = NAV_SECTIONS.flatMap((section) => section.pages.map((page) => page.to));
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('cada sección abre una de sus propias pestañas', () => {
    for (const section of NAV_SECTIONS) {
      if (section.pages.length > 0) expect(section.pages[0]?.to).toBe(section.to);
    }
  });

  it('con «Sólo estudiar» no hay competiciones, rankings ni amigos', () => {
    expect(navFor(false)).toBe(NAV_SECTIONS);
    const paths = allPaths(navFor(true));
    for (const social of ['/competitions', '/leaderboards', '/friends']) expect(paths).not.toContain(social);
  });

  it.each([
    ['/', 'Inicio'],
    ['/study', 'Estudiar'],
    ['/study/session/abc/results', 'Estudiar'],
    ['/calendar', 'Estudiar'],
    ['/q/abc/edit', 'Preguntas'],
    ['/explore/abc', 'Preguntas'],
    ['/create', 'Preguntas'],
    ['/competitions/abc', 'Comunidad'],
    ['/u/ana', 'Comunidad'],
    ['/sync', 'Ajustes'],
  ])('%s está en %s', (pathname, label) => {
    expect(sectionOf(pathname, NAV_SECTIONS)?.label).toBe(label);
  });

  it('una ruta que no está en el menú no marca ninguna sección', () => {
    expect(sectionOf('/competitions', navFor(true))).toBeUndefined();
    expect(sectionOf('/studying', NAV_SECTIONS)).toBeUndefined();
  });
});
