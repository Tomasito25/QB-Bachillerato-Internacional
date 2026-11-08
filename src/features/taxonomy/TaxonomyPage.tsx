import { ArrowDown, ArrowUp, ChevronRight, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SubjectDoc } from '@core/schema/taxonomy';
import { bankStats, type BankStats } from '@core/questions/stats';
import { useQuestions } from '@/features/bank/questionsRepo';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field, Input, Textarea } from '@/ui/Field';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import {
  addTopic,
  addUnit,
  createSubject,
  deleteSubject,
  deleteTopic,
  deleteUnit,
  moveTopic,
  moveUnit,
  TaxonomyError,
  updateSubject,
  updateTopic,
  updateUnit,
  useTaxonomy,
} from './taxonomyRepo';

interface NameRequest {
  title: string;
  label: string;
  initial?: string;
  description?: string;
  withDescription?: boolean;
  submit: (name: string, description: string) => Promise<unknown>;
}

function NameDialog({ request, onClose }: { request: NameRequest | null; onClose: () => void }) {
  return (
    <Dialog open={request !== null} onClose={onClose} title={request?.title ?? ''} size="sm">
      {request ? <NameForm key={request.title + (request.initial ?? '')} request={request} onClose={onClose} /> : null}
    </Dialog>
  );
}

function NameForm({ request, onClose }: { request: NameRequest; onClose: () => void }) {
  const [name, setName] = useState(request.initial ?? '');
  const [description, setDescription] = useState(request.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        request
          .submit(name, description)
          .then(onClose)
          .catch((e: unknown) => setError(e instanceof TaxonomyError ? e.message : 'No se ha podido guardar.'))
          .finally(() => setBusy(false));
      }}
    >
      <Field label={request.label} error={error}>
        {(id, describedBy) => <Input id={id} aria-describedby={describedBy} value={name} data-autofocus maxLength={120} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {request.withDescription ? (
        <Field label="Descripción (opcional)">
          {(id) => <Textarea id={id} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-7 items-center justify-center rounded-none text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function run(action: Promise<unknown>) {
  action.catch((error: unknown) => toast.error(error instanceof TaxonomyError ? error.message : 'No se ha podido completar la acción.'));
}

function CountLink({ to, count }: { to: string; count: number }) {
  return (
    <Link to={to} className="shrink-0 rounded-none px-1.5 text-xs text-muted tabular-nums hover:bg-hover hover:text-ink" title="Ver estas preguntas">
      {count} {count === 1 ? 'pregunta' : 'preguntas'}
    </Link>
  );
}

function SubjectCard({ subject, stats, communityIds, hasLocal, ask }: { subject: SubjectDoc; stats: BankStats; communityIds: Set<string>; hasLocal: boolean; ask: (r: NameRequest) => void }) {
  const [open, setOpen] = useState(false);
  const isCommunity = communityIds.has(subject.id);
  const units = [...subject.units].sort((a, b) => a.order - b.order);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 rounded-none text-left">
          <ChevronRight size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
          <span className="truncate text-sm font-semibold">{subject.name}</span>
          {!isCommunity ? <Badge tone="warning">Sólo aquí</Badge> : hasLocal ? <Badge tone="warning">Cambios sin publicar</Badge> : null}
        </button>
        <span className="text-xs text-muted">
          {units.length} {units.length === 1 ? 'unidad' : 'unidades'}
        </span>
        <CountLink to={`/bank?subject=${subject.id}`} count={stats.bySubject.get(subject.id) ?? 0} />
        <div className="flex items-center">
          <IconAction
            label={`Renombrar ${subject.name}`}
            onClick={() =>
              ask({
                title: 'Editar asignatura',
                label: 'Nombre',
                initial: subject.name,
                description: subject.description,
                withDescription: true,
                submit: (name, description) => updateSubject(subject.id, { name, description }),
              })
            }
          >
            <Pencil size={14} aria-hidden />
          </IconAction>
          {!isCommunity ? (
            <IconAction label={`Borrar ${subject.name}`} onClick={() => run(deleteSubject(subject.id))}>
              <Trash2 size={14} aria-hidden />
            </IconAction>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="border-t border-border px-3 py-3">
          {subject.description ? <p className="mb-3 text-[0.8125rem] text-muted">{subject.description}</p> : null}
          <ol className="flex flex-col gap-3">
            {units.map((unit, unitIndex) => {
              const topics = [...unit.topics].sort((a, b) => a.order - b.order);
              return (
                <li key={unit.id} className="rounded-md border border-border">
                  <div className="flex flex-wrap items-center gap-1 border-b border-border bg-subtle/50 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                      <span className="text-muted tabular-nums">Unidad {unitIndex + 1} · </span>
                      {unit.name}
                    </span>
                    <CountLink to={`/bank?subject=${subject.id}&unit=${unit.id}`} count={stats.byUnit.get(unit.id) ?? 0} />
                    <IconAction label={`Subir ${unit.name}`} disabled={unitIndex === 0} onClick={() => run(moveUnit(subject.id, unit.id, -1))}>
                      <ArrowUp size={14} aria-hidden />
                    </IconAction>
                    <IconAction label={`Bajar ${unit.name}`} disabled={unitIndex === units.length - 1} onClick={() => run(moveUnit(subject.id, unit.id, 1))}>
                      <ArrowDown size={14} aria-hidden />
                    </IconAction>
                    <IconAction
                      label={`Renombrar ${unit.name}`}
                      onClick={() => ask({ title: 'Renombrar unidad', label: 'Nombre', initial: unit.name, submit: (name) => updateUnit(subject.id, unit.id, name) })}
                    >
                      <Pencil size={14} aria-hidden />
                    </IconAction>
                    {!communityIds.has(unit.id) ? (
                      <IconAction label={`Borrar ${unit.name}`} onClick={() => run(deleteUnit(subject.id, unit.id))}>
                        <Trash2 size={14} aria-hidden />
                      </IconAction>
                    ) : null}
                  </div>
                  <ol className="flex flex-col py-1">
                    {topics.map((topic, topicIndex) => (
                      <li key={topic.id} className="flex flex-wrap items-center gap-1 px-2.5 py-0.5">
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                          <span className="text-muted tabular-nums">
                            {unitIndex + 1}.{topicIndex + 1}{' '}
                          </span>
                          {topic.name}
                        </span>
                        <CountLink to={`/bank?subject=${subject.id}&topic=${topic.id}`} count={stats.byTopic.get(topic.id) ?? 0} />
                        <IconAction label={`Subir ${topic.name}`} disabled={topicIndex === 0} onClick={() => run(moveTopic(subject.id, unit.id, topic.id, -1))}>
                          <ArrowUp size={14} aria-hidden />
                        </IconAction>
                        <IconAction label={`Bajar ${topic.name}`} disabled={topicIndex === topics.length - 1} onClick={() => run(moveTopic(subject.id, unit.id, topic.id, 1))}>
                          <ArrowDown size={14} aria-hidden />
                        </IconAction>
                        <IconAction
                          label={`Renombrar ${topic.name}`}
                          onClick={() => ask({ title: 'Renombrar tema', label: 'Nombre', initial: topic.name, submit: (name) => updateTopic(subject.id, unit.id, topic.id, name) })}
                        >
                          <Pencil size={14} aria-hidden />
                        </IconAction>
                        {!communityIds.has(topic.id) ? (
                          <IconAction label={`Borrar ${topic.name}`} onClick={() => run(deleteTopic(subject.id, unit.id, topic.id))}>
                            <Trash2 size={14} aria-hidden />
                          </IconAction>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <div className="px-2.5 pb-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Plus size={14} aria-hidden />}
                      onClick={() => ask({ title: `Nuevo tema en «${unit.name}»`, label: 'Nombre del tema', submit: (name) => addTopic(subject.id, unit.id, name) })}
                    >
                      Añadir tema
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button
            className={units.length > 0 ? 'mt-3' : ''}
            size="sm"
            icon={<Plus size={14} aria-hidden />}
            onClick={() => ask({ title: `Nueva unidad en «${subject.name}»`, label: 'Nombre de la unidad', submit: (name) => addUnit(subject.id, name) })}
          >
            Añadir unidad
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function TaxonomyPage() {
  const taxonomy = useTaxonomy();
  const questions = useQuestions();
  const [request, setRequest] = useState<NameRequest | null>(null);

  const newSubject = () => setRequest({ title: 'Nueva asignatura', label: 'Nombre', withDescription: true, submit: (name, description) => createSubject(name, description) });

  if (!taxonomy || !questions) return <Spinner />;
  const stats = bankStats(questions, taxonomy.index);

  return (
    <>
      <PageHeader
        title="Temario"
        description="Asignatura → Unidad → Tema → Preguntas. Lo que crees aquí es local hasta que publiques una pregunta que lo use."
        actions={
          <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={newSubject}>
            Nueva asignatura
          </Button>
        }
      />
      {taxonomy.subjects.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={28} aria-hidden />}
          title="Aún no hay asignaturas"
          action={
            <Button variant="primary" onClick={newSubject}>
              Crear la primera
            </Button>
          }
        >
          Sirve para cualquier ámbito: una asignatura de la carrera, una oposición o un idioma.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {taxonomy.subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} stats={stats} communityIds={taxonomy.communityIds} hasLocal={taxonomy.localSubjectIds.has(subject.id)} ask={setRequest} />
          ))}
        </div>
      )}
      <NameDialog request={request} onClose={() => setRequest(null)} />
    </>
  );
}
