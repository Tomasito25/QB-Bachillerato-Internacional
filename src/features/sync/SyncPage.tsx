import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Clipboard, ExternalLink, GitPullRequest, RefreshCw, Send, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { identity, tokenReady } from '@/features/account/identity';
import { excerpt } from '@/features/bank/questionsRepo';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { cn } from '@/ui/cn';
import { config, hasCommunity } from '@/infra/config';
import { db } from '@/infra/db/db';
import { online } from '@/infra/connectivity';
import type { LocalQuestionRow, OutboxRow } from '@/infra/db/types';
import { RateLimitError, rateLimit } from '@/infra/github/client';
import { Markdown } from '@/infra/markdown/Markdown';
import { Button, ButtonLink, buttonClass } from '@/ui/Button';
import { Checkbox } from '@/ui/Field';
import { OutLink } from '@/ui/OutLink';
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Spinner, type BadgeTone } from '@/ui/Surface';
import { timeAgo } from '@/ui/time';
import { toast } from '@/ui/toast';
import { syncCommunity, syncState, useManifestSummary } from './communitySync';
import { awaitsGitHub, clearAccepted, discardItem, flushWithToken, isOpen, manualQueue, manualTransport, markAwaitingUser, OUTBOX_STATUS_LABELS, refreshStatuses, useOutbox } from './outbox';
import { PublishDialog } from './PublishDialog';
import { publishResults, PublishError, unpublishedAnswerCount } from './publish';
import { resolveConflict, type ConflictChoice } from './reconcile';

function StatusCard() {
  const state = syncState.use();
  const isOnline = online.use();
  const counts = useManifestSummary();
  return (
    <Card>
      <CardHeader
        title="Banco comunitario"
        description={state.lastSyncAt ? `Última sincronización: ${timeAgo(state.lastSyncAt)}` : 'Todavía no se ha sincronizado'}
        action={
          <Button size="sm" busy={state.status === 'syncing'} disabled={!isOnline} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void syncCommunity()}>
            Sincronizar
          </Button>
        }
      />
      <div className="flex flex-col gap-2 p-4 text-sm">
        {state.status === 'syncing' && state.total > 0 ? (
          <p className="text-muted" role="status">
            Descargando {state.done} de {state.total}…
          </p>
        ) : null}
        {state.status === 'error' ? (
          <Notice tone="danger" title="No se ha podido sincronizar">
            {state.message} Lo que ya tienes sigue disponible.
          </Notice>
        ) : null}
        {state.noCommunity ? <p className="text-muted">Este despliegue aún no ha publicado datos comunitarios.</p> : null}
        {counts ? (
          <p className="text-muted tabular-nums">
            {counts.questions.toLocaleString('es')} preguntas · {counts.subjects} asignaturas · {counts.users} personas · {counts.answers.toLocaleString('es')} respuestas publicadas
          </p>
        ) : null}
        {counts?.commit && /^[0-9a-f]{7,40}$/.test(counts.commit) ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <OutLink href={config.repoUrl(`/commit/${counts.commit}`)}>Datos del commit {counts.commit.slice(0, 7)}</OutLink>
            <OutLink href={config.repoUrl('/actions')}>Qué está haciendo GitHub Actions</OutLink>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const STATUS_TONE: Record<OutboxRow['status'], BadgeTone> = {
  queued: 'neutral',
  'awaiting-user': 'warning',
  sent: 'accent',
  accepted: 'success',
  review: 'accent',
  rejected: 'danger',
  failed: 'danger',
};

function StatusIcon({ status }: { status: OutboxRow['status'] }) {
  if (status === 'accepted') return <CheckCircle2 size={12} aria-hidden />;
  if (status === 'rejected' || status === 'failed') return <XCircle size={12} aria-hidden />;
  return <CircleDashed size={12} aria-hidden />;
}

/**
 * El envío manual. La URL se calcula antes del clic: abrir una pestaña después de un `await`
 * pierde el gesto del usuario y el navegador la bloquearía como ventana emergente.
 */
function SendAction({ row }: { row: OutboxRow }) {
  const transport = manualTransport(row);
  const [copied, setCopied] = useState(false);
  if (transport.mode === 'too-large') {
    return <p className="text-xs text-danger">Este envío es demasiado grande para un issue. Descártalo y publica menos de golpe, o conecta un token.</p>;
  }
  if (transport.mode === 'url') {
    return (
      <a href={transport.url} target="_blank" rel="noopener noreferrer" onClick={() => void markAwaitingUser(row.id)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[0.8125rem] font-medium text-accent-ink hover:bg-accent-hover">
        <Send size={14} aria-hidden />
        {row.status === 'awaiting-user' ? 'Abrir de nuevo en GitHub' : 'Enviar en GitHub'}
      </a>
    );
  }
  // En dos pasos: abrir la pestaña mientras se copia hace fallar la copia en algunos navegadores,
  // y si no se pega nada el issue llega vacío.
  if (!copied) {
    return (
      <button type="button" onClick={() => void navigator.clipboard.writeText(transport.body).then(() => setCopied(true), () => toast.error('El navegador no ha permitido copiar al portapapeles.'))} className={buttonClass('primary', 'sm')}>
        <Clipboard size={14} aria-hidden />
        1. Copiar el envío
      </button>
    );
  }
  return (
    <a href={transport.url} target="_blank" rel="noopener noreferrer" onClick={() => void markAwaitingUser(row.id)} className={buttonClass('primary', 'sm')}>
      <Send size={14} aria-hidden />
      2. Abrir GitHub y pegarlo
    </a>
  );
}

function OutboxItem({ row, canSend }: { row: OutboxRow; canSend: boolean }) {
  const manual = row.channel === 'issue' && (row.status === 'queued' || row.status === 'awaiting-user') && canSend;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[0.84375rem]">{row.summary}</p>
        <Badge tone={STATUS_TONE[row.status]}>
          <StatusIcon status={row.status} />
          {OUTBOX_STATUS_LABELS[row.status]}
        </Badge>
      </div>
      {manual && manualTransport(row).mode === 'clipboard' ? (
        <p className="text-xs text-muted">No cabe en la dirección de GitHub: cópialo, abre GitHub y pégalo en la descripción antes de pulsar «Create». Esta página lo detectará sola.</p>
      ) : row.status === 'awaiting-user' ? (
        <p className="text-xs text-muted">Pulsa «Create» en GitHub para enviarlo. Esta página lo detectará sola.</p>
      ) : null}
      {row.error ? (
        <div className="rounded-md bg-danger-soft p-2.5 text-[0.8125rem]">
          <Markdown source={row.error} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {manual ? <SendAction row={row} /> : null}
        {row.url ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            {row.channel === 'pull' ? <GitPullRequest size={12} aria-hidden /> : <ExternalLink size={12} aria-hidden />}
            Ver en GitHub
          </a>
        ) : null}
        {!isOpen(row) || row.status === 'queued' || row.status === 'awaiting-user' ? (
          <button type="button" onClick={() => void discardItem(row)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-danger">
            <Trash2 size={12} aria-hidden />
            {isOpen(row) ? 'Descartar' : 'Quitar de la lista'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

const POLL_MS = 30_000;
const MAX_POLLS = 12;

/** Comprueba el estado sólo mientras se mira esta pantalla, y con tope: sin token hay 60 peticiones por hora. */
function useStatusPolling(rows: readonly OutboxRow[] | undefined) {
  const [checking, setChecking] = useState(false);
  const polls = useRef(0);
  const checkedOnOpen = useRef(false);
  const active = rows?.some((r) => r.status === 'awaiting-user' || r.status === 'sent') ?? false;

  const check = useCallback(async (manual: boolean) => {
    setChecking(true);
    try {
      await refreshStatuses();
    } catch (error) {
      if (manual) toast.error(error instanceof RateLimitError ? error.message : `No se ha podido comprobar: ${(error as Error).message}`);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    polls.current = 0;
  }, [rows?.length]);

  // Una vez al entrar: lo guardado puede ser de hace días, y sin esto sólo se vería al pulsar «Comprobar».
  useEffect(() => {
    if (!rows || checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    if (navigator.onLine && rows.some(awaitsGitHub)) void check(false);
  }, [rows, check]);

  useEffect(() => {
    if (!active) return;
    const poll = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && polls.current < MAX_POLLS) {
        polls.current += 1;
        void check(false);
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    // Al volver de la pestaña de GitHub es cuando más probable es que haya novedades.
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [active, check]);

  return { checking, check };
}

function OutboxCard() {
  const rows = useOutbox();
  const hasToken = tokenReady.use();
  const limit = rateLimit.use();
  const { checking, check } = useStatusPolling(rows);
  if (!rows || rows.length === 0) return null;
  const pending = rows.some(awaitsGitHub);
  const queued = rows.filter((r) => r.status === 'queued' && r.channel === 'issue').length;
  const manual = hasToken ? [] : manualQueue(rows);
  const next = manual.find((r) => r.status === 'queued');
  // Lo que falta confirmar va arriba y por orden: se envían uno tras otro sin buscarlos.
  const ordered = [...manual, ...rows.filter((r) => !manual.includes(r))];
  const processing = rows.filter((r) => r.status === 'sent').length;
  const accepted = rows.filter((r) => r.status === 'accepted').length;
  const summary = [manual.length > 0 ? `${manual.length} por confirmar en GitHub` : '', processing > 0 ? `${processing} procesándose` : '', accepted > 0 ? `${accepted} ${accepted === 1 ? 'publicado' : 'publicados'}` : ''].filter(Boolean).join(' · ');
  return (
    <Card>
      <CardHeader
        title="Envíos"
        description={[summary, limit && !hasToken ? `Consultas a GitHub disponibles: ${limit.remaining} de ${limit.limit} esta hora` : ''].filter(Boolean).join('. ') || undefined}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {accepted > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => void clearAccepted()}>
                Limpiar publicados
              </Button>
            ) : null}
            {hasToken && queued > 0 ? (
              <Button size="sm" variant="primary" icon={<Send size={14} aria-hidden />} onClick={() => void flushWithToken()}>
                Enviar {queued}
              </Button>
            ) : null}
            {pending ? (
              <Button size="sm" busy={checking} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void check(true)}>
                Comprobar
              </Button>
            ) : null}
          </div>
        }
      />
      <ul className="divide-y divide-border">
        {ordered.map((row) => (
          <OutboxItem key={row.id} row={row} canSend={hasToken ? false : row === next || row.status === 'awaiting-user'} />
        ))}
      </ul>
    </Card>
  );
}

function UnpublishedCard() {
  const user = identity.use();
  const rows = useLiveQuery(() => db.lQuestions.toArray(), []);
  const answers = useLiveQuery(() => unpublishedAnswerCount(), []);
  const taxonomy = useTaxonomy();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  if (!rows || answers === undefined) return null;
  const publishable = rows.filter((row) => row.local.syncState === 'local' || row.local.syncState === 'rejected');
  if (publishable.length === 0 && answers === 0) return null;

  const allChecked = publishable.length > 0 && publishable.every((row) => selected.has(row.id));
  const chosen = publishable.filter((row) => selected.has(row.id)).map((row) => row.id);
  const bySubject = new Map<string, typeof publishable>();
  for (const row of publishable) {
    const group = bySubject.get(row.subjectId);
    if (group) group.push(row);
    else bySubject.set(row.subjectId, [row]);
  }
  const groups = [...bySubject];
  // Con pocas se ven de un vistazo; con muchas, se empieza por las asignaturas.
  const openByDefault = publishable.length <= 30;

  return (
    <Card>
      <CardHeader title="Sin publicar" description="Sigue sólo en este dispositivo hasta que decidas compartirlo." />
      <div className="flex flex-col gap-3 p-4">
        {answers > 0 ? (
          <Notice
            tone="neutral"
            title={`${answers} ${answers === 1 ? 'respuesta' : 'respuestas'} para los rankings`}
            action={
              <Button
                size="sm"
                icon={<UploadCloud size={14} aria-hidden />}
                disabled={!user}
                onClick={() => {
                  void publishResults()
                    .then(() => toast.success('Preparado. Revísalo en «Envíos».'))
                    .catch((error: unknown) => toast.error(error instanceof PublishError ? error.message : 'No se ha podido preparar el envío.'));
                }}
              >
                Publicar
              </Button>
            }
          >
            Publicar es opcional. Si lo haces, quedan en un registro público asociado a tu cuenta de GitHub: se corrigen allí, no aquí.
          </Notice>
        ) : null}
        {publishable.length > 0 ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={allChecked} onChange={(checked) => setSelected(new Set(checked ? publishable.map((row) => row.id) : []))} label={`${publishable.length} ${publishable.length === 1 ? 'pregunta' : 'preguntas'}`} />
              <Button size="sm" variant="primary" disabled={chosen.length === 0} icon={<UploadCloud size={14} aria-hidden />} onClick={() => setPublishing(true)}>
                Publicar {chosen.length > 0 ? chosen.length : ''}
              </Button>
            </div>
            <ul className="flex flex-col gap-1.5">
              {groups.map(([subjectId, group]) => {
                const expanded = toggled.has(subjectId) ? !openByDefault : openByDefault;
                const groupChecked = group.every((row) => selected.has(row.id));
                return (
                  <li key={subjectId} className="rounded-md border border-border">
                    <div className="flex items-center gap-2 px-2.5 py-1.5">
                      <Checkbox
                        checked={groupChecked}
                        onChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const row of group) {
                              if (checked) next.add(row.id);
                              else next.delete(row.id);
                            }
                            return next;
                          })
                        }
                        label={<span className="font-medium">{taxonomy?.index.subjects.get(subjectId)?.name ?? 'Sin asignatura'}</span>}
                      />
                      <span className="text-xs text-muted tabular-nums">{group.length}</span>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() =>
                          setToggled((current) => {
                            const next = new Set(current);
                            if (!next.delete(subjectId)) next.add(subjectId);
                            return next;
                          })
                        }
                        className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                      >
                        {expanded ? 'Ocultar' : 'Ver preguntas'}
                        <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} aria-hidden />
                      </button>
                    </div>
                    {expanded ? (
                      <ul className="flex flex-col gap-1.5 border-t border-border p-2.5">
                        {/* shortcut: se pintan las 200 primeras por grupo; con miles habría que paginar. Elegir el grupo entero las incluye todas. */}
                        {group.slice(0, 200).map((row) => (
                          <li key={row.id} className="flex items-start gap-2 text-[0.84375rem]">
                            <Checkbox
                              checked={selected.has(row.id)}
                              onChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(row.id);
                                  else next.delete(row.id);
                                  return next;
                                })
                              }
                              label={<span className="sr-only">Elegir: {excerpt(row.statement, 60)}</span>}
                            />
                            <span className="min-w-0 flex-1">
                              <Link to={`/q/${row.id}`} className="hover:text-accent-text hover:underline">
                                {excerpt(row.statement, 110)}
                              </Link>
                              {row.local.baseRev !== null ? <Badge className="ml-1.5">Edición</Badge> : null}
                              {row.local.syncState === 'rejected' ? <Badge tone="danger" className="ml-1.5">Rechazada</Badge> : null}
                            </span>
                          </li>
                        ))}
                        {group.length > 200 ? <li className="text-xs text-muted">Y {group.length - 200} más. Marca la asignatura para incluirlas todas.</li> : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <PublishDialog questionIds={chosen} open={publishing} onClose={() => setPublishing(false)} onPublished={() => setSelected(new Set())} />
    </Card>
  );
}

function ConflictRow({ row }: { row: LocalQuestionRow }) {
  const community = useLiveQuery(() => db.cQuestions.get(row.id), [row.id]);
  const resolve = (choice: ConflictChoice) => {
    void resolveConflict(row.id, choice).then(() => toast.success('Conflicto resuelto.'));
  };
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border p-2.5">
          <p className="mb-1 text-xs font-medium text-muted">Tu versión</p>
          <p className="text-[0.84375rem]">{excerpt(row.statement, 200)}</p>
        </div>
        <div className="rounded-md border border-border p-2.5">
          <p className="mb-1 text-xs font-medium text-muted">Versión comunitaria{community ? ` (rev. ${community.rev})` : ''}</p>
          <p className="text-[0.84375rem]">{community ? excerpt(community.statement, 200) : '…'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => resolve('use-community')}>
          Quedarme con la comunitaria
        </Button>
        <Button size="sm" onClick={() => resolve('rebase-mine')}>
          Mantener la mía como nueva revisión
        </Button>
        <Button size="sm" onClick={() => resolve('keep-as-new')}>
          Guardar la mía como otra pregunta
        </Button>
      </div>
    </li>
  );
}

function ConflictsCard() {
  const rows = useLiveQuery(() => db.lQuestions.where('local.syncState').equals('conflict').toArray(), []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title={`${rows.length} ${rows.length === 1 ? 'conflicto' : 'conflictos'}`} description="La versión comunitaria cambió mientras editabas. Nada se ha perdido: decide qué queda." action={<AlertTriangle size={16} className="text-warning" aria-hidden />} />
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <ConflictRow key={row.id} row={row} />
        ))}
      </ul>
    </Card>
  );
}

const timeFormat = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

function LogCard() {
  const rows = useLiveQuery(() => db.syncLog.orderBy('seq').reverse().limit(30).toArray(), []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Registro" />
      <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto p-4 font-mono text-xs">
        {rows.map((row) => (
          <li key={row.seq} className={row.level === 'error' ? 'text-danger' : row.level === 'warn' ? 'text-warning' : 'text-muted'}>
            {timeFormat.format(row.at)} · {row.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function SyncPage() {
  const user = identity.use();
  const outbox = useOutbox();
  if (!outbox) return <Spinner />;
  if (!hasCommunity()) {
    return (
      <>
        <PageHeader title="Sincronización" />
        <EmptyState title="Este despliegue no tiene repositorio comunitario">
          La app funciona entera sin conexión, pero para compartir hay que compilarla con <code>VITE_COMMUNITY_REPO=propietario/repositorio</code>. El despliegue con Actions lo hace solo.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Sincronización" description="Lo que entra del banco comunitario y lo que envías." />
      <div className="flex flex-col gap-4">
        {!user ? (
          <Notice tone="accent" title="Para publicar, conecta tu cuenta de GitHub" action={<ButtonLink to="/settings" size="sm" variant="primary">Conectar</ButtonLink>}>
            Descargar y estudiar no la necesita.
          </Notice>
        ) : null}
        <StatusCard />
        <ConflictsCard />
        <UnpublishedCard />
        <OutboxCard />
        <LogCard />
      </div>
    </>
  );
}
