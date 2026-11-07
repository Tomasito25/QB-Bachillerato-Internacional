import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** Enlace que sale de la app: siempre en otra pestaña y sin darle acceso a esta. */
export function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn('inline-flex items-center gap-1 text-[0.8125rem] text-muted underline-offset-2 hover:text-ink hover:underline', className)}>
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}
