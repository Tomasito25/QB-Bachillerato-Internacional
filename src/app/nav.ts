import {
  Compass,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  Library,
  PencilLine,
  RefreshCw,
  Settings,
  Swords,
  Trophy,
  User,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/explore', label: 'Explorar', icon: Compass },
  { to: '/bank', label: 'Banco de preguntas', icon: Library },
  { to: '/create', label: 'Crear pregunta', icon: PencilLine },
  { to: '/study', label: 'Estudiar', icon: GraduationCap },
  { to: '/competitions', label: 'Competiciones', icon: Swords },
  { to: '/leaderboards', label: 'Rankings', icon: Trophy },
];

export const SECONDARY_NAV: NavItem[] = [
  { to: '/subjects', label: 'Temario', icon: FolderTree },
  { to: '/stats', label: 'Estadísticas', icon: BarChart3 },
  { to: '/sync', label: 'Sincronización', icon: RefreshCw },
  { to: '/profile', label: 'Perfil', icon: User },
  { to: '/settings', label: 'Configuración', icon: Settings },
];

/** Barra inferior del móvil: lo más frecuente. Lo demás, en «Más». */
export const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/explore', label: 'Explorar', icon: Compass },
  { to: '/study', label: 'Estudiar', icon: GraduationCap },
  { to: '/competitions', label: 'Competir', icon: Swords },
];

export const MOBILE_MORE_NAV: NavItem[] = [
  { to: '/bank', label: 'Banco de preguntas', icon: Library },
  { to: '/create', label: 'Crear pregunta', icon: PencilLine },
  { to: '/leaderboards', label: 'Rankings', icon: Trophy },
  ...SECONDARY_NAV,
];
