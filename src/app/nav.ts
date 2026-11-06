import {
  BarChart3,
  Compass,
  FolderTree,
  GraduationCap,
  House,
  Library,
  PencilLine,
  RefreshCw,
  Settings,
  Swords,
  Trophy,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** Barra lateral: primero lo de cada día; crear pregunta es un botón aparte. */
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Inicio', icon: House, end: true },
      { to: '/study', label: 'Estudiar', icon: GraduationCap },
      { to: '/explore', label: 'Explorar', icon: Compass },
      { to: '/competitions', label: 'Competiciones', icon: Swords },
      { to: '/leaderboards', label: 'Rankings', icon: Trophy },
    ],
  },
  {
    label: 'Contenido',
    items: [
      { to: '/bank', label: 'Banco de preguntas', icon: Library },
      { to: '/subjects', label: 'Temario', icon: FolderTree },
    ],
  },
  {
    label: 'Tú',
    items: [
      { to: '/stats', label: 'Estadísticas', icon: BarChart3 },
      { to: '/profile', label: 'Perfil', icon: User },
      { to: '/sync', label: 'Sincronización', icon: RefreshCw },
      { to: '/settings', label: 'Configuración', icon: Settings },
    ],
  },
];

export const CREATE_ITEM: NavItem = { to: '/create', label: 'Nueva pregunta', icon: PencilLine };

/** Barra inferior del móvil: lo más frecuente. Lo demás, en «Más». */
export const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'Inicio', icon: House, end: true },
  { to: '/explore', label: 'Explorar', icon: Compass },
  { to: '/study', label: 'Estudiar', icon: GraduationCap },
  { to: '/competitions', label: 'Competir', icon: Swords },
];

export const MOBILE_MORE_NAV: NavItem[] = [CREATE_ITEM, ...NAV_GROUPS.flatMap((group) => group.items).filter((item) => !MOBILE_NAV.some((m) => m.to === item.to))];
