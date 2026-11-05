import { kvGet, kvSet } from '@/infra/db/db';
import { createStore } from '@/infra/store';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Preferences {
  theme: ThemePreference;
  /** Retención objetivo de la repetición espaciada. */
  retention: number;
  /** Respuestas al día que cuentan como objetivo cumplido. */
  dailyGoal: number;
  /** Pasar solo a la siguiente pregunta tras acertar. */
  autoAdvance: boolean;
  /** Enseñar la dificultad antes de responder. */
  showDifficulty: boolean;
  /** Sólo con token: publicar resultados sin pedir confirmación cada vez. */
  autoPublishResults: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  retention: 0.9,
  dailyGoal: 20,
  autoAdvance: false,
  showDifficulty: true,
  autoPublishResults: false,
};

export const preferences = createStore<Preferences>(DEFAULT_PREFERENCES);

const KEY = 'preferences';

export function applyTheme(theme: ThemePreference): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('qb-theme', theme);
  } catch {
    /* Sin almacenamiento: el tema se aplica igual en esta sesión. */
  }
}

export async function loadPreferences(): Promise<void> {
  const stored = await kvGet<Partial<Preferences>>(KEY);
  const merged = { ...DEFAULT_PREFERENCES, ...stored };
  preferences.set(merged);
  applyTheme(merged.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preferences.get().theme === 'system') applyTheme('system');
  });
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<void> {
  const next = { ...preferences.get(), ...patch };
  preferences.set(next);
  if (patch.theme) applyTheme(patch.theme);
  await kvSet(KEY, next);
}
