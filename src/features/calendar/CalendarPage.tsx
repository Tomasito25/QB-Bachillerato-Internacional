import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, History, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findPaper } from '@core/exams/papers';
import { addDays, daysBetween, weekdayOf, type PlanBlock, type PlanDay } from '@core/study/plan';
import { preferences, updatePreferences } from '@/features/settings/preferences';
import { useLaunchSession } from '@/features/study/launch';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { ExamRow } from '@/infra/db/types';
import { Band } from '@/ui/Band';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field, Input } from '@/ui/Field';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { ExamDialog } from './ExamDialog';
import { formatLong, formatMedium, formatMonth, untilLabel } from './format';
import { examProgress, useStudyPlan } from './useStudyPlan';

function useRunBlock() {
  const launch = useLaunchSession();
  const navigate = useNavigate();
  return (block: PlanBlock) => {
    if (block.kind === 'mock') void navigate(`/mocks?exam=${block.examId}`);
    if (block.kind === 'review') void launch({ mode: 'review', title: block.title, config: { count: block.count, source: 'due', ignoreScope: true } });
    if (block.kind === 'study') void launch({ mode: 'practice', title: block.title, config: { subjectId: block.subjectId, topicIds: [block.topicId], count: block.count, ignoreScope: true } });
  };
}

const blockDetail = (block: PlanBlock): string => {
  if (block.kind === 'exam') return block.examKind === 'final' ? 'Examen final' : 'Mock';
  if (block.kind === 'mock') return `Prueba entera: ${block.minutes} min`;
  return `${block.count} ${block.count === 1 ? 'pregunta' : 'preguntas'}`;
};

function BlockRow({ block }: { block: PlanBlock }) {
  const run = useRunBlock();
  const Icon = block.kind === 'review' ? History : block.kind === 'mock' || block.kind === 'exam' ? ClipboardCheck : Play;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Icon size={18} className="shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{block.title}</p>
        <p className="text-[0.8125rem] text-muted">{blockDetail(block)}</p>
      </div>
      {block.kind === 'exam' ? null : (
        <Button size="sm" onClick={() => run(block)}>
          Empezar
        </Button>
      )}
    </li>
  );
}

function DayBlocks({ day, emptyText }: { day: PlanDay | undefined; emptyText: string }) {
  if (!day || day.blocks.length === 0) return <p className="py-2.5 text-[0.9375rem] text-muted">{day?.rest ? 'Día libre.' : emptyText}</p>;
  return (
    <ul className="divide-y divide-border">
      {day.blocks.map((block, index) => (
        <BlockRow key={index} block={block} />
      ))}
    </ul>
  );
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function dayTone(day: PlanDay | undefined): { cell: string; note: string } {
  const exam = day?.blocks.find((block): block is Extract<PlanBlock, { kind: 'exam' }> => block.kind === 'exam');
  if (exam) return exam.examKind === 'final' ? { cell: 'bg-ink text-canvas', note: 'Examen' } : { cell: 'bg-accent text-accent-ink', note: 'Mock' };
  if (day?.blocks.some((block) => block.kind === 'mock')) return { cell: 'bg-accent-soft', note: 'Simulacro' };
  return { cell: '', note: '' };
}

function MonthGrid({ days, today, selected, onSelect, capacity }: { days: Map<string, PlanDay>; today: string; selected: string; onSelect: (date: string) => void; capacity: number }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const nextMonth = addDays(first, 32).slice(0, 7);
  const cells = Array.from({ length: daysBetween(first, `${nextMonth}-01`) }, (_, i) => addDays(first, i));
  const previousMonth = addDays(first, -1).slice(0, 7);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="qb-heading first-letter:uppercase">{formatMonth(first)}</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label="Mes anterior" onClick={() => setMonth(previousMonth)}>
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Mes siguiente" onClick={() => setMonth(nextMonth)}>
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-t-2 border-l border-ink text-center">
        {WEEKDAYS.map((name) => (
          <div key={name} className="border-r border-b border-ink py-1 text-xs font-bold">
            {name}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} className="border-r border-b border-ink" />
        ))}
        {cells.map((date) => {
          const day = days.get(date);
          const tone = dayTone(day);
          const load = day ? day.blocks.reduce((sum, block) => sum + (block.kind === 'study' || block.kind === 'review' ? block.count : 0), 0) : 0;
          const label = `${formatLong(date)}: ${day?.blocks.map((block) => block.title).join(', ') || 'sin nada previsto'}`;
          return (
            <button key={date} type="button" aria-label={label} aria-pressed={date === selected} onClick={() => onSelect(date)} className={cn('flex min-h-14 flex-col items-center justify-between border-r border-b border-ink p-1 text-sm font-bold sm:min-h-[4.5rem]', tone.cell, date === today && !tone.cell && 'bg-signal text-signal-ink', date === selected && 'outline outline-[3px] -outline-offset-[3px] outline-accent', date < today && 'opacity-40')}>
              <span className="tabular-nums">{Number(date.slice(8))}</span>
              {tone.note ? <span className="w-full truncate text-[0.625rem] leading-tight sm:text-xs">{tone.note}</span> : load > 0 ? <span className="block h-1 bg-current" style={{ width: `${Math.max(25, Math.min(100, (load / capacity) * 100))}%` }} aria-hidden /> : <span />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Amarillo: hoy. La barra de cada día es cuánto te toca.</p>
    </div>
  );
}

function PlanSettings() {
  const { planMinutes, planRestDays } = preferences.use();
  const toggleDay = (weekday: number) => void updatePreferences({ planRestDays: planRestDays.includes(weekday) ? planRestDays.filter((d) => d !== weekday) : [...planRestDays, weekday] });
  return (
    <Card>
      <CardHeader title="Tu tiempo" description="El calendario se rehace solo si cambias algo." />
      <div className="flex flex-wrap items-end gap-6 p-4">
        <Field label="Minutos al día" className="w-36">
          {(id) => <Input id={id} type="number" min={10} max={600} step={5} value={planMinutes} onChange={(e) => void updatePreferences({ planMinutes: Math.max(10, Math.min(600, Number(e.target.value) || 10)) })} />}
        </Field>
        <div role="group" aria-label="Días libres">
          <p className="mb-1.5 text-[0.8125rem] font-bold">Días libres</p>
          <div className="flex gap-1">
            {WEEKDAYS.map((name, index) => {
              const weekday = (index + 1) % 7;
              const on = planRestDays.includes(weekday);
              return (
                <button key={name} type="button" aria-pressed={on} onClick={() => toggleDay(weekday)} className={cn('size-11 border-2 border-ink text-sm font-bold', on ? 'bg-ink text-canvas' : 'bg-surface text-ink hover:bg-subtle')}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ExamRowItem({ exam, today, subjectName, progress, onEdit, onDelete }: { exam: ExamRow; today: string; subjectName: string; progress: ReturnType<typeof examProgress>; onEdit: () => void; onDelete: () => void }) {
  const days = daysBetween(today, exam.date);
  const paper = findPaper(exam.paperId);
  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 py-3', days < 0 && 'opacity-55')}>
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-bold">{exam.title}</p>
        <p className="text-[0.8125rem] text-muted">
          {subjectName}
          {paper ? ` · ${paper.paper.name}, ${paper.paper.minutes} min` : ''} · {exam.topicIds.length === 0 ? 'entra todo' : `entran ${exam.topicIds.length} ${exam.topicIds.length === 1 ? 'tema' : 'temas'}`} · {progress.mastered} de {progress.total} dominadas
        </p>
      </div>
      <p className="text-sm font-bold tabular-nums">
        {formatMedium(exam.date)}
        {days >= 0 ? ` · ${untilLabel(days)}` : ''}
      </p>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" aria-label={`Editar ${exam.title}`} onClick={onEdit}>
          <Pencil size={16} aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Borrar ${exam.title}`} onClick={onDelete}>
          <Trash2 size={16} aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export default function CalendarPage() {
  const data = useStudyPlan();
  const taxonomy = useTaxonomy();
  const [editing, setEditing] = useState<ExamRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<ExamRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  if (!data || !taxonomy) return <Spinner />;

  const { plan, exams, topics, today, doneToday } = data;
  const addButton = (
    <Button variant="signal" icon={<Plus size={16} aria-hidden />} onClick={() => setEditing('new')}>
      Añadir examen
    </Button>
  );
  const dialogs = (
    <>
      {editing ? <ExamDialog exam={editing === 'new' ? null : editing} today={today} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        size="sm"
        title="¿Borrar este examen?"
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) void db.exams.delete(removing.id);
                setRemoving(null);
              }}
            >
              Borrar
            </Button>
          </>
        }
      >
        {removing?.title}. El calendario se rehará sin él.
      </Dialog>
    </>
  );

  const upcoming = exams.filter((exam) => exam.date >= today);
  const next = upcoming[0];
  if (!next) {
    return (
      <>
        <PageHeader title="Calendario" description="Tus mocks y exámenes finales, y un plan diario hecho con tu progreso." />
        <EmptyState icon={<CalendarDays size={28} aria-hidden />} title="Añade tu primer examen" action={addButton}>
          Di cuándo es y qué entra. La app reparte lo que te falta en los días que quedan y lo rehace cada vez que estudias.
        </EmptyState>
        {exams.length > 0 ? <p className="mt-4 text-[0.8125rem] text-muted">Todos tus exámenes ya han pasado.</p> : null}
        {dialogs}
      </>
    );
  }

  const nextProgress = examProgress(next, topics);
  const daysLeft = daysBetween(today, next.date);
  const byDate = new Map(plan.days.map((day) => [day.date, day]));
  const chosen = selected ?? today;
  const subjectName = (id: string) => taxonomy.subjects.find((s) => s.id === id)?.name ?? 'Asignatura borrada';
  const todayBlocks = byDate.get(today);

  return (
    <>
      <Band className="mb-8" value={nextProgress.total > 0 ? nextProgress.mastered / nextProgress.total : 0} label={`Preguntas dominadas de ${next.title}`} title="Calendario" subtitle={`${next.title} · ${formatMedium(next.date)}`} detail={`${daysLeft === 1 ? 'día' : 'días'} para el examen · ${nextProgress.mastered} de ${nextProgress.total} preguntas dominadas`} figure={String(daysLeft)} actions={addButton} />
      <div className="flex flex-col gap-8">
        {plan.shortfalls.map((shortfall) => {
          const exam = exams.find((e) => e.id === shortfall.examId);
          return (
            <Notice key={shortfall.examId} tone="warning" title={`No te da tiempo a todo lo de ${exam?.title ?? 'este examen'}`} action={<Button size="sm" onClick={() => void updatePreferences({ planMinutes: shortfall.minutesNeeded })}>Subir a {shortfall.minutesNeeded} min</Button>}>
              Quedan fuera {shortfall.questions} preguntas. Con {shortfall.minutesNeeded} minutos al día cabrían todas.
            </Notice>
          );
        })}
        <Card>
          <CardHeader title="Hoy" description={doneToday > 0 ? `Llevas ${doneToday} ${doneToday === 1 ? 'respuesta' : 'respuestas'} hoy.` : `Caben unas ${plan.capacity} preguntas al día.`} />
          <div className="px-4 pb-2">
            <DayBlocks day={todayBlocks} emptyText="Por hoy ya has hecho lo previsto." />
          </div>
        </Card>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <MonthGrid days={byDate} today={today} selected={chosen} onSelect={setSelected} capacity={plan.capacity} />
          <section aria-live="polite" className="border-t-2 border-ink pt-3">
            <h3 className="qb-heading first-letter:uppercase">{formatLong(chosen)}</h3>
            <DayBlocks day={byDate.get(chosen)} emptyText={chosen === today ? 'Por hoy ya has hecho lo previsto.' : 'Nada previsto este día.'} />
          </section>
        </div>
        <Card>
          <CardHeader title="Tus exámenes" action={<Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => setEditing('new')}>Añadir</Button>} />
          <ul className="divide-y divide-border px-4">
            {exams.map((exam) => (
              <ExamRowItem key={exam.id} exam={exam} today={today} subjectName={subjectName(exam.subjectId)} progress={examProgress(exam, topics)} onEdit={() => setEditing(exam)} onDelete={() => setRemoving(exam)} />
            ))}
          </ul>
        </Card>
        <PlanSettings />
      </div>
      {dialogs}
    </>
  );
}
