import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

/**
 * Gráficas mínimas, sin librería. Una sola serie: un solo color, sin leyenda (la nombra el
 * título). Barras finas con el extremo redondeado y el valor en la punta. Todo valor es
 * accesible sin pasar el ratón: va escrito o en la vista de tabla.
 */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  to?: string;
  detail?: string;
}

export function BarList({ data, emptyLabel = 'Sin datos todavía.', max: forcedMax, format = String }: { data: readonly BarDatum[]; emptyLabel?: string; max?: number; format?: (value: number) => string }) {
  if (data.length === 0) return <p className="text-[13px] text-muted">{emptyLabel}</p>;
  const max = forcedMax ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="flex flex-col gap-2">
      {data.map((datum) => {
        const label = datum.to ? (
          <Link to={datum.to} className="truncate hover:text-accent-text hover:underline">
            {datum.label}
          </Link>
        ) : (
          <span className="truncate">{datum.label}</span>
        );
        return (
          <li key={datum.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-[13px]" title={datum.detail ? `${datum.label}: ${datum.detail}` : undefined}>
            <div className="flex min-w-0">{label}</div>
            <span className="row-span-2 self-center font-medium tabular-nums">{format(datum.value)}</span>
            <div className="mt-1 h-2 rounded-r bg-subtle" aria-hidden>
              <div className="h-full min-w-px rounded-r bg-chart" style={{ width: `${(datum.value / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface ColumnDatum {
  key: string;
  /** Texto completo del tooltip y de la tabla. */
  label: string;
  /** Etiqueta corta del eje; vacía en la mayoría, para no saturar. */
  tick?: string;
  value: number;
}

/** Columnas en el tiempo. Cada columna responde a ratón y teclado, y hay vista de tabla. */
export function ColumnChart({ data, title, unit }: { data: readonly ColumnDatum[]; title: string; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const highlighted = active !== null ? data[active] : undefined;

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <figcaption className="text-[13px] text-muted" aria-live="off">
          {highlighted ? (
            <>
              <span className="font-medium text-ink tabular-nums">
                {highlighted.value} {unit}
              </span>{' '}
              · {highlighted.label}
            </>
          ) : (
            title
          )}
        </figcaption>
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-expanded={asTable} aria-controls={tableId} className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink">
          {asTable ? 'Ver gráfica' : 'Ver como tabla'}
        </button>
      </div>
      {asTable ? (
        <div id={tableId} className="max-h-60 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-subtle text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Fecha</th>
                <th className="px-3 py-1.5 text-right font-medium capitalize">{unit}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((datum) => (
                <tr key={datum.key}>
                  <td className="px-3 py-1">{datum.label}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{datum.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={tableId}>
          <div className="flex h-24 items-end gap-[2px] border-b border-border" role="group" aria-label={title} onPointerLeave={() => setActive(null)}>
            {data.map((datum, index) => (
              <button
                key={datum.key}
                type="button"
                aria-label={`${datum.label}: ${datum.value} ${unit}`}
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-none outline-offset-0"
              >
                <span
                  className={cn('block w-full max-w-6 rounded-t transition-opacity', datum.value > 0 ? 'bg-chart' : 'bg-transparent', active !== null && active !== index && 'opacity-40')}
                  style={{ height: `${(datum.value / max) * 100}%`, minHeight: datum.value > 0 ? 3 : 0 }}
                />
              </button>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] text-[11px] text-muted" aria-hidden>
            {data.map((datum) => (
              <span key={datum.key} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
                {datum.tick ?? ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}

/** Parte de un todo con dos o más clases: barra apilada con hueco de 2 px y leyenda escrita. */
export function SplitBar({ parts, label }: { parts: readonly { key: string; label: string; value: number; className: string }[]; label: string }): ReactNode {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) return <p className="text-[13px] text-muted">Sin datos todavía.</p>;
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)} %`).join(', ')}`}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', p.className)} aria-hidden />
            {p.label}
            <span className="font-medium tabular-nums">{Math.round((p.value / total) * 100)} %</span>
            <span className="text-muted tabular-nums">({p.value})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
