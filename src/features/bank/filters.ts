import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Difficulty } from '@core/schema/common';
import type { QuestionFilter } from '@core/questions/filter';
import type { QuestionType } from '@core/schema/question';

export type OriginFilter = 'all' | 'community' | 'mine';
export type SortKey = 'recent' | 'oldest' | 'popular' | 'easy' | 'hard';

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Más recientes',
  oldest: 'Más antiguas',
  popular: 'Más usadas',
  easy: 'Más fáciles primero',
  hard: 'Más difíciles primero',
};

/** Los filtros viven en la URL: se pueden compartir y sobreviven a una recarga. */
export function useBankFilters() {
  const [params, setParams] = useSearchParams();

  const filter = useMemo<QuestionFilter>(() => {
    const unit = params.get('unit');
    const topic = params.get('topic');
    const difficulty = params.get('difficulty');
    const type = params.get('type') as QuestionType | null;
    return {
      subjectId: params.get('subject') ?? undefined,
      unitIds: unit ? [unit] : undefined,
      topicIds: topic ? [topic] : undefined,
      difficulties: difficulty ? (difficulty.split(',').map(Number).filter((n) => n >= 1 && n <= 5) as Difficulty[]) : undefined,
      types: type ? [type] : undefined,
      tag: params.get('tag') ?? undefined,
      text: params.get('q') ?? undefined,
    };
  }, [params]);

  const origin = (params.get('origin') as OriginFilter | null) ?? 'all';
  const sort = (params.get('sort') as SortKey | null) ?? 'recent';

  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams]);
  const active = useMemo(() => [...params.keys()].some((key) => key !== 'sort'), [params]);

  return { filter, origin, sort, set, clear, active, params };
}
