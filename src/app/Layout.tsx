import { Download, Plus, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { config } from '@/infra/config';
import { online } from '@/infra/connectivity';
import { installUpdate, updateAvailable } from '@/infra/pwa/pwa';
import { ButtonLink } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { monogram } from '@/ui/marks';
import { Toaster } from '@/ui/toast';
import { WelcomeTour } from '@/features/guide/WelcomeTour';
import { preferences } from '@/features/settings/preferences';
import { CREATE_ITEM, navFor, sectionOf, type NavSection } from './nav';
import { SyncStatus } from './SyncStatus';

function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" aria-label={`${config.appName}: inicio`} title={config.appName} className={cn('qb-display inline-flex w-fit text-[2.75rem] font-black', className)}>
      {monogram(config.appName)}
    </Link>
  );
}

function Sidebar({ sections, current }: { sections: NavSection[]; current?: NavSection }) {
  return (
    <aside className="qb-rail sticky top-0 hidden h-dvh flex-col bg-rail text-rail-ink lg:flex dark:border-r dark:border-border">
      <div className="flex flex-col gap-5 px-6 pt-6 pb-3">
        <Logo />
        <ButtonLink to={CREATE_ITEM.to} variant="plate" className="justify-start" icon={<Plus size={16} aria-hidden />}>
          {CREATE_ITEM.label}
        </ButtonLink>
      </div>
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 pb-3">
        {sections.map((section) => (
          <Link key={section.to} to={section.to} aria-current={section === current ? 'page' : undefined} className={cn('flex h-12 shrink-0 items-center px-6 text-[0.9375rem] font-bold transition-colors', section === current ? 'bg-accent text-accent-ink' : 'text-rail-ink hover:bg-white/15')}>
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="px-6 py-3">
        <SyncStatus />
      </div>
    </aside>
  );
}

function BottomNav({ sections, current }: { sections: NavSection[]; current?: NavSection }) {
  return (
    <nav aria-label="Principal" className="qb-rail safe-bottom fixed inset-x-0 bottom-0 z-30 bg-rail lg:hidden dark:border-t dark:border-border">
      <div className="grid auto-cols-fr grid-flow-col">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.to} to={section.to} aria-current={section === current ? 'page' : undefined} className={cn('flex h-16 flex-col items-center justify-center gap-1', section === current ? 'bg-accent text-accent-ink' : 'text-rail-ink')}>
              <Icon size={21} strokeWidth={2} aria-hidden />
              <span className="text-xs font-semibold">{section.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Lo que antes eran entradas sueltas del menú: las páginas de la sección en la que estás. */
function SectionTabs({ section }: { section: NavSection }) {
  return (
    <nav aria-label={section.label} className="flex overflow-x-auto border-b-2 border-ink bg-surface sm:px-2 lg:px-6">
      {section.pages.map((page) => (
        <NavLink key={page.to} to={page.to} className={({ isActive }) => cn('flex h-11 shrink-0 items-center px-4 text-sm font-bold whitespace-nowrap transition-colors', isActive ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-subtle')}>
          {page.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Banners() {
  const isOnline = online.use();
  const hasUpdate = updateAvailable.use();
  return (
    <>
      {!isOnline ? (
        <div role="status" className="flex items-center justify-center gap-2 bg-signal px-4 py-1.5 text-xs font-bold text-signal-ink">
          <WifiOff size={14} aria-hidden />
          Sin conexión. Puedes seguir estudiando: lo que hagas se guarda aquí y se envía después.
        </div>
      ) : null}
      {hasUpdate ? (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ink px-4 py-1.5 text-xs font-bold text-canvas">
          <span className="inline-flex items-center gap-1.5">
            <Download size={14} aria-hidden />
            Hay una versión nueva.
          </span>
          <button type="button" onClick={() => void installUpdate()} className="inline-flex items-center gap-1 underline underline-offset-2">
            <RefreshCw size={12} aria-hidden />
            Actualizar ahora
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Anuncia cada cambio de pantalla a los lectores de pantalla. */
function RouteAnnouncer() {
  const location = useLocation();
  const [message, setMessage] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setMessage(document.title), 100);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);
  return (
    <div aria-live="polite" aria-atomic className="sr-only">
      {message}
    </div>
  );
}

/** En una sesión de estudio no hay menús a la vista: sólo la pregunta. Se sale con «Salir». */
const isFocusRoute = (pathname: string) => /^\/study\/session\/[^/]+$/.test(pathname);

export function Layout() {
  const { pathname } = useLocation();
  const focus = isFocusRoute(pathname);
  const sections = navFor(preferences.use().studyOnly);
  const current = sectionOf(pathname, sections);
  return (
    <div className={cn('min-h-dvh', !focus && 'lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]')}>
      <a href="#main" className="sr-only bg-signal px-3 py-2 font-bold text-signal-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
        Saltar al contenido
      </a>
      {focus ? null : <Sidebar sections={sections} current={current} />}
      <div className="flex min-h-dvh min-w-0 flex-col">
        {focus ? null : (
          <header className="qb-rail safe-top sticky top-0 z-20 bg-rail text-rail-ink lg:hidden dark:border-b dark:border-border">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <Logo className="text-[2rem]" />
              <SyncStatus compact />
            </div>
          </header>
        )}
        <Banners />
        {!focus && current && current.pages.length > 0 ? <SectionTabs section={current} /> : null}
        <main id="main" tabIndex={-1} className={cn('qb-main w-full flex-1 px-[var(--gutter)] pt-[var(--page-top)] outline-none', focus ? 'mx-auto flex max-w-2xl flex-col pb-6' : 'pb-28 lg:pb-12')}>
          <Outlet />
        </main>
      </div>
      {focus ? null : <BottomNav sections={sections} current={current} />}
      {focus ? null : <WelcomeTour />}
      <Toaster />
      <RouteAnnouncer />
      <ScrollRestoration />
    </div>
  );
}
