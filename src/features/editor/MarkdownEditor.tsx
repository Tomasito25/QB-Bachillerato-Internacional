import { Bold, Code, Eye, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered, PencilLine, Quote, Sigma, SquareCode, SquareFunction } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { QuestionImage } from '@core/schema/question';
import { Markdown } from '@/infra/markdown/Markdown';
import { cn } from '@/ui/cn';
import { applyFormat, insertAt, type FormatAction, type TextState } from './format';

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
  onUploadImage?: (file: File) => Promise<QuestionImage | null>;
  compact?: boolean;
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
  { action: 'math', label: 'Fórmula en línea', icon: Sigma },
  { action: 'mathblock', label: 'Fórmula en bloque', icon: SquareFunction },
];

function ToolButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean }) {
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
 * Editor de texto con formato. El contenido se guarda como Markdown (es lo que se revisa en
 * un PR), pero aquí se escribe con botones, atajos y vista previa, sin saber Markdown.
 */
export function MarkdownEditor({ label, hint, value, onChange, error, rows = 5, placeholder, images, onUploadImage, compact }: MarkdownEditorProps) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);
  const [uploading, setUploading] = useState(false);

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

  const format = (action: FormatAction) => {
    if (preview) setPreview(false);
    commit(applyFormat(selection(), action));
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
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      <div className={cn('overflow-hidden rounded-md border bg-surface focus-within:ring-2 focus-within:ring-accent/25', error ? 'border-danger' : 'border-border focus-within:border-accent')}>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-subtle/60 px-1 py-1" role="toolbar" aria-label={`Formato de ${label.toLowerCase()}`}>
          {(compact ? ACTIONS.filter((a) => ['bold', 'italic', 'code', 'math'].includes(a.action)) : ACTIONS).map(({ action, label: actionLabel, icon: Icon }) => (
            <ToolButton key={action} label={actionLabel} onClick={() => format(action)}>
              <Icon size={15} aria-hidden />
            </ToolButton>
          ))}
          {onUploadImage ? (
            <ToolButton label={uploading ? 'Subiendo imagen…' : 'Insertar imagen'} onClick={() => fileInput.current?.click()}>
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
            ref={textarea}
            rows={rows}
            value={value}
            placeholder={placeholder}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error || hint ? `${id}-hint` : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
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
    </div>
  );
}
