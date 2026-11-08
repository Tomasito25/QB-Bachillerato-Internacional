import { ChevronRight, ListFilter } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { scopePredicate, type StudyScope } from '@core/questions/filter';
import { bankStats } from '@core/questions/stats';
import { useQuestions } from '@/features/bank/questionsRepo';
import { preferences, updatePreferences } from '@/features/settings/preferences';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Segmented } from '@/ui/Field';
import { Card } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { scopeLabel } from './sessions';

type CheckState = 'none' | 'some' | 'all';

const MODES: { value: StudyScope['mode']; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'only', label: 'Sólo lo marcado' },
  { value: 'block', label: 'Todo menos lo marcado' },
];

const MODE_HINTS: Record<StudyScope['mode'], string> = {
  all: 'Salen preguntas de todo el temario.',
  only: 'Sólo saldrán preguntas de los temas que marques.',
  block: 'Los temas que marques no saldrán al estudiar.',
};

function stateOf(topicIds: readonly string[], chosen: ReadonlySet<string>): CheckState {
  const marked = topicIds.filter((id) => chosen.has(id)).length;
  return marked === 0 ? 'none' : marked === topicIds.length ? 'all' : 'some';
}

function TriCheckbox({ state, onChange }: { state: CheckState; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" checked={state === 'all'} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--accent)]" />;
}

function TreeRow({ depth, name, count, state, onToggle, expanded, onExpand }: { depth: 0 | 1 | 2; name: string; count: number; state: CheckState; onToggle: (checked: boolean) => void; expanded?: boolean; onExpand?: () => void }) {
  return (
    <div className={cn('flex min-h-9 items-center gap-1 rounded-md pr-2 hover:bg-subtle/60', depth === 1 && 'pl-5', depth === 2 && 'pl-10')}>
      {onExpand ? (
        <button type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Ocultar' : 'Ver'} ${name}`} onClick={onExpand} className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted hover:text-ink">
          <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <span className="size-7 shrink-0" />
      )}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <TriCheckbox state={state} onChange={onToggle} />
        <span className={cn('truncate text-sm', depth === 0 && 'font-medium')}>{name}</span>
      </label>
      <span className="shrink-0 text-xs text-muted tabular-nums">{count}</span>
    </div>
  );
}

function ScopeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { studyScope: scope } = preferences.use();
  const taxonomy = useTaxonomy();
  const questions = useQuestions();
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const counts = useMemo(() => (questions && taxonomy ? bankStats(questions, taxonomy.index) : null), [questions, taxonomy]);
  const chosen = useMemo(() => new Set(scope.topicIds), [scope.topicIds]);
  if (!taxonomy || !counts || !questions) return null;

  const save = (patch: Partial<StudyScope>) => void updatePreferences({ studyScope: { ...scope, ...patch } });
  const setTopics = (ids: readonly string[], checked: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    save({ topicIds: [...next] });
  };

  const subjects = taxonomy.subjects.filter((s) => s.units.some((u) => u.topics.length > 0));
  // Con pocas asignaturas se empieza desplegado: hay que ver los temas para marcarlos.
  const open_ = expanded ?? new Set(subjects.length <= 2 ? subjects.map((s) => s.id) : []);
  const toggle = (id: string) => {
    const next = new Set(open_);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  };
  const entering = questions.filter(scopePredicate(scope)).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Temario que entra al estudiar"
      footer={
        <>
          <p className="mr-auto self-center text-[0.8125rem] text-muted" role="status">
            <span className="font-medium text-ink tabular-nums">{entering}</span> de {questions.length} preguntas
          </p>
          <Button variant="primary" onClick={onClose}>
            Hecho
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented label="Qué entra" value={scope.mode} options={MODES} onChange={(mode) => save({ mode })} />
        <p className="text-[0.8125rem] text-muted">{MODE_HINTS[scope.mode]} Se aplica a práctica, examen y repaso; las competiciones no cambian.</p>
        {scope.mode !== 'all' ? (
          <div className="flex flex-col">
            {subjects.map((subject) => {
              const subjectTopics = subject.units.flatMap((u) => u.topics.map((t) => t.id));
              return (
                <div key={subject.id}>
                  <TreeRow depth={0} name={subject.name} count={counts.bySubject.get(subject.id) ?? 0} state={stateOf(subjectTopics, chosen)} onToggle={(checked) => setTopics(subjectTopics, checked)} expanded={open_.has(subject.id)} onExpand={() => toggle(subject.id)} />
                  {open_.has(subject.id)
                    ? subject.units
                        .filter((u) => u.topics.length > 0)
                        .map((unit) => {
                          const unitTopics = unit.topics.map((t) => t.id);
                          return (
                            <div key={unit.id}>
                              <TreeRow depth={1} name={unit.name} count={counts.byUnit.get(unit.id) ?? 0} state={stateOf(unitTopics, chosen)} onToggle={(checked) => setTopics(unitTopics, checked)} expanded={open_.has(unit.id)} onExpand={() => toggle(unit.id)} />
                              {open_.has(unit.id) ? unit.topics.map((topic) => <TreeRow key={topic.id} depth={2} name={topic.name} count={counts.byTopic.get(topic.id) ?? 0} state={chosen.has(topic.id) ? 'all' : 'none'} onToggle={(checked) => setTopics([topic.id], checked)} />) : null}
                            </div>
                          );
                        })
                    : null}
                </div>
              );
            })}
            {subjects.length === 0 ? <p className="text-[0.8125rem] text-muted">Todavía no hay temas.</p> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Qué parte del temario entra al estudiar: a la vista, y a un clic de cambiarlo. */
export function ScopeCard() {
  const { studyScope } = preferences.use();
  const [open, setOpen] = useState(false);
  const label = scopeLabel(studyScope);
  return (
    <>
      <Card className={cn('flex flex-wrap items-center justify-between gap-3 p-4', label && 'border-accent')}>
        <div className="flex min-w-0 items-start gap-2.5">
          <ListFilter size={18} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Temario que entra</h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">{label ? `${label}. Sólo afecta a tu estudio.` : 'Todo. Puedes dejar sólo unos temas, o bloquear los que no te entren.'}</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)}>Elegir temario</Button>
      </Card>
      <ScopeDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
