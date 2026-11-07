import { Download, Menu, Plus, RefreshCw, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { config } from '@/infra/config';
import { online } from '@/infra/connectivity';
import { installUpdate, updateAvailable } from '@/infra/pwa/pwa';
import { Button, ButtonLink } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Toaster } from '@/ui/toast';
import { WelcomeTour } from '@/features/guide/WelcomeTour';
import { preferences } from '@/features/settings/preferences';
import { CREATE_ITEM, navFor, type NavGroup, type NavItem } from './nav';
import { SyncStatus } from './SyncStatus';

function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex min-w-0 items-center gap-2 rounded-md font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden>
        <rect width="512" height="512" rx="112" fill="var(--accent)" />
        <circle cx="242" cy="238" r="116" fill="none" stroke="var(--accent-ink)" strokeWidth="46" />
        <path d="M306 302L394 390" fill="none" stroke="var(--accent-ink)" strokeWidth="46" strokeLinecap="round" />
      </svg>
      <span className="truncate">{config.appName}</span>
    </Link>
  );
}

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn('flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors', isActive ? 'bg-subtle text-ink' : 'text-muted hover:bg-subtle hover:text-ink')
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={17} strokeWidth={isActive ? 2.1 : 1.75} className={isActive ? 'text-accent-text' : undefined} aria-hidden />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-canvas lg:flex">
      <div className="flex flex-col gap-5 px-4 pt-5 pb-2">
        <Logo />
        <ButtonLink to={CREATE_ITEM.to} variant="primary" icon={<Plus size={16} aria-hidden />}>
          {CREATE_ITEM.label}
        </ButtonLink>
      </div>
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.label ?? 'inicio'} role="group" aria-label={group.label} className="flex flex-col gap-0.5 pt-4">
            {group.label ? <p className="px-2.5 pb-1 text-xs font-medium text-faint">{group.label}</p> : null}
            {group.items.map((item) => (
              <SideLink key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-3">
        <SyncStatus />
      </div>
    </aside>
  );
}

/** Icono en una píldora cuando está activo: se ve de un vistazo dónde estás. */
function BottomItem({ item, active }: { item: Pick<NavItem, 'icon' | 'label'>; active: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <span className={cn('flex h-7 w-14 items-center justify-center rounded-full transition-colors', active ? 'bg-accent-soft text-accent-text' : 'text-muted')}>
        <Icon size={20} strokeWidth={active ? 2.1 : 1.75} aria-hidden />
      </span>
      <span className={cn('text-xs font-medium', active ? 'text-ink' : 'text-muted')}>{item.label}</span>
    </>
  );
}

function BottomNav({ items, onMore, moreOpen }: { items: NavItem[]; onMore: () => void; moreOpen: boolean }) {
  return (
    <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur-md lg:hidden">
      <div className="grid grid-cols-5">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="flex h-16 flex-col items-center justify-center gap-1">
            {({ isActive }) => <BottomItem item={item} active={isActive && !moreOpen} />}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} aria-expanded={moreOpen} className="flex h-16 flex-col items-center justify-center gap-1">
          <BottomItem item={{ icon: Menu, label: 'Más' }} active={moreOpen} />
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ items, open, onClose }: { items: NavItem[]; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Más opciones"
      className="mt-auto mb-0 w-full max-w-none rounded-t-xl border-t border-border bg-surface p-0 lg:hidden"
    >
      {open ? (
        <div className="safe-bottom">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <SyncStatus />
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
              <X size={16} aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn('flex h-12 items-center gap-3 rounded-md px-3 text-sm font-medium', isActive ? 'bg-subtle text-ink' : 'text-muted hover:bg-subtle')
                  }
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function Banners() {
  const isOnline = online.use();
  const hasUpdate = updateAvailable.use();
  return (
    <>
      {!isOnline ? (
        <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-xs font-medium text-warning">
          <WifiOff size={14} aria-hidden />
          Sin conexión. Puedes seguir estudiando: lo que hagas se guarda aquí y se envía después.
        </div>
      ) : null}
      {hasUpdate ? (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-accent-soft px-4 py-1.5 text-xs font-medium text-accent-text">
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
  const [moreOpen, setMoreOpen] = useState(false);
  const focus = isFocusRoute(useLocation().pathname);
  const nav = navFor(preferences.use().studyOnly);
  return (
    <div className={cn('min-h-dvh', !focus && 'lg:grid lg:grid-cols-[248px_minmax(0,1fr)]')}>
      <a href="#main" className="sr-only rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
        Saltar al contenido
      </a>
      {focus ? null : <Sidebar groups={nav.groups} />}
      <div className="flex min-h-dvh min-w-0 flex-col">
        {focus ? null : (
          <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas/90 backdrop-blur-md lg:hidden">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <Logo />
              <SyncStatus compact />
            </div>
          </header>
        )}
        <Banners />
        <main id="main" tabIndex={-1} className={cn('mx-auto w-full flex-1 px-4 outline-none sm:px-6', focus ? 'safe-top flex max-w-2xl flex-col pt-5 pb-6 sm:pt-10' : 'max-w-5xl pt-6 pb-28 lg:px-10 lg:pt-10 lg:pb-12')}>
          <Outlet />
        </main>
      </div>
      {focus ? null : (
        <>
          <BottomNav items={nav.mobile} onMore={() => setMoreOpen((v) => !v)} moreOpen={moreOpen} />
          <MoreSheet items={nav.more} open={moreOpen} onClose={() => setMoreOpen(false)} />
        </>
      )}
      {focus ? null : <WelcomeTour />}
      <Toaster />
      <RouteAnnouncer />
      <ScrollRestoration />
    </div>
  );
}
