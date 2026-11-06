import { Download, Menu, RefreshCw, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { online } from '@/infra/connectivity';
import { installUpdate, updateAvailable } from '@/infra/pwa/pwa';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Toaster } from '@/ui/toast';
import { MOBILE_MORE_NAV, MOBILE_NAV, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav';
import { SyncStatus } from './SyncStatus';

function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2 rounded-md font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden>
        <rect width="512" height="512" rx="112" fill="var(--accent)" />
        <circle cx="242" cy="238" r="116" fill="none" stroke="var(--accent-ink)" strokeWidth="46" />
        <path d="M306 302L394 390" fill="none" stroke="var(--accent-ink)" strokeWidth="46" strokeLinecap="round" />
      </svg>
      QuestionBank
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
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium transition-colors',
          isActive ? 'bg-hover text-ink' : 'text-muted hover:bg-hover hover:text-ink',
        )
      }
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      {item.label}
    </NavLink>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-canvas lg:flex">
      <div className="px-4 pt-4 pb-3">
        <Logo />
      </div>
      <nav aria-label="Principal" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {PRIMARY_NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
        <div className="my-2 border-t border-border" />
        {SECONDARY_NAV.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t border-border px-3 py-2.5">
        <SyncStatus />
      </div>
    </aside>
  );
}

function BottomNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  return (
    <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <div className="grid grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn('flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium', isActive && !moreOpen ? 'text-accent-text' : 'text-muted')
              }
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden />
              {item.label}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          className={cn('flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium', moreOpen ? 'text-accent-text' : 'text-muted')}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden />
          Más
        </button>
      </div>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            {MOBILE_MORE_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn('flex h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium', isActive ? 'bg-hover text-ink' : 'text-muted hover:bg-hover')
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

export function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#main" className="sr-only rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
        Saltar al contenido
      </a>
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas/95 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center justify-between gap-3 px-4">
            <Logo />
            <SyncStatus compact />
          </div>
        </header>
        <Banners />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 outline-none sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
          <Outlet />
        </main>
      </div>
      <BottomNav onMore={() => setMoreOpen((v) => !v)} moreOpen={moreOpen} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <Toaster />
      <RouteAnnouncer />
      <ScrollRestoration />
    </div>
  );
}
