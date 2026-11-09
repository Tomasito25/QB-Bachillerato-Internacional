import { ArrowDown, ArrowUp, Eye, Image as ImageIcon, ImagePlus, Plus, Save, Sigma, Trash2, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DIFFICULTY_LABELS } from '@core/schema/common';
import { LIMITS, partLabel, subpartLabel, type QuestionImage, type Reference } from '@core/schema/question';
import { duplicateIndexEntry, findDuplicates } from '@core/questions/normalize';
import type { Question } from '@core/schema/question';
import { QuestionView } from '@/features/bank/QuestionView';
import { getQuestion, saveLocalQuestion, toQuestion, useQuestions } from '@/features/bank/questionsRepo';
import { TopicPicker } from '@/features/taxonomy/TopicPicker';
import { DEFAULT_IMAGE_OPTIONS, ImageError, processImage, saveLocalImage } from '@/infra/images/process';
import { AttachedImage, Markdown } from '@/infra/markdown/Markdown';
import { requestPersistence } from '@/infra/pwa/pwa';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Checkbox, Field, Input, Toggle } from '@/ui/Field';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { deleteDraft, loadDraft, saveDraft } from './drafts';
import { DIFFICULTIES, formToQuestion, hasErrors, newForm, nextId, questionToForm, removeImageReferences, type FormErrors, type QuestionForm } from './form';
import { MarkdownEditor, ToolButton, useMarkdownField } from './MarkdownEditor';

type SaveStatus = 'idle' | 'pending' | 'saved';

interface Loaded {
  form: QuestionForm;
  mode: 'new' | 'edit';
  fromDraft: boolean;
}

function useInitialForm(): Loaded | null | 'missing' {
  const { id } = useParams();
  const [search] = useSearchParams();
  const draftId = search.get('draft');
  const fromId = search.get('from');
  const subject = search.get('subject') ?? '';
  const topic = search.get('topic');
  const [state, setState] = useState<Loaded | null | 'missing'>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<Loaded | 'missing'> => {
      if (id) {
        const draft = await loadDraft(id);
        if (draft) return { form: draft, mode: 'edit', fromDraft: true };
        const question = await getQuestion(id);
        if (!question) return 'missing';
        const form = questionToForm(toQuestion(question));
        // Editar algo publicado crea la siguiente revisión, encima de la que se está viendo.
        if (question.origin === 'community') return { form: { ...form, baseRev: question.rev, rev: question.rev + 1 }, mode: 'edit', fromDraft: false };
        return { form: { ...form, baseRev: question.local?.baseRev ?? null }, mode: 'edit', fromDraft: false };
      }
      if (draftId) {
        const draft = await loadDraft(draftId);
        return draft ? { form: draft, mode: draft.baseRev !== null ? 'edit' : 'new', fromDraft: true } : 'missing';
      }
      if (fromId) {
        const question = await getQuestion(fromId);
        if (!question) return 'missing';
        const form = questionToForm(toQuestion(question));
        return { form: { ...form, id: crypto.randomUUID(), rev: 1, baseRev: null, createdAt: null, author: null, derivedFrom: question.id }, mode: 'new', fromDraft: false };
      }
      return { form: newForm(subject, topic ? [topic] : []), mode: 'new', fromDraft: false };
    };
    void load().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id, draftId, fromId, subject, topic]);

  return state;
}

export default function EditorPage() {
  const loaded = useInitialForm();
  if (loaded === null) return <Spinner />;
  if (loaded === 'missing') {
    return (
      <EmptyState title="No se encuentra esa pregunta" action={<Link to="/bank" className="underline underline-offset-2">Volver al banco</Link>}>
        Puede que ya se haya guardado o que el borrador se descartara.
      </EmptyState>
    );
  }
  return <EditorForm key={loaded.form.id} loaded={loaded} />;
}

function EditorForm({ loaded }: { loaded: Loaded }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(loaded.form);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SaveStatus>(loaded.fromDraft ? 'saved' : 'idle');
  const [preview, setPreview] = useState<Question | null>(null);
  const [showSolution, setShowSolution] = useState(true);

  // Borrador automático: nada de lo escrito se pierde al cerrar o al recargar.
  const latest = useRef(form);
  const dirty = useRef(false);
  const saved = useRef(false);
  useEffect(() => {
    latest.current = form;
    // Sin tocar nada no hay borrador. Se compara el objeto, no se cuentan los renders:
    // React puede ejecutar este efecto dos veces al montar.
    if (form === loaded.form) return;
    dirty.current = true;
    setStatus('pending');
    const timer = window.setTimeout(() => {
      dirty.current = false;
      void saveDraft(form).then(() => {
        setStatus('saved');
        void requestPersistence();
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [form, loaded.form]);
  useEffect(
    () => () => {
      if (dirty.current && !saved.current) void saveDraft(latest.current);
    },
    [],
  );

  const update = (patch: Partial<QuestionForm>) => setForm((current) => ({ ...current, ...patch }));

  const uploadImage = async (file: File): Promise<QuestionImage | null> => {
    if (form.images.length >= LIMITS.images) {
      toast.error(`Una pregunta admite un máximo de ${LIMITS.images} imágenes.`);
      return null;
    }
    try {
      const row = await saveLocalImage(await processImage(file, DEFAULT_IMAGE_OPTIONS));
      const image: QuestionImage = { hash: row.hash, ext: row.ext, width: row.width, height: row.height, bytes: row.bytes, alt: row.alt };
      setForm((current) => (current.images.some((i) => i.hash === image.hash) ? current : { ...current, images: [...current.images, image] }));
      return image;
    } catch (error) {
      toast.error(error instanceof ImageError ? error.message : 'No se ha podido guardar la imagen.');
      return null;
    }
  };

  const validate = (): Question | null => {
    const result = formToQuestion(form);
    setErrors(result.errors);
    if (hasErrors(result.errors)) {
      toast.error('Revisa los campos marcados.');
      return null;
    }
    return result.question;
  };

  const save = async () => {
    const question = validate();
    if (!question) return;
    saved.current = true;
    await saveLocalQuestion(question, form.baseRev);
    await deleteDraft(form.id);
    toast.success('Pregunta guardada en este dispositivo.');
    navigate(`/q/${form.id}`);
  };

  const discard = async () => {
    saved.current = true;
    await deleteDraft(form.id);
    toast.info('Borrador descartado.');
    navigate(-1);
  };

  return (
    <>
      <PageHeader
        title={loaded.mode === 'edit' ? 'Editar pregunta' : 'Nueva pregunta'}
        description={loaded.fromDraft ? 'Has vuelto a un borrador guardado.' : undefined}
        documentTitle={loaded.mode === 'edit' ? 'Editar pregunta' : 'Crear pregunta'}
      />

      <div className="flex flex-col gap-4 pb-16">
        <div role="radiogroup" aria-label="Tipo de pregunta" className="inline-flex w-fit border-2 border-ink">
          {(
            [
              ['mcq', 'Tipo test'],
              ['open', 'Desarrollo'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.type === value}
              onClick={() => update({ type: value })}
              className={cn('min-h-9 px-3 text-[0.8125rem] font-bold', form.type === value ? 'bg-ink text-canvas' : 'text-ink hover:bg-subtle')}
            >
              {label}
            </button>
          ))}
        </div>

        <Card className="p-4">
          <MarkdownEditor
            label="Enunciado"
            value={form.statement}
            onChange={(statement) => update({ statement })}
            error={errors.statement}
            images={form.images}
            onUploadImage={uploadImage}
            rows={5}
            placeholder="Escribe la pregunta. Fórmulas entre dólares: $E = mc^2$"
            hint="Puedes pegar o arrastrar imágenes directamente."
          />
          <LiveDuplicates form={form} />
        </Card>

        {form.type === 'mcq' ? <AnswersCard form={form} update={update} error={errors.answers} uploadImage={uploadImage} /> : (
          <>
            <PartsCard form={form} update={update} error={errors.parts} uploadImage={uploadImage} />
            <OpenAnswerCard form={form} update={update} errors={errors} uploadImage={uploadImage} />
          </>
        )}

        <Card className="p-4">
          <MarkdownEditor
            label="Explicación (opcional)"
            value={form.explanation}
            onChange={(explanation) => update({ explanation })}
            error={errors.explanation}
            images={form.images}
            onUploadImage={uploadImage}
            rows={3}
            hint="Por qué es correcta. Es lo que más ayuda a quien se equivoca."
          />
        </Card>

        <Card>
          <CardHeader title="Clasificación" />
          <div className="flex flex-col gap-4 p-4">
            <TopicPicker subjectId={form.subjectId} topicIds={form.topicIds} onChange={update} error={errors.topics} />
            <div>
              <p className="mb-1.5 text-[0.8125rem] font-medium" id="difficulty-label">
                Dificultad
              </p>
              <div role="radiogroup" aria-labelledby="difficulty-label" className="flex flex-wrap gap-1.5">
                {DIFFICULTIES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={form.difficulty === level}
                    onClick={() => update({ difficulty: level })}
                    className={cn(
                      'h-8 rounded-md border px-2.5 text-[0.8125rem] font-medium transition-colors',
                      form.difficulty === level ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-muted hover:border-border-strong hover:text-ink',
                    )}
                  >
                    {DIFFICULTY_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
            <ChipsInput label="Etiquetas (opcional)" values={form.tags} max={LIMITS.maxTags} maxLength={LIMITS.tag} onChange={(tags) => update({ tags })} />
          </div>
        </Card>

        <ImagesCard form={form} setForm={setForm} uploadImage={uploadImage} error={errors.images} />
        <ReferencesCard references={form.references} onChange={(references) => update({ references })} error={errors.references} />

        {form.type === 'mcq' ? (
          <Card>
            <CardHeader title="Cómo se muestra la solución" />
            <div className="flex flex-col gap-4 p-4">
              <Toggle label="Mostrar la explicación después de responder" checked={form.explanationAfterAnswer} onChange={(explanationAfterAnswer) => update({ explanationAfterAnswer })} />
              <Toggle label="Mostrar las soluciones al finalizar un examen" checked={form.solutionsAtExamEnd} onChange={(solutionsAtExamEnd) => update({ solutionsAtExamEnd })} />
            </div>
          </Card>
        ) : null}

        {errors.general ? <Notice tone="danger" title="No se puede guardar">{errors.general}</Notice> : null}
      </div>

      <div className="safe-bottom sticky bottom-16 z-10 -mx-[var(--gutter)] flex flex-wrap items-center justify-between gap-2 border-t-2 border-ink bg-canvas px-[var(--gutter)] py-2.5 lg:bottom-0">
        <p className="text-xs text-muted" role="status">
          {status === 'pending' ? 'Guardando borrador…' : status === 'saved' ? 'Borrador guardado en este dispositivo' : 'Se guardará un borrador mientras escribes'}
        </p>
        <div className="flex flex-wrap gap-2">
          {loaded.fromDraft || status !== 'idle' ? (
            <Button variant="ghost" onClick={() => void discard()}>
              Descartar
            </Button>
          ) : null}
          <Button
            icon={<Eye size={16} aria-hidden />}
            onClick={() => {
              const question = validate();
              if (question) setPreview(question);
            }}
          >
            Previsualizar
          </Button>
          <Button variant="primary" icon={<Save size={16} aria-hidden />} onClick={() => void save()}>
            Guardar
          </Button>
        </div>
      </div>

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title="Así se verá" size="lg" footer={<Button onClick={() => setShowSolution((v) => !v)}>{showSolution ? 'Ocultar solución' : 'Mostrar solución'}</Button>}>
        {preview ? <QuestionView question={preview} showSolution={showSolution} /> : null}
      </Dialog>
    </>
  );
}

/** Avisa mientras se escribe, antes de invertir tiempo en una pregunta que ya existe. */
function LiveDuplicates({ form }: { form: QuestionForm }) {
  const questions = useQuestions();
  const statement = useDeferredValue(form.statement);
  const answers = useDeferredValue(form.answers);
  const entries = useMemo(() => questions?.map(duplicateIndexEntry) ?? [], [questions]);
  const matches = useMemo(() => {
    if (statement.trim().length < 15) return [];
    const candidate = { id: form.id, type: form.type, statement, answers } as unknown as Question;
    return findDuplicates(candidate, entries).slice(0, 3);
  }, [statement, answers, entries, form.id, form.type]);
  if (matches.length === 0) return null;
  const top = matches[0];
  return (
    <Notice tone="warning" className="mt-3" title={top?.exact ? 'Ya existe una pregunta igual' : 'Hay una pregunta muy parecida'}>
      {matches.map((match, i) => (
        <span key={match.id}>
          {i > 0 ? ' · ' : ''}
          <Link to={`/q/${match.id}`} target="_blank" className="underline underline-offset-2">
            Ver {matches.length > 1 ? `la ${i + 1}.ª` : 'pregunta'}
          </Link>
          {match.exact ? '' : ` (${Math.round(match.similarity * 100)} %)`}
        </span>
      ))}
      {top?.exact ? '. Al publicar, una copia exacta se rechaza.' : '. Al publicar pasará a revisión manual.'}
    </Notice>
  );
}

/** Con fórmulas, imágenes o formato, se ve debajo cómo quedará. */
const RICH_TEXT = /[$*`_]|qbimg:|\\\(/;

function AnswerRow(props: {
  answer: QuestionForm['answers'][number];
  index: number;
  count: number;
  multiple: boolean;
  group: string;
  images: readonly QuestionImage[];
  uploadImage: (file: File) => Promise<QuestionImage | null>;
  onChange: (patch: Partial<QuestionForm['answers'][number]>) => void;
  onMarkCorrect: (checked: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { answer, index, count, multiple, group, images, uploadImage, onChange, onMarkCorrect, onMove, onRemove } = props;
  const field = useMarkdownField(answer.text, (text) => onChange({ text }), uploadImage);
  const n = index + 1;
  return (
    <li className={cn('rounded-md border p-2', answer.correct ? 'border-success bg-success-soft/40' : 'border-border')}>
      <div className="flex items-start gap-2">
        <label className="mt-2 flex shrink-0 cursor-pointer items-center" title="Marcar como correcta">
          <input type={multiple ? 'checkbox' : 'radio'} name={group} checked={answer.correct} onChange={(e) => onMarkCorrect(e.target.checked)} className="size-4 accent-[var(--success)]" aria-label={`Opción ${n} correcta`} />
        </label>
        <div className="min-w-0 flex-1">
          <textarea
            ref={field.textarea}
            rows={1}
            value={answer.text}
            onChange={(e) => onChange({ text: e.target.value })}
            onPaste={field.onPaste}
            onDrop={field.onDrop}
            aria-label={`Texto de la opción ${n}`}
            placeholder={`Opción ${n}`}
            className="field-sizing-content min-h-9 w-full min-w-0 resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
          {RICH_TEXT.test(answer.text) ? (
            <div className="mt-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm" aria-label={`Así se verá la opción ${n}`}>
              <Markdown source={answer.text} images={images} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" title="Subir" aria-label={`Subir opción ${n}`} disabled={index === 0} onClick={() => onMove(-1)} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover disabled:opacity-30">
            <ArrowUp size={14} aria-hidden />
          </button>
          <button type="button" title="Bajar" aria-label={`Bajar opción ${n}`} disabled={index === count - 1} onClick={() => onMove(1)} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover disabled:opacity-30">
            <ArrowDown size={14} aria-hidden />
          </button>
          <button type="button" title="Eliminar" aria-label={`Eliminar opción ${n}`} disabled={count <= LIMITS.minAnswers} onClick={onRemove} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover hover:text-danger disabled:opacity-30">
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </div>
      <div className="mt-1 ml-6 flex items-center gap-0.5">
        <ToolButton label={`Fórmula en la opción ${n}`} onClick={() => field.openFormula(false)}>
          <Sigma size={14} aria-hidden />
        </ToolButton>
        <ToolButton label={field.uploading ? 'Subiendo imagen…' : `Imagen en la opción ${n}`} onClick={field.pickImages}>
          <ImageIcon size={14} aria-hidden />
        </ToolButton>
        <input
          value={answer.feedback}
          onChange={(e) => onChange({ feedback: e.target.value })}
          placeholder="Comentario (opcional)"
          aria-label={`Comentario de la opción ${n}`}
          maxLength={LIMITS.answerFeedback}
          className="ml-1 min-w-0 flex-1 bg-transparent px-1 text-xs text-muted outline-none placeholder:text-faint focus:text-ink"
        />
      </div>
      {field.dialogs}
    </li>
  );
}

function AnswersCard({ form, update, error, uploadImage }: { form: QuestionForm; update: (patch: Partial<QuestionForm>) => void; error?: string; uploadImage: (file: File) => Promise<QuestionImage | null> }) {
  const setAnswer = (id: string, patch: Partial<QuestionForm['answers'][number]>) => update({ answers: form.answers.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const markCorrect = (id: string, checked: boolean) => {
    if (form.multiple) setAnswer(id, { correct: checked });
    else update({ answers: form.answers.map((a) => ({ ...a, correct: a.id === id })) });
  };
  const move = (index: number, delta: -1 | 1) => {
    const answers = [...form.answers];
    const [item] = answers.splice(index, 1);
    if (item) answers.splice(index + delta, 0, item);
    update({ answers });
  };
  return (
    <Card>
      <CardHeader
        title="Respuestas"
        description="Marca la correcta. Cada opción admite fórmulas (Σ) e imágenes. El orden se puede barajar al estudiar."
        action={
          <Checkbox
            checked={form.multiple}
            label="Varias correctas"
            onChange={(multiple) => {
              // Al volver a respuesta única, sólo puede quedar marcada una.
              const firstCorrect = form.answers.find((a) => a.correct)?.id;
              update({ multiple, answers: multiple ? form.answers : form.answers.map((a) => ({ ...a, correct: a.id === firstCorrect })) });
            }}
          />
        }
      />
      <div className="flex flex-col gap-2 p-4">
        <ul className="flex flex-col gap-2" aria-label="Opciones de respuesta">
          {form.answers.map((answer, index) => (
            <AnswerRow
              key={answer.id}
              answer={answer}
              index={index}
              count={form.answers.length}
              multiple={form.multiple}
              group={`correct-${form.id}`}
              images={form.images}
              uploadImage={uploadImage}
              onChange={(patch) => setAnswer(answer.id, patch)}
              onMarkCorrect={(checked) => markCorrect(answer.id, checked)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => update({ answers: form.answers.filter((a) => a.id !== answer.id) })}
            />
          ))}
        </ul>
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          size="sm"
          className="w-fit"
          disabled={form.answers.length >= LIMITS.maxAnswers}
          icon={<Plus size={14} aria-hidden />}
          onClick={() => update({ answers: [...form.answers, { id: nextId(form.answers), text: '', correct: false, feedback: '' }] })}
        >
          Añadir opción
        </Button>
      </div>
    </Card>
  );
}

/** Subir, bajar y eliminar. Los apartados y subapartados los llevan iguales. */
function ItemTools({ name, index, count, onMove, onRemove }: { name: string; index: number; count: number; onMove: (delta: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center">
      <button type="button" title="Subir" aria-label={`Subir ${name}`} disabled={index === 0} onClick={() => onMove(-1)} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover disabled:opacity-30">
        <ArrowUp size={14} aria-hidden />
      </button>
      <button type="button" title="Bajar" aria-label={`Bajar ${name}`} disabled={index === count - 1} onClick={() => onMove(1)} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover disabled:opacity-30">
        <ArrowDown size={14} aria-hidden />
      </button>
      <button type="button" title="Eliminar" aria-label={`Eliminar ${name}`} onClick={onRemove} className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover hover:text-danger">
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}

function MarksInput({ name, value, onChange }: { name: string; value: number | null; onChange: (marks: number | null) => void }) {
  return (
    <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
      Puntos
      <Input type="number" min={1} max={LIMITS.partMarks} placeholder="—" value={value ?? ''} aria-label={`Puntos ${name}`} onChange={(e) => onChange(e.target.value === '' ? null : Math.min(LIMITS.partMarks, Math.max(1, Math.round(Number(e.target.value)) || 1)))} className="h-8 w-16 text-center" />
    </label>
  );
}

function moved<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  if (item) copy.splice(index + delta, 0, item);
  return copy;
}

function PartsCard({ form, update, error, uploadImage }: { form: QuestionForm; update: (patch: Partial<QuestionForm>) => void; error?: string; uploadImage: (file: File) => Promise<QuestionImage | null> }) {
  type Part = QuestionForm['parts'][number];
  type Sub = Part['subparts'][number];
  const setPart = (id: string, patch: Partial<Part>) => update({ parts: form.parts.map((part) => (part.id === id ? { ...part, ...patch } : part)) });
  const setSub = (part: Part, id: string, patch: Partial<Sub>) => setPart(part.id, { subparts: part.subparts.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)) });
  const add = (count: number) => {
    const parts = [...form.parts];
    for (let i = 0; i < count && parts.length < LIMITS.maxParts; i++) parts.push({ id: nextId(parts), statement: '', modelAnswer: '', marks: null, subparts: [] });
    update({ parts });
  };
  // Al dividir un apartado, lo que ya tenía de solución y puntos pasa al primer subapartado.
  const addSub = (part: Part) => {
    const first = part.subparts.length === 0;
    setPart(part.id, { subparts: [...part.subparts, { id: nextId(part.subparts), statement: '', modelAnswer: first ? part.modelAnswer : '', marks: first ? part.marks : null }], ...(first ? { modelAnswer: '', marks: null } : {}) });
  };
  const editors = { images: form.images, onUploadImage: uploadImage };
  return (
    <Card>
      <CardHeader title="Apartados (opcional)" description="Para preguntas como las de examen: el enunciado de arriba es el común y cada apartado tiene su pregunta, su solución, sus imágenes y, si quieres, sus puntos. Un apartado se puede dividir en subapartados i), ii)…" />
      <div className="flex flex-col gap-3 p-4">
        {form.parts.length === 0 ? (
          <Button size="sm" className="w-fit" icon={<Plus size={14} aria-hidden />} onClick={() => add(2)}>
            Dividir en apartados
          </Button>
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Apartados">
            {form.parts.map((part, index) => {
              const label = partLabel(index);
              const divided = part.subparts.length > 0;
              return (
                <li key={part.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">Apartado {label}</p>
                    {divided ? <span className="ml-auto" /> : <MarksInput name={`del apartado ${label}`} value={part.marks} onChange={(marks) => setPart(part.id, { marks })} />}
                    <ItemTools name={`apartado ${label}`} index={index} count={form.parts.length} onMove={(delta) => update({ parts: moved(form.parts, index, delta) })} onRemove={() => update({ parts: form.parts.filter((p) => p.id !== part.id) })} />
                  </div>
                  <MarkdownEditor label={divided ? `Texto común del apartado ${label} (opcional)` : `Pregunta del apartado ${label}`} value={part.statement} onChange={(statement) => setPart(part.id, { statement })} rows={divided ? 2 : 3} {...editors} />
                  {divided ? null : <MarkdownEditor label={`Solución del apartado ${label}`} value={part.modelAnswer} onChange={(modelAnswer) => setPart(part.id, { modelAnswer })} rows={4} {...editors} />}
                  {divided ? (
                    <ol className="flex flex-col gap-3" aria-label={`Subapartados de ${label}`}>
                      {part.subparts.map((sub, subIndex) => {
                        const subLabel = `${label} ${subpartLabel(subIndex)}`;
                        return (
                          <li key={sub.id} className="flex flex-col gap-3 rounded-md border border-dashed border-border-strong p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[0.8125rem] font-semibold">Subapartado {subpartLabel(subIndex)}</p>
                              <MarksInput name={`del subapartado ${subLabel}`} value={sub.marks} onChange={(marks) => setSub(part, sub.id, { marks })} />
                              <ItemTools name={`subapartado ${subLabel}`} index={subIndex} count={part.subparts.length} onMove={(delta) => setPart(part.id, { subparts: moved(part.subparts, subIndex, delta) })} onRemove={() => setPart(part.id, { subparts: part.subparts.filter((s) => s.id !== sub.id) })} />
                            </div>
                            <MarkdownEditor label={`Pregunta del subapartado ${subLabel}`} value={sub.statement} onChange={(statement) => setSub(part, sub.id, { statement })} rows={2} {...editors} />
                            <MarkdownEditor label={`Solución del subapartado ${subLabel}`} value={sub.modelAnswer} onChange={(modelAnswer) => setSub(part, sub.id, { modelAnswer })} rows={3} {...editors} />
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  <Button size="sm" variant="ghost" className="w-fit" disabled={part.subparts.length >= LIMITS.maxSubparts} icon={<Plus size={14} aria-hidden />} onClick={() => addSub(part)}>
                    {divided ? 'Añadir subapartado' : 'Dividir en subapartados'}
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {form.parts.length > 0 ? (
          <Button size="sm" className="w-fit" disabled={form.parts.length >= LIMITS.maxParts} icon={<Plus size={14} aria-hidden />} onClick={() => add(1)}>
            Añadir apartado
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function OpenAnswerCard({ form, update, errors, uploadImage }: { form: QuestionForm; update: (patch: Partial<QuestionForm>) => void; errors: FormErrors; uploadImage: (file: File) => Promise<QuestionImage | null> }) {
  const setCriterion = (id: string, patch: Partial<QuestionForm['criteria'][number]>) => update({ criteria: form.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  return (
    <Card>
      <CardHeader title="Respuesta" description="Se compara después con lo que haya escrito o pensado el estudiante." />
      <div className="flex flex-col gap-4 p-4">
        <MarkdownEditor
          label={form.parts.length > 0 ? 'Solución general (opcional)' : 'Solución o respuesta modelo'}
          hint={form.parts.length > 0 ? 'Cada apartado lleva la suya: aquí, lo que valga para todos.' : undefined}
          value={form.modelAnswer}
          onChange={(modelAnswer) => update({ modelAnswer })}
          error={errors.modelAnswer}
          images={form.images}
          onUploadImage={uploadImage}
          rows={form.parts.length > 0 ? 3 : 6}
        />
        <div>
          <p className="text-[0.8125rem] font-medium">Criterios de corrección (opcional)</p>
          <p className="mb-2 text-xs text-muted">Sirven para autoevaluarse: el estudiante marca los que cumple y se le sugiere una nota.</p>
          <ul className="flex flex-col gap-1.5">
            {form.criteria.map((criterion, index) => (
              <li key={criterion.id} className="flex items-center gap-1.5">
                <Input value={criterion.text} maxLength={LIMITS.criterion} placeholder={`Criterio ${index + 1}`} aria-label={`Criterio ${index + 1}`} onChange={(e) => setCriterion(criterion.id, { text: e.target.value })} />
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={criterion.weight}
                  title="Peso"
                  aria-label={`Peso del criterio ${index + 1}`}
                  onChange={(e) => setCriterion(criterion.id, { weight: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                  className="w-16 shrink-0 text-center"
                />
                <button type="button" aria-label={`Eliminar criterio ${index + 1}`} onClick={() => update({ criteria: form.criteria.filter((c) => c.id !== criterion.id) })} className="inline-flex size-8 shrink-0 items-center justify-center rounded-none text-muted hover:bg-hover hover:text-danger">
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-2"
            disabled={form.criteria.length >= LIMITS.maxCriteria}
            icon={<Plus size={14} aria-hidden />}
            onClick={() => update({ criteria: [...form.criteria, { id: nextId(form.criteria), text: '', weight: 1 }] })}
          >
            Añadir criterio
          </Button>
        </div>
        <ChipsInput label="Palabras clave (opcional)" values={form.keywords} max={LIMITS.maxKeywords} maxLength={LIMITS.keyword} onChange={(keywords) => update({ keywords })} />
      </div>
    </Card>
  );
}

function ChipsInput({ label, values, max, maxLength, onChange }: { label: string; values: string[]; max: number; maxLength: number; onChange: (values: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const value = text.trim().replace(/,$/, '').trim();
    if (value && !values.includes(value) && values.length < max) onChange([...values, value]);
    setText('');
  };
  return (
    <Field label={label} hint="Pulsa Intro o coma para añadir.">
      {(id, describedBy) => (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface p-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          {values.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 rounded-none bg-subtle px-1.5 py-0.5 text-xs">
              {value}
              <button type="button" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((v) => v !== value))} className="text-muted hover:text-ink">
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          <input
            id={id}
            aria-describedby={describedBy}
            value={text}
            maxLength={maxLength}
            onChange={(e) => setText(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add();
              } else if (e.key === 'Backspace' && !text && values.length > 0) {
                onChange(values.slice(0, -1));
              }
            }}
            className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
          />
        </div>
      )}
    </Field>
  );
}

function ImagesCard({ form, setForm, uploadImage, error }: { form: QuestionForm; setForm: React.Dispatch<React.SetStateAction<QuestionForm>>; uploadImage: (file: File) => Promise<QuestionImage | null>; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const setAlt = (hash: string, alt: string) => setForm((current) => ({ ...current, images: current.images.map((i) => (i.hash === hash ? { ...i, alt } : i)) }));
  return (
    <Card>
      <CardHeader
        title="Imágenes"
        description={`Se reducen y se limpian de metadatos al subirlas. Máximo ${LIMITS.images}.`}
        action={
          <Button size="sm" icon={<ImagePlus size={14} aria-hidden />} disabled={form.images.length >= LIMITS.images} onClick={() => input.current?.click()}>
            Adjuntar
          </Button>
        }
      />
      <div className="p-4">
        {form.images.length === 0 ? <p className="text-[0.8125rem] text-muted">Sin imágenes. También puedes pegarlas en el texto.</p> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {form.images.map((image) => (
            <li key={image.hash} className="flex gap-2.5 rounded-md border border-border p-2">
              <AttachedImage image={image} className="h-16 w-20 shrink-0 object-contain" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input value={image.alt} maxLength={300} placeholder="Descripción para quien no la vea" aria-label="Descripción de la imagen" onChange={(e) => setAlt(image.hash, e.target.value)} className="h-8 text-[0.8125rem]" />
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="tabular-nums">{Math.round(image.bytes / 1024)} KB</span>
                  <button type="button" onClick={() => setForm((current) => removeImageReferences(current, image.hash))} className="hover:text-danger">
                    Quitar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-2 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            const room = LIMITS.images - form.images.length;
            if (files.length > room) toast.error(`Sólo caben ${room} imágenes más: el máximo por pregunta es ${LIMITS.images}.`);
            void (async () => {
              for (const file of files.slice(0, room)) await uploadImage(file);
            })();
          }}
        />
      </div>
    </Card>
  );
}

function ReferencesCard({ references, onChange, error }: { references: Reference[]; onChange: (references: Reference[]) => void; error?: string }) {
  const set = (index: number, patch: Partial<Reference>) => onChange(references.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <Card>
      <CardHeader title="Referencias (opcional)" description="Libro, artículo o web de donde sale el contenido." />
      <div className="flex flex-col gap-2 p-4">
        {references.map((reference, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <Input value={reference.title} maxLength={300} placeholder="Título" aria-label={`Título de la referencia ${index + 1}`} onChange={(e) => set(index, { title: e.target.value })} />
            <Input type="url" value={reference.url ?? ''} placeholder="https:// (opcional)" aria-label={`Enlace de la referencia ${index + 1}`} onChange={(e) => set(index, { url: e.target.value })} />
            <button type="button" aria-label={`Eliminar referencia ${index + 1}`} onClick={() => onChange(references.filter((_, i) => i !== index))} className="inline-flex size-8 shrink-0 items-center justify-center rounded-none text-muted hover:bg-hover hover:text-danger">
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ))}
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button size="sm" className="w-fit" disabled={references.length >= LIMITS.maxReferences} icon={<Plus size={14} aria-hidden />} onClick={() => onChange([...references, { title: '' }])}>
          Añadir referencia
        </Button>
      </div>
    </Card>
  );
}
