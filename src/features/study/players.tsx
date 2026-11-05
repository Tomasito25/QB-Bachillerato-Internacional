import { Check, CheckCircle2, Circle, Square, SquareCheck, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { correctAnswerIds, isCorrectSelection, SELF_GRADE_LABELS, suggestSelfGrade, type SelfGrade } from '@core/questions/grading';
import type { McqQuestion, OpenQuestion } from '@core/schema/question';
import { shuffledOptions } from '@core/study/select';
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
    <div role="status" className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium', ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
      {ok ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
      {ok ? 'Correcto' : selected.length === 0 ? 'Sin responder' : 'Incorrecto'}
    </div>
  );
}

interface OpenPlayerProps {
  question: OpenQuestion;
  /** La solución ya está visible. */
  revealed: boolean;
  committed: boolean;
  initialGrade?: SelfGrade;
  initialCriteria?: readonly string[];
  onGrade: (grade: SelfGrade, metCriteria: string[]) => void;
}

/**
 * Desarrollo: se puede contrastar con la solución o autoevaluar por criterios. Lo que se
 * escribe aquí no se guarda ni se publica: sirve para concretar la respuesta antes de mirar.
 */
export function OpenPlayer({ question, revealed, committed, initialGrade, initialCriteria, onGrade }: OpenPlayerProps) {
  const [draft, setDraft] = useState('');
  const [met, setMet] = useState<string[]>([...(initialCriteria ?? [])]);
  const suggestion = question.criteria.length > 0 ? suggestSelfGrade(question.criteria, met) : null;

  useEffect(() => {
    setDraft('');
    setMet([...(initialCriteria ?? [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de pregunta.
  }, [question.id]);

  return (
    <div className="flex flex-col gap-4">
      {!revealed ? (
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
          {draft.trim() ? (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Lo que has escrito</h3>
              <p className="rounded-md border border-border bg-subtle p-3 text-sm whitespace-pre-wrap">{draft}</p>
            </section>
          ) : null}
          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Respuesta modelo</h3>
            <Markdown source={question.modelAnswer} images={question.images} className="text-sm" />
          </section>
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
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Marca lo que has cumplido</h3>
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
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Cómo te ha salido?</h3>
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
            <p className="mt-1.5 text-xs text-muted">Decide cuándo vuelve a salir esta pregunta. No se puede verificar, así que apenas suma puntos oficiales.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
