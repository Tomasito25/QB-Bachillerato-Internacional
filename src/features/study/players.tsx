import { Check, CheckCircle2, Circle, Square, SquareCheck, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { correctAnswerIds, isCorrectSelection, SELF_GRADE_LABELS, suggestFromParts, suggestSelfGrade, type SelfGrade } from '@core/questions/grading';
import { gradedItems, partLabel, subpartLabel, type McqQuestion, type OpenQuestion } from '@core/schema/question';
import { shuffledOptions } from '@core/study/select';
import { PartBlock, SolutionBlock } from '@/features/bank/QuestionView';
import { Markdown } from '@/infra/markdown/Markdown';
import { Button } from '@/ui/Button';
import { Checkbox, Textarea } from '@/ui/Field';
import { Badge } from '@/ui/Surface';
import { cn } from '@/ui/cn';

const LETTERS = 'ABCDEFGHIJKL';

interface McqPlayerProps {
  sessionId: string;
  question: McqQuestion;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Corregida: muestra aciertos y fallos. */
  revealed: boolean;
  disabled?: boolean;
}

/** Selecciona con 1-9 o A-L. Va en el documento para no depender del foco. */
export function useOptionShortcuts(count: number, enabled: boolean, onPick: (index: number) => void) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const digit = Number(event.key);
      if (digit >= 1 && digit <= count) {
        event.preventDefault();
        onPick(digit - 1);
        return;
      }
      const letter = LETTERS.indexOf(event.key.toUpperCase());
      if (event.key.length === 1 && letter >= 0 && letter < count) {
        event.preventDefault();
        onPick(letter);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [count, enabled, onPick]);
}

export function McqPlayer({ sessionId, question, selected, onChange, revealed, disabled }: McqPlayerProps) {
  const options = useMemo(() => shuffledOptions(question.answers, sessionId, question.id), [question.answers, sessionId, question.id]);
  const correct = useMemo(() => new Set(correctAnswerIds(question)), [question]);
  const locked = revealed || disabled;

  const toggle = (id: string) => {
    if (locked) return;
    if (question.multiple) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else onChange(selected.includes(id) ? [] : [id]);
  };

  useOptionShortcuts(options.length, !locked, (index) => {
    const option = options[index];
    if (option) toggle(option.id);
  });

  return (
    <div>
      {question.multiple ? <p className="mb-2 text-xs font-medium text-muted">Puede haber varias correctas. Marca todas las que lo sean.</p> : null}
      <ul className="flex flex-col gap-2" role={question.multiple ? 'group' : 'radiogroup'} aria-label="Opciones de respuesta">
        {options.map((option, index) => {
          const isSelected = selected.includes(option.id);
          const isCorrect = correct.has(option.id);
          const state = revealed ? (isCorrect ? 'correct' : isSelected ? 'wrong' : 'plain') : isSelected ? 'selected' : 'plain';
          return (
            <li key={option.id}>
              <button
                type="button"
                role={question.multiple ? 'checkbox' : 'radio'}
                aria-checked={isSelected}
                disabled={locked}
                onClick={() => toggle(option.id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                  state === 'plain' && 'border-border bg-surface',
                  state === 'plain' && !locked && 'hover:border-border-strong hover:bg-subtle/60',
                  state === 'selected' && 'border-accent bg-accent-soft',
                  state === 'correct' && 'border-success bg-success-soft',
                  state === 'wrong' && 'border-danger bg-danger-soft',
                  locked && state === 'plain' && 'opacity-70',
                )}
              >
                <span className="mt-0.5 flex shrink-0 items-center gap-2">
                  <OptionIcon state={state} multiple={question.multiple} />
                  <span className="w-3 text-xs font-medium text-muted" aria-hidden>
                    {LETTERS[index]}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <Markdown source={option.text} images={question.images} />
                  {revealed && isCorrect ? <span className="mt-1 block text-xs font-medium text-success">Correcta</span> : null}
                  {revealed && !isCorrect && isSelected ? <span className="mt-1 block text-xs font-medium text-danger">Tu respuesta</span> : null}
                  {revealed && option.feedback ? <span className="mt-1 block text-xs text-muted">{option.feedback}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OptionIcon({ state, multiple }: { state: 'plain' | 'selected' | 'correct' | 'wrong'; multiple: boolean }) {
  if (state === 'correct') return <CheckCircle2 size={17} className="text-success" aria-hidden />;
  if (state === 'wrong') return <XCircle size={17} className="text-danger" aria-hidden />;
  if (multiple) return state === 'selected' ? <SquareCheck size={17} className="text-accent-text" aria-hidden /> : <Square size={17} className="text-faint" aria-hidden />;
  return state === 'selected' ? <CheckCircle2 size={17} className="text-accent-text" aria-hidden /> : <Circle size={17} className="text-faint" aria-hidden />;
}

export function McqResultBanner({ question, selected }: { question: McqQuestion; selected: readonly string[] }) {
  const ok = isCorrectSelection(question, selected);
  return (
    <div role="status" className={cn('flex items-center gap-2 px-3 py-2.5 text-[0.9375rem] font-bold', ok ? 'bg-success text-canvas' : 'bg-danger text-canvas')}>
      {ok ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
      {ok ? 'Correcto' : selected.length === 0 ? 'Sin responder' : 'Incorrecto'}
    </div>
  );
}

const WRITTEN_MAIN = 'main';

/** Desarrollo durante un examen: se ven los apartados, y lo escrito se guarda para compararlo al corregir. */
export function OpenExamAnswer({ question, initial, onChange }: { question: OpenQuestion; initial?: Record<string, string>; onChange: (written: Record<string, string>) => void }) {
  const [texts, setTexts] = useState<Record<string, string>>(initial ?? {});
  const unsaved = useRef<Record<string, string> | null>(null);
  const timer = useRef(0);
  const save = useRef(onChange);
  save.current = onChange;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (unsaved.current) save.current(unsaved.current);
    },
    [],
  );

  const update = (id: string, value: string) => {
    const next = { ...texts, [id]: value };
    setTexts(next);
    unsaved.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      save.current(next);
      unsaved.current = null;
    }, 500);
  };

  const field = (id: string, label: string) => <Textarea rows={3} value={texts[id] ?? ''} onChange={(e) => update(id, e.target.value)} placeholder="Escribe aquí, o resuélvelo en papel." aria-label={`Tu respuesta al apartado ${label}`} />;

  const parts = question.parts ?? [];
  if (parts.length === 0) return <Textarea rows={6} value={texts[WRITTEN_MAIN] ?? ''} onChange={(e) => update(WRITTEN_MAIN, e.target.value)} placeholder="Escribe aquí, o resuélvelo en papel." aria-label="Tu respuesta" />;
  return (
    <ol className="flex flex-col gap-5">
      {parts.map((part, index) => (
        <PartBlock key={part.id} question={question} label={partLabel(index)} statement={part.statement} marks={part.marks}>
          {part.subparts ? (
            <ol className="flex flex-col gap-4">
              {part.subparts.map((sub, subIndex) => (
                <PartBlock key={sub.id} question={question} label={subpartLabel(subIndex)} statement={sub.statement} marks={sub.marks}>
                  {field(`${part.id}.${sub.id}`, `${partLabel(index)} ${subpartLabel(subIndex)}`)}
                </PartBlock>
              ))}
            </ol>
          ) : (
            field(part.id, partLabel(index))
          )}
        </PartBlock>
      ))}
    </ol>
  );
}

interface OpenPlayerProps {
  question: OpenQuestion;
  /** La solución ya está visible. */
  revealed: boolean;
  committed: boolean;
  initialGrade?: SelfGrade;
  initialCriteria?: readonly string[];
  /** Lo que se escribió en el examen. */
  written?: Readonly<Record<string, string>>;
  onGrade: (grade: SelfGrade, metCriteria: string[]) => void;
}

/**
 * Desarrollo: se puede contrastar con la solución o autoevaluar por criterios. Lo que se
 * escribe aquí no se guarda ni se publica: sirve para concretar la respuesta antes de mirar.
 */
function PartGrade({ label, value, onChange }: { label: string; value: SelfGrade | undefined; onChange: (grade: SelfGrade) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`¿Cómo te ha salido el apartado ${label}?`}>
      <span className="text-xs text-muted">¿Qué tal te ha salido?</span>
      {([0, 1, 2] as const).map((grade) => (
        <Button key={grade} size="sm" variant={value === grade ? 'primary' : 'secondary'} aria-pressed={value === grade} onClick={() => onChange(grade)}>
          {SELF_GRADE_LABELS[grade]}
        </Button>
      ))}
    </div>
  );
}

export function OpenPlayer({ question, revealed, committed, initialGrade, initialCriteria, written, onGrade }: OpenPlayerProps) {
  const [draft, setDraft] = useState(written?.[WRITTEN_MAIN] ?? '');
  const [drafts, setDrafts] = useState<Record<string, string>>({ ...written });
  const [partGrades, setPartGrades] = useState<Record<string, SelfGrade>>({});
  const [met, setMet] = useState<string[]>([...(initialCriteria ?? [])]);
  const parts = question.parts ?? [];
  const suggestion = parts.length > 0 ? suggestFromParts(gradedItems(parts), partGrades) : question.criteria.length > 0 ? suggestSelfGrade(question.criteria, met) : null;

  /** Lo que va bajo cada cosa que se responde: la caja de texto y, al corregir, solución y valoración. */
  const answerArea = (id: string, label: string, modelAnswer: string) =>
    !revealed ? (
      <Textarea rows={3} value={drafts[id] ?? ''} onChange={(e) => setDrafts((current) => ({ ...current, [id]: e.target.value }))} placeholder="Tu respuesta, antes de ver la solución. No se guarda." aria-label={`Tu respuesta al apartado ${label}`} />
    ) : (
      <>
        {drafts[id]?.trim() ? <p className="rounded-md border border-border bg-subtle p-3 text-sm whitespace-pre-wrap">{drafts[id]}</p> : null}
        <SolutionBlock title="Solución" source={modelAnswer} question={question} />
        {!committed ? <PartGrade label={label} value={partGrades[id]} onChange={(grade) => setPartGrades((current) => ({ ...current, [id]: grade }))} /> : null}
      </>
    );

  useEffect(() => {
    setDraft(written?.[WRITTEN_MAIN] ?? '');
    setDrafts({ ...written });
    setPartGrades({});
    setMet([...(initialCriteria ?? [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de pregunta.
  }, [question.id]);

  return (
    <div className="flex flex-col gap-4">
      {parts.length > 0 ? (
        <ol className="flex flex-col gap-5">
          {parts.map((part, index) => (
            <PartBlock key={part.id} question={question} label={partLabel(index)} statement={part.statement} marks={part.marks}>
              {part.subparts ? (
                <ol className="flex flex-col gap-4">
                  {part.subparts.map((sub, subIndex) => (
                    <PartBlock key={sub.id} question={question} label={subpartLabel(subIndex)} statement={sub.statement} marks={sub.marks}>
                      {answerArea(`${part.id}.${sub.id}`, `${partLabel(index)} ${subpartLabel(subIndex)}`, sub.modelAnswer)}
                    </PartBlock>
                  ))}
                </ol>
              ) : (
                answerArea(part.id, partLabel(index), part.modelAnswer)
              )}
              {part.subparts && part.modelAnswer && revealed ? <SolutionBlock title="Solución común" source={part.modelAnswer} question={question} /> : null}
            </PartBlock>
          ))}
        </ol>
      ) : !revealed ? (
        <Textarea
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe tu respuesta, o piénsala, antes de ver la solución. No se guarda."
          aria-label="Tu respuesta"
        />
      ) : null}
      {revealed ? (
        <>
          {parts.length === 0 && draft.trim() ? (
            <section>
              <h3 className="mb-1.5 text-[0.9375rem] font-bold">Lo que has escrito</h3>
              <p className="rounded-md border border-border bg-subtle p-3 text-sm whitespace-pre-wrap">{draft}</p>
            </section>
          ) : null}
          {question.modelAnswer ? <SolutionBlock title={parts.length > 0 ? 'Solución general' : 'Respuesta modelo'} source={question.modelAnswer} question={question} /> : null}
          {question.keywords.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Palabras clave:</span>
              {question.keywords.map((keyword) => (
                <Badge key={keyword}>{keyword}</Badge>
              ))}
            </div>
          ) : null}
          {question.criteria.length > 0 ? (
            <section>
              <h3 className="mb-1.5 text-[0.9375rem] font-bold">Marca lo que has cumplido</h3>
              <ul className="flex flex-col gap-1.5">
                {question.criteria.map((criterion) => (
                  <li key={criterion.id}>
                    <Checkbox
                      disabled={committed}
                      checked={met.includes(criterion.id)}
                      onChange={(checked) => setMet((current) => (checked ? [...current, criterion.id] : current.filter((id) => id !== criterion.id)))}
                      label={
                        <>
                          {criterion.text} <span className="text-xs text-muted">({criterion.weight})</span>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="mb-1.5 text-[0.9375rem] font-bold">{parts.length > 0 ? 'En total, ¿cómo te ha salido?' : '¿Cómo te ha salido?'}</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Autoevaluación">
              {([0, 1, 2] as const).map((grade) => (
                <Button
                  key={grade}
                  disabled={committed}
                  aria-pressed={initialGrade === grade}
                  variant={initialGrade === grade || (!committed && suggestion === grade) ? 'primary' : 'secondary'}
                  onClick={() => onGrade(grade, met)}
                >
                  {SELF_GRADE_LABELS[grade]}
                  {!committed && suggestion === grade ? ' (sugerida)' : ''}
                </Button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {parts.length > 0 && !committed ? 'Valora cada apartado y se sugiere la nota, pesando por sus puntos. ' : ''}
              Decide cuándo vuelve a salir esta pregunta. No se puede verificar, así que apenas suma puntos oficiales.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
