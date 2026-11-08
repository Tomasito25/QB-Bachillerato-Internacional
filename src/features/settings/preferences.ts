import type { StudyScope } from '@core/questions/filter';
import { kvGet, kvSet } from '@/infra/db/db';
import { createStore } from '@/infra/store';

export type ThemePreference = 'system' | 'light' | 'dark';
export type AccentName = 'indigo' | 'blue' | 'teal' | 'violet' | 'pink' | 'orange';
export type TextSize = 'small' | 'normal' | 'large' | 'xlarge';
export type FontChoice = 'inter' | 'system' | 'serif';

export interface Preferences {
  theme: ThemePreference;
  /** Retención objetivo de la repetición espaciada. */
  retention: number;
  /** Objetivo diario de cada tipo de pregunta. Con 0, ese tipo no cuenta. */
  dailyGoalMcq: number;
  dailyGoalOpen: number;
  /** Qué parte del temario entra al estudiar. No afecta a las competiciones. */
  studyScope: StudyScope;
  /** Pasar solo a la siguiente pregunta tras acertar. */
  autoAdvance: boolean;
  /** Enseñar la dificultad antes de responder. */
  showDifficulty: boolean;
  /** Sólo con token: publicar resultados sin pedir confirmación cada vez. */
  autoPublishResults: boolean;
  /** Color de botones, enlaces y progreso. */
  accent: AccentName;
  /** Preguntas de una práctica rápida. */
  practiceCount: number;
  /** Oculta competiciones, rankings y amigos: sólo estudiar. */
  studyOnly: boolean;
  /** Escala toda la interfaz, no sólo el texto de las preguntas. */
  textSize: TextSize;
  font: FontChoice;
  /** Minutos al día para el calendario de estudio. */
  planMinutes: number;
  /** Días sin estudiar: 0 es domingo. */
  planRestDays: number[];
  /** Cuándo cambió por última vez algo de `SYNCED_PREFERENCES`. */
  syncedAt: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  retention: 0.9,
  dailyGoalMcq: 20,
  dailyGoalOpen: 0,
  studyScope: { mode: 'all', topicIds: [] },
  autoAdvance: false,
  showDifficulty: true,
  autoPublishResults: false,
  accent: 'indigo',
  practiceCount: 10,
  studyOnly: false,
  textSize: 'normal',
  font: 'inter',
  planMinutes: 45,
  planRestDays: [],
  syncedAt: 0,
};

/** Lo que viaja entre tus dispositivos. El tema, el color y el tamaño son de cada pantalla. */
export const SYNCED_PREFERENCES = ['retention', 'dailyGoalMcq', 'dailyGoalOpen', 'studyScope', 'autoAdvance', 'showDifficulty', 'practiceCount', 'studyOnly', 'planMinutes', 'planRestDays'] as const satisfies readonly (keyof Preferences)[];

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

/** Como el tema, se guardan también fuera de IndexedDB para aplicarlos antes de pintar (`theme-init.js`). */
function applyLook(key: 'accent' | 'text' | 'font', value: string): void {
  document.documentElement.dataset[key] = value;
  try {
    localStorage.setItem(`qb-${key}`, value);
  } catch {
    /* Sin almacenamiento: se aplica igual en esta sesión. */
  }
}

/** Antes había un único objetivo diario: cuenta como de tipo test, que era lo que medía casi siempre. */
export function migratePreferences(stored: (Partial<Preferences> & { dailyGoal?: number }) | undefined): Preferences {
  const { dailyGoal, ...rest } = stored ?? {};
  return { ...DEFAULT_PREFERENCES, ...(dailyGoal !== undefined ? { dailyGoalMcq: dailyGoal } : {}), ...rest };
}

export async function loadPreferences(): Promise<void> {
  const merged = migratePreferences(await kvGet<Partial<Preferences>>(KEY));
  preferences.set(merged);
  applyTheme(merged.theme);
  applyLook('accent', merged.accent);
  applyLook('text', merged.textSize);
  applyLook('font', merged.font);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preferences.get().theme === 'system') applyTheme('system');
  });
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<void> {
  const synced = SYNCED_PREFERENCES.some((key) => key in patch);
  const next = { ...preferences.get(), ...patch, ...(synced ? { syncedAt: Date.now() } : {}) };
  preferences.set(next);
  if (patch.theme) applyTheme(patch.theme);
  if (patch.accent) applyLook('accent', patch.accent);
  if (patch.textSize) applyLook('text', patch.textSize);
  if (patch.font) applyLook('font', patch.font);
  await kvSet(KEY, next);
}

/** Lo que llega de otro dispositivo: conserva su fecha para que no parezca un cambio de aquí. */
export async function applySyncedPreferences(values: Partial<Preferences>, at: number): Promise<void> {
  const next = { ...preferences.get(), ...values, syncedAt: at };
  preferences.set(next);
  await kvSet(KEY, next);
}
