import { Bold, Code, Eye, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered, PencilLine, Quote, Sigma, SquareCode, SquareFunction } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { QuestionImage } from '@core/schema/question';
import { Markdown } from '@/infra/markdown/Markdown';
import { cn } from '@/ui/cn';
import { applyFormat, formulaAt, insertAt, insertFormula, type FormatAction, type FormulaSpan, type TextState } from './format';
import { FormulaDialog } from './FormulaDialog';

type UploadImage = (file: File) => Promise<QuestionImage | null>;

interface MarkdownEditorProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  rows?: number;
  placeholder?: string;
  images: readonly QuestionImage[];
  /** Si se pasa, habilita subir imágenes al texto. Devuelve la imagen ya guardada. */
  onUploadImage?: UploadImage;
}

const ACTIONS: { action: FormatAction; label: string; icon: typeof Bold; shortcut?: string }[] = [
  { action: 'bold', label: 'Negrita', icon: Bold, shortcut: 'b' },
  { action: 'italic', label: 'Cursiva', icon: Italic, shortcut: 'i' },
  { action: 'heading', label: 'Título', icon: Heading3 },
  { action: 'ul', label: 'Lista', icon: List },
  { action: 'ol', label: 'Lista numerada', icon: ListOrdered },
  { action: 'quote', label: 'Cita', icon: Quote },
  { action: 'link', label: 'Enlace', icon: Link2, shortcut: 'k' },
  { action: 'code', label: 'Código en línea', icon: Code },
  { action: 'codeblock', label: 'Bloque de código', icon: SquareCode },
  { action: 'math', label: 'Fórmula en el texto', icon: Sigma },
  { action: 'mathblock', label: 'Fórmula en un bloque aparte', icon: SquareFunction },
];

export function ToolButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      // No quita el foco del texto: la selección debe seguir ahí al aplicar el formato.
      onMouseDown={(e) => e.preventDefault()}
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-hover hover:text-ink', pressed && 'bg-hover text-ink')}
    >
      {children}
    </button>
  );
}

/**
 * Lo que comparten el editor completo y el de cada opción de respuesta: subir o pegar
 * imágenes, el asistente de fórmulas y devolver el cursor a su sitio tras cada cambio.
 * `dialogs` hay que pintarlo en algún lado: lleva el selector de ficheros y el asistente.
 */
export function useMarkdownField(value: string, onChange: (value: string) => void, onUploadImage?: UploadImage) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formula, setFormula] = useState<(FormulaSpan & { editing: boolean }) | null>(null);

  useEffect(() => {
    if (pendingSelection && textarea.current) {
      textarea.current.focus();
      textarea.current.setSelectionRange(pendingSelection.start, pendingSelection.end);
      setPendingSelection(null);
    }
  }, [pendingSelection]);

  const selection = (): TextState => {
    const el = textarea.current;
    return { value, start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };

  const commit = (next: TextState) => {
    onChange(next.value);
    setPendingSelection({ start: next.start, end: next.end });
  };

  const addImages = async (files: readonly File[]) => {
    if (!onUploadImage) return;
    setUploading(true);
    try {
      let state = selection();
      for (const file of files) {
        const image = await onUploadImage(file);
        if (image) state = insertAt(state, `\n![${image.alt || 'figura'}](qbimg:${image.hash})\n`);
      }
      commit(state);
    } finally {
      setUploading(false);
    }
  };

  const imageFiles = (list: FileList | null | undefined) => Array.from(list ?? []).filter((file) => file.type.startsWith('image/'));

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.clipboardData.files);
    if (files.length > 0 && onUploadImage) {
      event.preventDefault();
      void addImages(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.dataTransfer.files);
    if (files.length > 0 && onUploadImage) {
      event.preventDefault();
      void addImages(files);
    }
  };

  /** Con el cursor dentro de una fórmula, la edita; si no, crea otra con lo seleccionado. */
  const openFormula = (display: boolean) => {
    const state = selection();
    const existing = state.start === state.end ? formulaAt(state) : null;
    if (existing) return setFormula({ ...existing, editing: true });
    const selected = state.value.slice(state.start, state.end);
    // Varias líneas no son una fórmula: no se toca lo seleccionado.
    setFormula(selected.includes('\n') ? { start: state.end, end: state.end, latex: '', display, editing: false } : { start: state.start, end: state.end, latex: selected, display, editing: false });
  };

  const dialogs = (
    <>
      {onUploadImage ? (
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void addImages(imageFiles(e.target.files));
            e.target.value = '';
          }}
        />
      ) : null}
      <FormulaDialog
        open={formula !== null}
        initial={formula?.latex ?? ''}
        display={formula?.display ?? false}
        editing={formula?.editing ?? false}
        onClose={() => setFormula(null)}
        onInsert={(latex, display) => {
          if (formula) commit(insertFormula({ value, start: formula.start, end: formula.end }, latex, display));
          setFormula(null);
        }}
      />
    </>
  );

  return { textarea, uploading, selection, commit, onPaste, onDrop, openFormula, pickImages: () => fileInput.current?.click(), dialogs };
}

/**
 * Editor de texto con formato. El contenido se guarda como Markdown (es lo que se revisa en
 * un PR), pero aquí se escribe con botones, atajos y vista previa, sin saber Markdown.
 */
export function MarkdownEditor({ label, hint, value, onChange, error, rows = 5, placeholder, images, onUploadImage }: MarkdownEditorProps) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const field = useMarkdownField(value, onChange, onUploadImage);

  const format = (action: FormatAction) => {
    if (preview) setPreview(false);
    if (action === 'math' || action === 'mathblock') field.openFormula(action === 'mathblock');
    else field.commit(applyFormat(field.selection(), action));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const match = ACTIONS.find((a) => a.shortcut === event.key.toLowerCase());
    if (match) {
      event.preventDefault();
      format(match.action);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium">
        {label}
      </label>
      <div className={cn('overflow-hidden rounded-md border bg-surface focus-within:ring-2 focus-within:ring-accent/25', error ? 'border-danger' : 'border-border focus-within:border-accent')}>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-subtle/60 px-1 py-1" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`}>
          {ACTIONS.map(({ action, label: actionLabel, icon: Icon }) => (
            <ToolButton key={action} label={actionLabel} onClick={() => format(action)}>
              <Icon size={15} aria-hidden />
            </ToolButton>
          ))}
          {onUploadImage ? (
            <ToolButton label={field.uploading ? 'Subiendo imagen…' : 'Insertar imagen'} onClick={field.pickImages}>
              <ImageIcon size={15} aria-hidden />
            </ToolButton>
          ) : null}
          <div className="ml-auto pl-1">
            <ToolButton label={preview ? 'Volver a escribir' : 'Vista previa'} pressed={preview} onClick={() => setPreview((v) => !v)}>
              {preview ? <PencilLine size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            </ToolButton>
          </div>
        </div>
        {preview ? (
          <div className="min-h-24 px-3 py-2.5 text-sm">{value.trim() ? <Markdown source={value} images={images} /> : <p className="text-faint">Nada que previsualizar todavía.</p>}</div>
        ) : (
          <textarea
            id={id}
            ref={field.textarea}
            rows={rows}
            value={value}
            placeholder={placeholder}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error || hint ? `${id}-hint` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={field.onPaste}
            onDrop={field.onDrop}
            className="block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-faint"
          />
        )}
      </div>
      {error ? (
        <p id={`${id}-hint`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {field.dialogs}
    </div>
  );
}
