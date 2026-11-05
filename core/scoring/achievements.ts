import type { ProfileStats } from '../schema/derived.ts';

export interface AchievementContext {
  stats: ProfileStats;
  tournamentsWon: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: (context: AchievementContext) => boolean;
}

/** Catálogo. Los logros se recalculan siempre: no hay un fichero donde alguien pueda añadirse uno. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-answer', title: 'Primer paso', description: 'Publica tu primera respuesta.', unlocked: ({ stats }) => stats.answers >= 1 },
  { id: 'answers-100', title: 'Constancia', description: '100 respuestas publicadas.', unlocked: ({ stats }) => stats.answers >= 100 },
  { id: 'answers-1000', title: 'Mil preguntas', description: '1 000 respuestas publicadas.', unlocked: ({ stats }) => stats.answers >= 1000 },
  { id: 'accuracy-80', title: 'Buen criterio', description: '80 % de precisión en al menos 100 preguntas tipo test.', unlocked: ({ stats }) => stats.mcqAnswers >= 100 && (stats.accuracy ?? 0) >= 0.8 },
  { id: 'accuracy-90', title: 'Precisión', description: '90 % de precisión en al menos 200 preguntas tipo test.', unlocked: ({ stats }) => stats.mcqAnswers >= 200 && (stats.accuracy ?? 0) >= 0.9 },
  { id: 'streak-3', title: 'Tres seguidos', description: 'Racha de 3 días estudiando.', unlocked: ({ stats }) => stats.longestStreak >= 3 },
  { id: 'streak-7', title: 'Una semana', description: 'Racha de 7 días estudiando.', unlocked: ({ stats }) => stats.longestStreak >= 7 },
  { id: 'streak-30', title: 'Un mes', description: 'Racha de 30 días estudiando.', unlocked: ({ stats }) => stats.longestStreak >= 30 },
  { id: 'first-question', title: 'Autoría', description: 'Tu primera pregunta aprobada.', unlocked: ({ stats }) => stats.questionsApproved >= 1 },
  { id: 'questions-10', title: 'Contribuyente', description: '10 preguntas aprobadas.', unlocked: ({ stats }) => stats.questionsApproved >= 10 },
  { id: 'questions-50', title: 'Referente', description: '50 preguntas aprobadas.', unlocked: ({ stats }) => stats.questionsApproved >= 50 },
  { id: 'used-50', title: 'Útil', description: 'Tus preguntas han servido a 50 personas.', unlocked: ({ stats }) => stats.questionUses >= 50 },
  { id: 'competitor', title: 'A competir', description: 'Participa en una competición.', unlocked: ({ stats }) => stats.competitions >= 1 },
  { id: 'winner', title: 'Primera victoria', description: 'Gana una competición.', unlocked: ({ stats }) => stats.competitionWins >= 1 },
  { id: 'champion', title: 'Campeón de torneo', description: 'Gana un torneo.', unlocked: ({ tournamentsWon }) => tournamentsWon >= 1 },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
