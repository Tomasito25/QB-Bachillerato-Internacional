import { CircleDashed, Pencil, Users } from 'lucide-react';
import { DIFFICULTY_LABELS, type Difficulty, type UserRef } from '@core/schema/common';
import { QUESTION_TYPE_LABELS, type QuestionType } from '@core/schema/question';
import type { TaxonomyIndex } from '@core/taxonomy/merge';
import { Badge, type BadgeTone } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import type { QuestionOrigin } from './questionsRepo';

/** Barras de dificultad: la información no depende sólo del color. */
export function DifficultyBadge({ value }: { value: Difficulty }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`Dificultad: ${DIFFICULTY_LABELS[value]}`}>
      <span className="inline-flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4, 5].map((level) => (
          <span key={level} className={cn('w-[3px] rounded-[1px]', level <= value ? 'bg-accent' : 'bg-border-strong')} style={{ height: 3 + level * 2 }} />
        ))}
      </span>
      {DIFFICULTY_LABELS[value]}
    </span>
  );
}

export function TypeBadge({ type }: { type: QuestionType }) {
  return <Badge tone={type === 'mcq' ? 'neutral' : 'accent'}>{QUESTION_TYPE_LABELS[type]}</Badge>;
}

const ORIGIN: Record<QuestionOrigin, { label: string; tone: BadgeTone; icon: typeof Users; title: string }> = {
  community: { label: 'Comunidad', tone: 'neutral', icon: Users, title: 'Publicada en el repositorio comunitario' },
  local: { label: 'Sólo aquí', tone: 'warning', icon: CircleDashed, title: 'Guardada en este dispositivo, sin publicar' },
  edited: { label: 'Edición local', tone: 'warning', icon: Pencil, title: 'Tienes cambios sin publicar sobre la versión comunitaria' },
};

export function OriginBadge({ origin }: { origin: QuestionOrigin }) {
  const { label, tone, icon: Icon, title } = ORIGIN[origin];
  return (
    <Badge tone={tone} title={title}>
      <Icon size={11} aria-hidden />
      {label}
    </Badge>
  );
}

export function Avatar({ user, size = 20, className }: { user: { id: number; login: string }; size?: number; className?: string }) {
  return (
    <img
      src={`https://avatars.githubusercontent.com/u/${user.id}?s=${size * 2}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cn('shrink-0 rounded-full bg-subtle', className)}
      style={{ width: size, height: size }}
    />
  );
}

export function AuthorChip({ author }: { author: UserRef | null }) {
  if (!author) return <span className="text-xs text-faint">Sin publicar</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <Avatar user={author} size={16} />
      <span className="truncate">{author.login}</span>
    </span>
  );
}

export function topicLabels(topicIds: readonly string[], index: TaxonomyIndex): string[] {
  return topicIds.map((id) => index.topics.get(id)?.topic.name).filter((name): name is string => Boolean(name));
}

export function subjectName(subjectId: string, index: TaxonomyIndex): string {
  return index.subjects.get(subjectId)?.name ?? 'Asignatura desconocida';
}
