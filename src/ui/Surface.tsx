import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border border-border bg-surface', className)}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-muted border-border',
  accent: 'bg-accent-soft text-accent-text border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
};

export function Badge({ tone = 'neutral', className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, documentTitle }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; documentTitle?: string }) {
  const text = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (text) document.title = `${text} · QuestionBank`;
  }, [text]);
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'accent', className }: { value: number; label: string; tone?: 'accent' | 'success' | 'warning' | 'danger'; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className={cn('h-1.5 overflow-hidden rounded-full bg-subtle', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', fill)} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function Notice({ tone = 'neutral', title, children, className, action }: { tone?: BadgeTone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const styles: Record<BadgeTone, string> = {
    neutral: 'bg-subtle border-border',
    accent: 'bg-accent-soft border-transparent',
    success: 'bg-success-soft border-transparent',
    warning: 'bg-warning-soft border-transparent',
    danger: 'bg-danger-soft border-transparent',
  };
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border px-3.5 py-2.5 text-sm', styles[tone], className)}>
      <div className="min-w-0 flex-1 basis-60">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5' : '', 'text-[13px] text-muted')}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
