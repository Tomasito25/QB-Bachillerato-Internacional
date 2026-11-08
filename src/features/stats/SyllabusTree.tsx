import { ChevronRight, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { preferences } from '@/features/settings/preferences';
import type { SessionConfig } from '@/infra/db/types';
import { useLaunchSession } from '@/features/study/launch';
import { nodeScore, type NodeProgress, type SubjectProgress } from '@/features/study/syllabusProgress';
import { SubjectMark } from '@/ui/SubjectMark';
import { Button } from '@/ui/Button';
import { ProgressLegend, ProgressSegments } from '@/ui/charts';
import { cn } from '@/ui/cn';

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

interface RowProps {
  depth: 0 | 1 | 2;
  name: string;
  node: NodeProgress;
  expanded?: boolean;
  onExpand?: () => void;
  practice: Omit<SessionConfig, 'count'>;
  mark?: ReactNode;
}

function Row({ depth, name, node, expanded, onExpand, practice, mark }: RowProps) {
  const launch = useLaunchSession();
  const { practiceCount } = preferences.use();
  const score = nodeScore(node);
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 pr-3 sm:grid-cols-[minmax(0,1fr)_10rem_3.5rem_3.5rem_2rem]', depth === 0 ? 'pl-2' : depth === 1 ? 'pl-7' : 'pl-[3.25rem]')}>
      <div className="flex min-w-0 items-center gap-1">
        {onExpand ? (
          <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Ocultar' : 'Ver'} ${name}`} onClick={onExpand} className="inline-flex size-7 shrink-0 items-center justify-center rounded-none text-muted hover:text-ink">
            <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} aria-hidden />
          </button>
        ) : (
          <span className="size-2 shrink-0" />
        )}
        {mark}
        <span className={cn('truncate text-[0.9375rem] font-medium', depth === 0 && 'font-bold')} title={name}>
          {name}
        </span>
      </div>
      <Button size="icon-sm" variant="ghost" className="sm:order-last" aria-label={`Practicar ${name}`} title="Practicar" onClick={() => void launch({ mode: 'practice', title: name, config: { ...practice, count: practiceCount } })}>
        <Play size={14} aria-hidden />
      </Button>
      <div className="col-span-2 sm:col-span-1">
        <ProgressSegments label={name} mastered={node.mastered} seen={node.seen} total={node.total} thin />
        <p className="mt-0.5 text-xs text-muted tabular-nums">
          {node.seen} de {node.total} vistas
          <span className="sm:hidden">
            {' '}
            · {percent(score)} de acierto · {node.due} por repasar
          </span>
        </p>
      </div>
      <p className="qb-display hidden text-right text-[1.125rem] sm:block">{percent(score)}</p>
      <p className={cn('hidden text-right text-[0.84375rem] tabular-nums sm:block', node.due === 0 && 'text-muted')}>{node.due}</p>
    </div>
  );
}

/** Asignatura → unidad → tema, cada uno con su avance y con su botón de practicar. */
export function SyllabusTree({ tree, initialOpen }: { tree: readonly SubjectProgress[]; initialOpen?: string | null }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : tree.length === 1 ? [tree[0]?.id ?? ''] : []));
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (tree.length === 0) return <p className="p-4 text-[0.8125rem] text-muted">Aún no hay preguntas en ninguna asignatura.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-4 py-2">
        <ProgressLegend />
        <div className="hidden grid-cols-[3.5rem_3.5rem_2rem] gap-x-3 text-right text-xs font-semibold sm:grid">
          <span>Acierto</span>
          <span>Repasar</span>
          <span />
        </div>
      </div>
      <ul className="divide-y divide-border">
        {tree.map((subject) => (
          <li key={subject.id}>
            <Row depth={0} name={subject.name} node={subject} expanded={open.has(subject.id)} onExpand={() => toggle(subject.id)} practice={{ subjectId: subject.id }} mark={<SubjectMark id={subject.id} name={subject.name} small className="mr-1" />} />
            {open.has(subject.id)
              ? subject.units.map((unit) => (
                  <div key={unit.id} className="border-t border-border">
                    <Row depth={1} name={unit.name} node={unit} expanded={open.has(unit.id)} onExpand={() => toggle(unit.id)} practice={{ unitIds: [unit.id] }} />
                    {open.has(unit.id)
                      ? unit.topics.map((topic) => (
                          <div key={topic.id} className="border-t border-border">
                            <Row depth={2} name={topic.name} node={topic} practice={{ topicIds: [topic.id] }} />
                          </div>
                        ))
                      : null}
                  </div>
                ))
              : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
