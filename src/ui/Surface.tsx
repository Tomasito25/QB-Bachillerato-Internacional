import { useEffect, type ReactNode } from 'react';
import { config } from '@/infra/config';
import { cn } from './cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('border-t-2 border-ink bg-surface', className)}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h2 className="qb-heading">{title}</h2>
        {description ? <p className="mt-1 text-[0.8125rem] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-subtle text-ink',
  accent: 'bg-accent text-accent-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, documentTitle }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; documentTitle?: string }) {
  const text = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (text) document.title = `${text} · ${config.appName}`;
  }, [text]);
  return (
    <header className="qb-page-head qb-bleed mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-[var(--gutter)] pt-8 pb-7">
      <div className="min-w-0">
        <h1 className="qb-title">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[1.0625rem] font-medium text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start bg-subtle px-6 py-10 sm:px-8">
      {icon ? <div className="mb-4 text-accent-text">{icon}</div> : null}
      <p className="qb-heading sm:text-[2.25rem]">{title}</p>
      {children ? <div className="mt-2 max-w-xl text-[0.9375rem] [overflow-wrap:anywhere] text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="qb-display text-[clamp(2rem,3.2vw,3rem)] font-black">{value}</p>
      <p className="mt-1 truncate text-[0.8125rem] font-semibold">{label}</p>
      {hint ? <p className="truncate text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'accent', className }: { value: number; label: string; tone?: 'accent' | 'success' | 'warning' | 'danger'; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className={cn('h-2.5 overflow-hidden bg-subtle', className)}>
      <div className={cn('h-full transition-[width] duration-300', fill)} style={{ width: `${percent}%` }} />
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
    neutral: 'bg-subtle',
    accent: 'bg-accent-soft',
    success: 'bg-success-soft',
    warning: 'bg-warning-soft',
    danger: 'bg-danger-soft',
  };
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm', styles[tone], className)}>
      <div className="min-w-0 flex-1 basis-60">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5' : '', 'text-[0.8125rem]')}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
