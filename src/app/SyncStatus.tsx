import { CloudOff, RefreshCw } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { syncState } from '@/features/sync/state';
import { online } from '@/infra/connectivity';
import { db } from '@/infra/db/db';
import { cn } from '@/ui/cn';
import { timeAgo } from '@/ui/time';

/** Conexión, última sincronización y envíos pendientes, siempre a la vista. */
export function SyncStatus({ compact }: { compact?: boolean }) {
  const isOnline = online.use();
  const state = syncState.use();
  const pending = useLiveQuery(() => db.outbox.where('status').anyOf(['queued', 'awaiting-user']).count(), []);

  let label: string;
  if (!isOnline) label = 'Sin conexión';
  else if (state.status === 'syncing') label = 'Sincronizando…';
  else if (state.status === 'error') label = 'Error al sincronizar';
  else if (state.lastSyncAt) label = `Sincronizado ${timeAgo(state.lastSyncAt)}`;
  else label = 'En línea';

  return (
    <Link to="/sync" className={cn('flex min-w-0 items-center gap-2 rounded-md text-xs text-muted hover:text-ink', compact && 'shrink-0')} title={label}>
      {!isOnline ? (
        <CloudOff size={14} className="shrink-0 text-warning" aria-hidden />
      ) : state.status === 'syncing' ? (
        <RefreshCw size={14} className="shrink-0 animate-spin" aria-hidden />
      ) : (
        <span className={cn('size-2 shrink-0 rounded-full', state.status === 'error' ? 'bg-danger' : 'bg-success')} aria-hidden />
      )}
      <span className={cn('truncate', compact && 'sr-only')}>{label}</span>
      {pending ? (
        <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-xs font-medium text-accent-ink tabular-nums" title={`${pending} envíos pendientes`}>
          {pending}
        </span>
      ) : null}
    </Link>
  );
}
