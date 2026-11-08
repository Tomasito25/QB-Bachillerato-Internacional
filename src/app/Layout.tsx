import { Download, Menu, Plus, RefreshCw, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { config } from '@/infra/config';
import { online } from '@/infra/connectivity';
import { installUpdate, updateAvailable } from '@/infra/pwa/pwa';
import { Button, ButtonLink } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { monogram } from '@/ui/marks';
import { Toaster } from '@/ui/toast';
import { WelcomeTour } from '@/features/guide/WelcomeTour';
import { preferences } from '@/features/settings/preferences';
import { CREATE_ITEM, navFor, type NavGroup, type NavItem } from './nav';
import { SyncStatus } from './SyncStatus';

function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" aria-label={`${config.appName}: inicio`} title={config.appName} className={cn('qb-display inline-flex w-fit text-[2.75rem] font-black', className)}>
      {monogram(config.appName)}
    </Link>
  );
}

function SideLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn('flex h-9 shrink-0 items-center px-6 text-sm font-semibold transition-colors', isActive ? 'bg-accent text-accent-ink' : 'text-rail-ink hover:bg-white/15')}
    >
      {item.label}
    </NavLink>
  );
}

function Sidebar({ groups }: { groups: NavGroup[] }) {
  return (
    <aside className="qb-rail sticky top-0 hidden h-dvh flex-col bg-rail text-rail-ink lg:flex dark:border-r dark:border-border">
      <div className="flex flex-col gap-5 px-6 pt-6 pb-3">
        <Logo />
        <ButtonLink to={CREATE_ITEM.to} variant="plate" className="justify-start" icon={<Plus size={16} aria-hidden />}>
          {CREATE_ITEM.label}
        </ButtonLink>
      </div>
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {groups.map((group) => (
          <div key={group.label ?? 'inicio'} role="group" aria-label={group.label} className="flex flex-col pt-4">
            {group.label ? <p className="px-6 pb-1 text-xs font-semibold text-rail-muted">{group.label}</p> : null}
            {group.items.map((item) => (
              <SideLink key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>
      <div className="px-6 py-3">
        <SyncStatus />
      </div>
    </aside>
  );
}

function BottomItem({ item }: { item: Pick<NavItem, 'icon' | 'label'> }) {
  const Icon = item.icon;
  return (
    <>
      <Icon size={21} strokeWidth={2} aria-hidden />
      <span className="text-xs font-semibold">{item.label}</span>
    </>
  );
}

const bottomCell = (active: boolean) => cn('flex h-16 flex-col items-center justify-center gap-1', active ? 'bg-accent text-accent-ink' : 'text-rail-ink');

function BottomNav({ items, onMore, moreOpen }: { items: NavItem[]; onMore: () => void; moreOpen: boolean }) {
  return (
    <nav aria-label="Principal" className="qb-rail safe-bottom fixed inset-x-0 bottom-0 z-30 bg-rail lg:hidden dark:border-t dark:border-border">
      <div className="grid grid-cols-5">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => bottomCell(isActive && !moreOpen)}>
            <BottomItem item={item} />
          </NavLink>
        ))}
        <button type="button" onClick={onMore} aria-expanded={moreOpen} className={bottomCell(moreOpen)}>
          <BottomItem item={{ icon: Menu, label: 'Más' }} />
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
      className="mt-auto mb-0 w-full max-w-none border-t-2 border-ink bg-surface p-0 lg:hidden"
    >
      {open ? (
        <div className="safe-bottom">
          <div className="flex items-center justify-between border-b-2 border-ink px-4 py-2.5">
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
                    cn('flex h-12 items-center gap-3 px-3 text-sm font-bold', isActive ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-subtle')
                  }
                >
                  <Icon size={18} strokeWidth={2} aria-hidden />
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
  const [moreOpen, setMoreOpen] = useState(false);
  const focus = isFocusRoute(useLocation().pathname);
  const nav = navFor(preferences.use().studyOnly);
  return (
    <div className={cn('min-h-dvh', !focus && 'lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)]')}>
      <a href="#main" className="sr-only bg-signal px-3 py-2 font-bold text-signal-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
        Saltar al contenido
      </a>
      {focus ? null : <Sidebar groups={nav.groups} />}
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
        <main id="main" tabIndex={-1} className={cn('qb-main w-full flex-1 px-[var(--gutter)] pt-[var(--page-top)] outline-none', focus ? 'mx-auto flex max-w-2xl flex-col pb-6' : 'pb-28 lg:pb-12')}>
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
