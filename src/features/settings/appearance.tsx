import { Moon, Monitor, Sun } from 'lucide-react';
import { Segmented } from '@/ui/Field';
import { cn } from '@/ui/cn';
import { preferences, updatePreferences, type AccentName, type FontChoice, type TextSize, type ThemePreference } from './preferences';

const THEMES: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'Sistema', icon: <Monitor size={14} aria-hidden /> },
  { value: 'light', label: 'Claro', icon: <Sun size={14} aria-hidden /> },
  { value: 'dark', label: 'Oscuro', icon: <Moon size={14} aria-hidden /> },
];

/** El de la muestra es el del tema claro; en el oscuro, la app usa su versión más luminosa. */
const ACCENTS: { value: AccentName; label: string; swatch: string }[] = [
  { value: 'indigo', label: 'Índigo', swatch: '#4f46e5' },
  { value: 'blue', label: 'Azul', swatch: '#2563eb' },
  { value: 'teal', label: 'Verde azulado', swatch: '#0f766e' },
  { value: 'violet', label: 'Violeta', swatch: '#7c3aed' },
  { value: 'pink', label: 'Rosa', swatch: '#db2777' },
  { value: 'orange', label: 'Naranja', swatch: '#c2410c' },
];

const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Pequeño' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Grande' },
  { value: 'xlarge', label: 'Muy grande' },
];

const FONTS: { value: FontChoice; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'system', label: 'La del sistema' },
  { value: 'serif', label: 'Con serifa' },
];

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.8125rem] font-medium">{label}</p>
      {children}
    </div>
  );
}

/** Tema, color, tamaño y letra. Los usan Configuración y el tutorial de bienvenida. */
export function AppearanceControls() {
  const prefs = preferences.use();
  return (
    <>
      <Labeled label="Tema">
        <Segmented label="Tema" value={prefs.theme} options={THEMES} onChange={(theme) => void updatePreferences({ theme })} />
      </Labeled>
      <Labeled label="Color">
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
          {ACCENTS.map(({ value, label, swatch }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={prefs.accent === value}
              aria-label={label}
              title={label}
              onClick={() => void updatePreferences({ accent: value })}
              className={cn('flex size-9 items-center justify-center rounded-full border-2 transition-colors', prefs.accent === value ? 'border-ink' : 'border-transparent hover:border-border-strong')}
            >
              <span className="size-6 rounded-full" style={{ background: swatch }} />
            </button>
          ))}
        </div>
      </Labeled>
      <Labeled label="Tamaño del texto">
        <Segmented label="Tamaño del texto" value={prefs.textSize} options={TEXT_SIZES} onChange={(textSize) => void updatePreferences({ textSize })} />
      </Labeled>
      <Labeled label="Tipo de letra">
        <Segmented label="Tipo de letra" value={prefs.font} options={FONTS} onChange={(font) => void updatePreferences({ font })} />
      </Labeled>
    </>
  );
}
