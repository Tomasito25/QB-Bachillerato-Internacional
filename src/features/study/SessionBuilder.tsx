import { ClipboardCheck, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { questionMarks } from '@core/exams/assemble';
import { filterQuestions, scopePredicate } from '@core/questions/filter';
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES, type Difficulty } from '@core/schema/common';
import type { QuestionType } from '@core/schema/question';
import type { ViewQuestion } from '@/features/bank/questionsRepo';
import { preferences } from '@/features/settings/preferences';
import type { TaxonomyView } from '@/features/taxonomy/taxonomyRepo';
import type { ProgressRow } from '@/infra/db/types';
import { Button } from '@/ui/Button';
import { Field, Input, Segmented, Select } from '@/ui/Field';
import { cn } from '@/ui/cn';
import { useLaunchSession } from './launch';

type Mode = 'practice' | 'exam';
type Source = 'smart' | 'new' | 'failed';

const COUNTS = [5, 10, 20, 40];
/** Lo que dan las pruebas del IB: unos 2 minutos por punto. */
const MINUTES_PER_MARK = 2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function NumberField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <Field label={label}>{(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={max} value={value} onChange={(e) => onChange(clamp(Math.round(Number(e.target.value)), 0, max))} />}</Field>;
}

/** Una sola forma de preparar una sesión: qué estudiar, cuánto y cómo. */
export function SessionBuilder({ questions, taxonomy, progress, initialSubject }: { questions: readonly ViewQuestion[]; taxonomy: TaxonomyView; progress: readonly ProgressRow[]; initialSubject?: string }) {
  const launch = useLaunchSession();
  const { practiceCount, studyScope } = preferences.use();
  const [mode, setMode] = useState<Mode>('practice');
  const [subjectId, setSubjectId] = useState(initialSubject ?? (taxonomy.subjects.length === 1 ? (taxonomy.subjects[0]?.id ?? '') : ''));
  const [unitId, setUnitId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [count, setCount] = useState(practiceCount);
  const [type, setType] = useState<QuestionType | 'all'>('all');
  const [source, setSource] = useState<Source>('smart');
  const [mcq, setMcq] = useState(10);
  const [open, setOpen] = useState(2);
  const [minutesEdited, setMinutesEdited] = useState<number | null>(null);

  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  const unit = subject?.units.find((u) => u.id === unitId);
  const scope = useMemo(() => ({ subjectId: subjectId || undefined, unitIds: unitId ? [unitId] : undefined, topicIds: topicId ? [topicId] : undefined, difficulties: difficulties.length > 0 ? difficulties : undefined }), [subjectId, unitId, topicId, difficulties]);

  const pool = useMemo(() => filterQuestions(questions, scope, taxonomy.index).filter(scopePredicate(studyScope)), [questions, scope, taxonomy, studyScope]);
  const mcqAvailable = pool.filter((q) => q.type === 'mcq').length;
  const openPool = pool.filter((q) => q.type === 'open');
  const averageMarks = openPool.length > 0 ? openPool.reduce((sum, q) => sum + questionMarks(q), 0) / openPool.length : 0;
  const suggested = Math.max(5, Math.round(MINUTES_PER_MARK * (Math.min(mcq, mcqAvailable) + Math.min(open, openPool.length) * averageMarks)));
  const minutes = minutesEdited ?? suggested;

  const practicePool = useMemo(() => {
    const state = new Map(progress.map((row) => [row.questionId, row]));
    const ofType = type === 'all' ? pool : pool.filter((q) => q.type === type);
    if (source === 'new') return ofType.filter((q) => !state.get(q.id)?.attempts);
    if (source === 'failed') return ofType.filter((q) => state.get(q.id)?.lastCorrect === false);
    return ofType;
  }, [pool, progress, source, type]);

  const title = taxonomy.index.topics.get(topicId)?.topic.name ?? unit?.name ?? subject?.name ?? 'Todo el banco';
  const available = mode === 'exam' ? Math.min(mcq, mcqAvailable) + Math.min(open, openPool.length) : Math.min(count, practicePool.length);

  const start = () => {
    if (mode === 'exam') {
      void launch({ mode: 'exam', title, config: { ...scope, count: mcq + open, mix: { mcq, open } }, timeLimitSec: minutes * 60 });
      return;
    }
    const types = type === 'all' ? undefined : [type];
    if (source === 'failed') void launch({ mode: 'review', title: `Falladas: ${title}`, config: { ...scope, types, count, source: 'failed' } });
    else void launch({ mode: 'practice', title, config: { ...scope, types, count, ...(source === 'new' ? { source: 'new' as const } : {}) } });
  };

  const bankLink = `/bank?${new URLSearchParams(Object.entries({ subject: subjectId, unit: unitId, topic: topicId, type: type === 'all' ? '' : type, difficulty: difficulties.join(',') }).filter(([, v]) => v)).toString()}`;

  return (
    <section className="flex flex-col gap-4 border-t-2 border-ink pt-3" aria-labelledby="session-builder">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="session-builder" className="qb-heading sm:text-[2.25rem]">
          Nueva sesión
        </h2>
        <Segmented label="Modo" value={mode} options={[{ value: 'practice', label: 'Práctica' }, { value: 'exam', label: 'Examen' }]} onChange={setMode} />
      </div>
      <p className="-mt-2 text-[0.9375rem] text-muted">{mode === 'practice' ? 'Con corrección y explicación al momento.' : 'Con reloj y sin soluciones hasta entregar.'}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Asignatura">
          {(id) => (
            <Select
              id={id}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setUnitId('');
                setTopicId('');
              }}
            >
              <option value="">Todas</option>
              {taxonomy.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unidad">
          {(id) => (
            <Select
              id={id}
              disabled={!subject}
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
                setTopicId('');
              }}
            >
              <option value="">Todas</option>
              {subject?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tema">
          {(id) => (
            <Select id={id} disabled={!unit} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">Todos</option>
              {unit?.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {mode === 'practice' ? (
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Cuántas preguntas">
            <p className="mb-1.5 text-[0.8125rem] font-bold">Cuántas</p>
            <div className="flex flex-wrap gap-1">
              {COUNTS.map((value) => (
                <button key={value} type="button" aria-pressed={count === value} onClick={() => setCount(value)} className={cn('h-11 min-w-11 border-2 border-ink px-3 text-sm font-bold tabular-nums', count === value ? 'bg-ink text-canvas' : 'bg-surface text-ink hover:bg-subtle')}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Segmented label="Tipo" value={type} options={[{ value: 'all', label: 'Todas' }, { value: 'mcq', label: 'Tipo test' }, { value: 'open', label: 'Desarrollo' }]} onChange={setType} />
            <Segmented label="Cuáles" value={source} options={[{ value: 'smart', label: 'Lo que toca' }, { value: 'new', label: 'Nuevas' }, { value: 'failed', label: 'Falladas' }]} onChange={setSource} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Tipo test" value={mcq} max={200} onChange={setMcq} />
          <NumberField label="Desarrollo" value={open} max={50} onChange={setOpen} />
          <Field label="Minutos" hint={minutesEdited === null ? '2 min por punto, como en el IB.' : undefined}>
            {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={300} value={minutes} onChange={(e) => setMinutesEdited(clamp(Math.round(Number(e.target.value)), 1, 300))} />}
          </Field>
        </div>
      )}

      <div role="group" aria-label="Dificultad" className="flex flex-wrap gap-1">
        {DIFFICULTY_VALUES.map((level) => (
          <button key={level} type="button" aria-pressed={difficulties.includes(level)} onClick={() => setDifficulties((list) => (list.includes(level) ? list.filter((x) => x !== level) : [...list, level]))} className={cn('h-9 border px-2.5 text-xs font-bold', difficulties.includes(level) ? 'border-accent bg-accent text-accent-ink' : 'border-border text-muted hover:border-border-strong hover:text-ink')}>
            {DIFFICULTY_LABELS[level]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-[0.875rem] text-muted" role="status">
          {mode === 'exam' ? (
            <>
              Hay <span className="font-bold text-ink tabular-nums">{mcqAvailable}</span> de tipo test y <span className="font-bold text-ink tabular-nums">{openPool.length}</span> de desarrollo.
            </>
          ) : (
            <>
              <span className="font-bold text-ink tabular-nums">{practicePool.length}</span> {practicePool.length === 1 ? 'disponible' : 'disponibles'}.
            </>
          )}{' '}
          <Link to={bankLink} className="underline underline-offset-2">
            Verlas
          </Link>
        </p>
        <Button variant="primary" disabled={available === 0} icon={mode === 'exam' ? <ClipboardCheck size={16} aria-hidden /> : <Play size={16} aria-hidden />} onClick={start}>
          {mode === 'exam' ? `Empezar examen de ${available}` : `Empezar práctica de ${available}`}
        </Button>
      </div>
    </section>
  );
}
