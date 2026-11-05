import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { createStore } from '@/infra/store';
import { cn } from './cn';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const toasts = createStore<ToastItem[]>([]);
let nextId = 1;

function push(kind: ToastKind, message: string, ttl: number) {
  const id = nextId++;
  toasts.set((list) => [...list.slice(-3), { id, kind, message }]);
  window.setTimeout(() => dismiss(id), ttl);
}

function dismiss(id: number) {
  toasts.set((list) => list.filter((t) => t.id !== id));
}

export const toast = {
  info: (message: string) => push('info', message, 4000),
  success: (message: string) => push('success', message, 3500),
  /** Los errores duran más: dan tiempo a leerlos. */
  error: (message: string) => push('error', message, 8000),
};

const ICONS = { info: Info, success: CheckCircle2, error: CircleAlert };
const COLORS = { info: 'text-accent-text', success: 'text-success', error: 'text-danger' };

export function Toaster() {
  const items = toasts.use();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6"
    >
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm shadow-overlay"
          >
            <Icon size={16} className={cn('mt-0.5 shrink-0', COLORS[item.kind])} aria-hidden />
            <p className="min-w-0 flex-1">{item.message}</p>
            <button type="button" onClick={() => dismiss(item.id)} aria-label="Cerrar aviso" className="text-faint hover:text-ink">
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
