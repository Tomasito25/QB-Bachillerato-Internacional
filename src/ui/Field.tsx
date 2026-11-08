import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const CONTROL =
  'border-2 border-ink bg-surface px-3 text-[0.9375rem] text-ink placeholder:text-faint transition-colors ' +
  'hover:bg-subtle focus:border-accent focus:bg-surface focus:outline-none disabled:opacity-60 ' +
  'aria-invalid:border-danger';

/**
 * En CSS gana la utilidad que se genera después, no la última escrita: `w-40` no pisa a `w-full`.
 * Por eso los valores por defecto sólo se ponen si quien llama no ha elegido otros.
 */
function sized(className: string | undefined, height: string | false): string {
  const custom = className ?? '';
  return cn(CONTROL, !/(^|\s)w-/.test(custom) && 'w-full', height && !/(^|\s)h-/.test(custom) && height, custom);
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={sized(className, 'h-11')} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(sized(className, false), 'py-2 leading-relaxed')} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(sized(className, 'h-11'), 'pr-8')} {...rest}>
      {children}
    </select>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  /** Recibe el id que debe llevar el control, para que la etiqueta quede asociada. */
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[0.8125rem] font-bold text-ink">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={hintId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-bold">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 border-2 border-ink transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-surface',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] left-[2px] size-4 transition-transform',
            checked ? 'translate-x-5 bg-accent-ink' : 'bg-ink',
          )}
        />
      </button>
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

interface SegmentedProps<T extends string | boolean> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}

/** Una opción entre pocas, a la vista. Para más de cuatro, mejor un `Select`. */
export function Segmented<T extends string | boolean>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap border-2 border-ink">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('inline-flex min-h-9 items-center gap-1.5 px-3 text-[0.8125rem] font-bold', value === option.value ? 'bg-ink text-canvas' : 'text-ink hover:bg-subtle')}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
