import { describe, expect, it } from 'vitest';
import { CREATE_ITEM, MOBILE_NAV, NAV_GROUPS, navFor } from '@/app/nav';

const SOCIAL = ['/competitions', '/leaderboards', '/friends'];
const paths = (items: { to: string }[]) => items.map((item) => item.to);

describe('menús', () => {
  it('sin «Sólo estudiar» están todos', () => {
    const nav = navFor(false);
    expect(nav.groups).toBe(NAV_GROUPS);
    expect(nav.mobile).toBe(MOBILE_NAV);
  });

  it('con «Sólo estudiar» no hay competiciones, rankings ni amigos en ningún menú', () => {
    const nav = navFor(true);
    const all = [...nav.groups.flatMap((group) => group.items), ...nav.mobile, ...nav.more];
    expect(paths(all).filter((to) => SOCIAL.includes(to))).toEqual([]);
    // El hueco de «Competir» en la barra del móvil lo ocupa el banco.
    expect(paths(nav.mobile)).toEqual(['/', '/explore', '/study', '/bank']);
  });

  it('«Más» tiene lo que no cabe abajo, sin repetir, y empieza por crear', () => {
    for (const studyOnly of [false, true]) {
      const nav = navFor(studyOnly);
      const more = paths(nav.more);
      expect(more[0]).toBe(CREATE_ITEM.to);
      expect(more.filter((to) => paths(nav.mobile).includes(to))).toEqual([]);
      expect(new Set(more).size).toBe(more.length);
      expect(more).toContain('/guide');
    }
  });
});
