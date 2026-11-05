import { Download, FileEdit, Library, Play, Plus, Search, Upload } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES } from '@core/schema/common';
import { filterQuestions } from '@core/questions/filter';
import { QUESTION_TYPE_LABELS } from '@core/schema/question';
import { useDrafts } from '@/features/editor/drafts';
import { startSession } from '@/features/study/sessions';
import { useTaxonomy, type TaxonomyView } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { Button, ButtonLink } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Input, Select } from '@/ui/Field';
import { Card, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { SORT_LABELS, useBankFilters, type OriginFilter, type SortKey } from './filters';
import { buildExport, downloadBlob, importFile, ImportError } from './importExport';
import { AuthorChip, DifficultyBadge, OriginBadge, subjectName, topicLabels, TypeBadge } from './parts';
import { excerpt, useQuestions, type ViewQuestion } from './questionsRepo';
import { QuestionView } from './QuestionView';

const PAGE_SIZE = 40;

function QuestionRow({ question, taxonomy, onPreview }: { question: ViewQuestion; taxonomy: TaxonomyView; onPreview: () => void }) {
  const topics = topicLabels(question.topicIds, taxonomy.index);
  return (
    <li className="group flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-subtle/60">
      <Link to={`/q/${question.id}`} className="text-sm leading-snug font-medium hover:text-accent-text">
        {excerpt(question.statement)}
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TypeBadge type={question.type} />
        <DifficultyBadge value={question.difficulty} />
        <span className="min-w-0 truncate text-xs text-muted">
          {subjectName(question.subjectId, taxonomy.index)}
          {topics.length > 0 ? ` · ${topics.join(', ')}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-2.5">
          {question.origin !== 'community' ? <OriginBadge origin={question.origin} /> : null}
          <AuthorChip author={question.author} />
          <button type="button" onClick={onPreview} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Vista previa
          </button>
        </span>
      </div>
    </li>
  );
}

function FiltersBar({ taxonomy }: { taxonomy: TaxonomyView }) {
  const { filter, origin, sort, set, clear, active, params } = useBankFilters();
  const subject = taxonomy.subjects.find((s) => s.id === filter.subjectId);
  const unit = subject?.units.find((u) => u.id === filter.unitIds?.[0]);
  const chosen = new Set(filter.difficulties);
  const [text, setText] = useState(params.get('q') ?? '');

  const toggleDifficulty = (level: number) => {
    const next = new Set<number>(chosen);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    set({ difficulty: [...next].sort().join(',') || null });
  };

  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <form
        role="search"
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() || null });
        }}
      >
        <Search size={15} className="pointer-events-none absolute top-2.5 left-2.5 text-faint" aria-hidden />
        <Input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            set({ q: e.target.value.trim() || null });
          }}
          placeholder="Buscar en enunciados, opciones y etiquetas…"
          aria-label="Buscar preguntas"
          className="pl-8"
        />
      </form>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select aria-label="Asignatura" value={filter.subjectId ?? ''} onChange={(e) => set({ subject: e.target.value, unit: null, topic: null })}>
          <option value="">Todas las asignaturas</option>
          {taxonomy.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Unidad" disabled={!subject} value={filter.unitIds?.[0] ?? ''} onChange={(e) => set({ unit: e.target.value, topic: null })}>
          <option value="">Todas las unidades</option>
          {subject?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Tema" disabled={!unit} value={filter.topicIds?.[0] ?? ''} onChange={(e) => set({ topic: e.target.value })}>
          <option value="">Todos los temas</option>
          {unit?.topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Tipo" value={filter.types?.[0] ?? ''} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Todos los tipos</option>
          <option value="mcq">{QUESTION_TYPE_LABELS.mcq}</option>
          <option value="open">{QUESTION_TYPE_LABELS.open}</option>
        </Select>
        <Select aria-label="Procedencia" value={origin} onChange={(e) => set({ origin: e.target.value === 'all' ? null : (e.target.value as OriginFilter) })}>
          <option value="all">Todas</option>
          <option value="community">De la comunidad</option>
          <option value="mine">Sin publicar</option>
        </Select>
        <Select aria-label="Ordenar" value={sort} onChange={(e) => set({ sort: e.target.value === 'recent' ? null : (e.target.value as SortKey) })}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Dificultad">
        {DIFFICULTY_VALUES.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={chosen.has(level)}
            onClick={() => toggleDifficulty(level)}
            className={cn(
              'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors',
              chosen.has(level) ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-muted hover:border-border-strong hover:text-ink',
            )}
          >
            {DIFFICULTY_LABELS[level]}
          </button>
        ))}
        {active ? (
          <button
            type="button"
            onClick={() => {
              setText('');
              clear();
            }}
            className="ml-1 text-xs text-muted underline underline-offset-2 hover:text-ink"
          >
            Quitar filtros
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DraftsNotice() {
  const drafts = useDrafts();
  if (!drafts || drafts.length === 0) return null;
  return (
    <Notice tone="neutral" className="mb-4" title={`${drafts.length} ${drafts.length === 1 ? 'borrador' : 'borradores'} sin terminar`}>
      <ul className="mt-1 flex flex-col gap-0.5">
        {drafts.slice(0, 5).map((draft) => {
          const statement = (draft.form as { statement?: string }).statement ?? '';
          return (
            <li key={draft.id}>
              <Link to={`/create?draft=${draft.id}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <FileEdit size={12} aria-hidden />
                <span className="underline underline-offset-2">{excerpt(statement, 80) || 'Sin enunciado'}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

export default function BankPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const { filter, origin, sort, active } = useBankFilters();
  const deferredFilter = useDeferredValue(filter);
  const stats = useLiveQuery(async () => (sort === 'popular' ? new Map((await db.dQuestionStats.toArray()).map((s) => [s.questionId, s.answers])) : null), [sort]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<ViewQuestion | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const results = useMemo(() => {
    if (!questions || !taxonomy) return [];
    const filtered = filterQuestions(questions, deferredFilter, taxonomy.index).filter((q) => origin === 'all' || (origin === 'community' ? q.origin === 'community' : q.origin !== 'community'));
    const sorted = [...filtered];
    switch (sort) {
      case 'oldest':
        sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        break;
      case 'easy':
        sorted.sort((a, b) => a.difficulty - b.difficulty);
        break;
      case 'hard':
        sorted.sort((a, b) => b.difficulty - a.difficulty);
        break;
      case 'popular':
        sorted.sort((a, b) => (stats?.get(b.id) ?? 0) - (stats?.get(a.id) ?? 0));
        break;
      default:
        sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return sorted;
  }, [questions, taxonomy, deferredFilter, origin, sort, stats]);

  const onImport = async (file: File) => {
    try {
      const report = await importFile(file);
      const skipped = report.existing + report.duplicates + report.invalid;
      toast.success(`${report.imported} ${report.imported === 1 ? 'pregunta importada' : 'preguntas importadas'}${skipped > 0 ? `; ${skipped} omitidas (${report.existing} ya existían, ${report.duplicates} duplicadas, ${report.invalid} no válidas)` : ''}.`);
    } catch (error) {
      toast.error(error instanceof ImportError ? error.message : 'No se ha podido importar el fichero.');
    }
  };

  const onExport = async () => {
    const blob = await buildExport(results);
    downloadBlob(blob, `questionbank-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success(`${results.length} ${results.length === 1 ? 'pregunta exportada' : 'preguntas exportadas'}.`);
  };

  if (!questions || !taxonomy) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Banco de preguntas"
        actions={
          <>
            <Button icon={<Upload size={16} aria-hidden />} onClick={() => importInput.current?.click()}>
              Importar
            </Button>
            <Button icon={<Download size={16} aria-hidden />} disabled={results.length === 0} onClick={() => void onExport()} title="Exporta lo que se ve con los filtros actuales">
              Exportar
            </Button>
            <ButtonLink to="/create" variant="primary" icon={<Plus size={16} aria-hidden />}>
              Crear
            </ButtonLink>
          </>
        }
      />
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onImport(file);
        }}
      />
      <DraftsNotice />
      <FiltersBar taxonomy={taxonomy} />

      {questions.length === 0 ? (
        <EmptyState
          icon={<Library size={28} aria-hidden />}
          title="El banco está vacío"
          action={
            <>
              <ButtonLink to="/create" variant="primary">
                Crear la primera pregunta
              </ButtonLink>
              <ButtonLink to="/sync">Sincronizar con la comunidad</ButtonLink>
            </>
          }
        >
          Crea tus propias preguntas o descarga las que ha publicado la comunidad.
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState title="Ninguna pregunta coincide">{active ? 'Prueba a quitar algún filtro.' : null}</EmptyState>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted" role="status">
              {results.length} {results.length === 1 ? 'pregunta' : 'preguntas'}
            </p>
            <Button
              size="sm"
              icon={<Play size={14} aria-hidden />}
              onClick={() => {
                // Las que se ven, en este orden: «preguntas seleccionadas» del modo práctica.
                const questionIds = results.slice(0, 200).map((q) => q.id);
                void startSession({ mode: 'custom', title: 'Selección del banco', config: { count: questionIds.length, order: 'selected' }, questionIds }).then((id) => navigate(`/study/session/${id}`));
              }}
            >
              Practicar {results.length > 200 ? 'las 200 primeras' : results.length === 1 ? 'esta' : 'estas'}
            </Button>
          </div>
          <Card>
            <ul className="divide-y divide-border">
              {results.slice(0, visible).map((question) => (
                <QuestionRow key={question.id} question={question} taxonomy={taxonomy} onPreview={() => setPreview(question)} />
              ))}
            </ul>
          </Card>
          {visible < results.length ? (
            <div className="mt-3 flex justify-center">
              <Button onClick={() => setVisible((v) => v + PAGE_SIZE)}>Ver {Math.min(PAGE_SIZE, results.length - visible)} más</Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Vista previa"
        size="lg"
        footer={preview ? <ButtonLink to={`/q/${preview.id}`} variant="primary">Abrir ficha</ButtonLink> : undefined}
      >
        {preview ? <QuestionView question={preview} showSolution /> : null}
      </Dialog>
    </>
  );
}
