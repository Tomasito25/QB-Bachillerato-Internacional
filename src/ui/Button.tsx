import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'signal' | 'plate';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover border-2 border-transparent',
  secondary: 'bg-surface text-ink border-2 border-ink hover:bg-ink hover:text-canvas',
  ghost: 'text-ink hover:bg-hover border-2 border-transparent',
  danger: 'bg-surface text-danger border-2 border-danger hover:bg-danger hover:text-canvas',
  // Sobre campos de color: se leen igual encima del relleno y encima del fondo de la banda.
  signal: 'bg-signal text-signal-ink border-2 border-signal-ink hover:bg-white',
  plate: 'bg-white text-[#0a0a0a] border-2 border-[#0a0a0a] hover:bg-signal',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-11 px-5 text-[0.9375rem] gap-2',
  icon: 'size-11 justify-center',
  'icon-sm': 'size-9 justify-center',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  return cn(
    'inline-flex items-center justify-center font-bold whitespace-nowrap select-none transition-colors',
    'disabled:opacity-50 disabled:pointer-events-none',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  busy?: boolean;
}

export function Button({ variant, size, icon, busy, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant, size, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
