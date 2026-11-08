import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { config } from '@/infra/config';
import { cn } from './cn';
import { bandPercent } from './marks';

interface BandProps {
  /** Lo que mide la banda, de 0 a 1. */
  value: number;
  /** Qué mide, para los lectores de pantalla. */
  label: string;
  title: ReactNode;
  documentTitle?: string;
  subtitle?: ReactNode;
  detail?: ReactNode;
  figure?: string;
  actions?: ReactNode;
  /** Versión baja para no restar sitio a la pregunta. */
  compact?: boolean;
  /** Ocupa toda la pantalla aunque su contenedor sea más estrecho. */
  screen?: boolean;
  as?: 'h1' | 'p';
  className?: string;
}

/**
 * La cabecera es la barra de progreso. El contenido se pinta dos veces, sobre el fondo y sobre el
 * relleno recortado, y por eso el número cambia de color justo al cruzar el borde. Las acciones van
 * una sola vez, por encima de las dos capas, para no duplicar el foco.
 */
export function Band({ value, label, title, documentTitle, subtitle, detail, figure, actions, compact, screen, as = 'h1', className }: BandProps) {
  const percent = bandPercent(value);
  const text = documentTitle ?? (typeof title === 'string' ? title : undefined);
  // Un título largo o un 100 % no caben junto a la cifra a tamaño completo.
  const long = (figure?.length ?? 0) > 3 || (typeof title === 'string' && title.length > 9);
  useEffect(() => {
    if (as === 'h1' && text) document.title = `${text} · ${config.appName}`;
  }, [as, text]);

  const layer = (clone: boolean) => {
    const Heading = clone ? 'p' : as;
    const buttons = actions ? (
      <div className={cn('qb-band-actions', clone && 'invisible')} inert={clone}>
        {actions}
      </div>
    ) : null;
    return (
      <div className="qb-band-layer">
        <div className="min-w-0">
          <Heading className="qb-band-title">{title}</Heading>
          {subtitle ? <p className="qb-band-sub">{subtitle}</p> : null}
          {detail ? <p className="qb-band-detail">{detail}</p> : null}
          {compact ? null : buttons}
        </div>
        {compact ? buttons : figure ? <p className="qb-band-figure">{figure}</p> : null}
      </div>
    );
  };

  return (
    <section
      className={cn('qb-band qb-band-top', screen ? 'qb-bleed-screen' : 'qb-bleed', compact && 'qb-band-compact', long && 'qb-band-long', className)}
      style={{ '--band': `${percent}%` } as CSSProperties}
    >
      <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="sr-only" />
      {layer(false)}
      <div className="qb-band-fill" aria-hidden>
        {layer(true)}
      </div>
    </section>
  );
}
