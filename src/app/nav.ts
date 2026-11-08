import { GraduationCap, House, Library, Settings, Users, type LucideIcon } from 'lucide-react';

export interface NavPage {
  to: string;
  label: string;
}

/** Una entrada del menú. Sus páginas salen como pestañas arriba: el menú no pasa de cinco. */
export interface NavSection extends NavPage {
  icon: LucideIcon;
  end?: boolean;
  pages: NavPage[];
  /** Rutas de detalle que pertenecen a la sección sin ser una pestaña. */
  also?: string[];
}

export const CREATE_ITEM: NavPage = { to: '/create', label: 'Nueva pregunta' };

export const NAV_SECTIONS: NavSection[] = [
  { to: '/', label: 'Inicio', icon: House, end: true, pages: [] },
  {
    to: '/study',
    label: 'Estudiar',
    icon: GraduationCap,
    pages: [
      { to: '/study', label: 'Estudiar' },
      { to: '/mocks', label: 'Simulacros' },
      { to: '/calendar', label: 'Calendario' },
      { to: '/stats', label: 'Estadísticas' },
    ],
  },
  {
    to: '/explore',
    label: 'Preguntas',
    icon: Library,
    also: ['/q/'],
    pages: [
      { to: '/explore', label: 'Explorar' },
      { to: '/bank', label: 'Banco' },
      { to: '/subjects', label: 'Temario' },
      { to: '/formulas', label: 'Formulario' },
      CREATE_ITEM,
    ],
  },
  {
    to: '/competitions',
    label: 'Comunidad',
    icon: Users,
    also: ['/u/'],
    pages: [
      { to: '/competitions', label: 'Competiciones' },
      { to: '/leaderboards', label: 'Rankings' },
      { to: '/friends', label: 'Amigos' },
    ],
  },
  {
    to: '/settings',
    label: 'Ajustes',
    icon: Settings,
    pages: [
      { to: '/settings', label: 'Configuración' },
      { to: '/sync', label: 'Sincronización' },
      { to: '/profile', label: 'Perfil' },
      { to: '/guide', label: 'Guía' },
    ],
  },
];

/** Con «Sólo estudiar» no hay comunidad en los menús; sus páginas siguen a un enlace de distancia. */
export function navFor(studyOnly: boolean): NavSection[] {
  return studyOnly ? NAV_SECTIONS.filter((section) => section.to !== '/competitions') : NAV_SECTIONS;
}

const within = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

export function sectionOf(pathname: string, sections: readonly NavSection[]): NavSection | undefined {
  if (pathname === '/') return sections[0];
  return sections.find((section) => section.pages.some((page) => within(pathname, page.to)) || section.also?.some((prefix) => pathname.startsWith(prefix)));
}
