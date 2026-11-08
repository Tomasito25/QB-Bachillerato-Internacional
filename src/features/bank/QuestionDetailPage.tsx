import { ArrowLeft, Archive, Copy, Download, ExternalLink, Eye, EyeOff, Flag, History, Pencil, Play, ShieldAlert, Star, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { identity, newNonce } from '@/features/account/identity';
import { useProgress, toggleFavorite, toggleHard } from '@/features/study/progressRepo';
import { SessionError, startSession } from '@/features/study/sessions';
import { enqueue } from '@/features/sync/outbox';
import { PublishDialog } from '@/features/sync/PublishDialog';
import { topicPath, useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { config, hasCommunity } from '@/infra/config';
import { Button, ButtonLink, buttonClass } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field, Select, Textarea } from '@/ui/Field';
import { Badge, Card, EmptyState, Notice, PageHeader, Spinner, Stat } from '@/ui/Surface';
import { toast } from '@/ui/toast';
import { buildExport, downloadBlob } from './importExport';
import { AuthorChip, DifficultyBadge, OriginBadge, TypeBadge } from './parts';
import { discardLocalQuestion, excerpt, useQuestion, type ViewQuestion } from './questionsRepo';
import { QuestionView, ReferencesList } from './QuestionView';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

function DiscardDialog({ question, open, onClose }: { question: ViewQuestion; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const edited = question.origin === 'edited';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={edited ? 'Descartar tu edición' : 'Borrar esta pregunta'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              void discardLocalQuestion(question.id).then(() => {
                toast.info(edited ? 'Edición descartada.' : 'Pregunta borrada.');
                onClose();
                if (!edited) navigate('/bank');
              });
            }}
          >
            {edited ? 'Descartar' : 'Borrar'}
          </Button>
        </>
      }
    >
      {edited ? 'Volverás a ver la versión comunitaria.' : 'Sólo existe en este dispositivo: no se podrá recuperar.'}
    </Dialog>
  );
}

type ReportReason = 'wrong-answer' | 'copyright' | 'duplicate' | 'offensive' | 'other';

const REPORT_REASONS: Record<ReportReason, string> = {
  'wrong-answer': 'La solución está mal',
  copyright: 'Infringe derechos de autor',
  duplicate: 'Está repetida',
  offensive: 'Contenido inapropiado',
  other: 'Otro motivo',
};

function ReportDialog({ question, open, onClose }: { question: ViewQuestion; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('wrong-answer');
  const [detail, setDetail] = useState('');
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reportar esta pregunta"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              void enqueue({ v: 1, kind: 'report', nonce: newNonce(), questionId: question.id, reason, detail: detail.trim() }, `Reporte de una pregunta: ${REPORT_REASONS[reason]}. ${detail.trim().slice(0, 300)}`, {}).then(() => {
                toast.success('Preparado. Envíalo desde Sincronización.');
                navigate('/sync');
              });
            }}
          >
            Preparar reporte
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Motivo">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key) => (
                <option key={key} value={key}>
                  {REPORT_REASONS[key]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Detalles">{(id) => <Textarea id={id} rows={3} maxLength={2000} value={detail} onChange={(e) => setDetail(e.target.value)} />}</Field>
        <p className="text-xs text-muted">Se publica como un issue que revisará una persona.</p>
      </div>
    </Dialog>
  );
}

export default function QuestionDetailPage() {
  const { id } = useParams();
  const question = useQuestion(id);
  const taxonomy = useTaxonomy();
  const progress = useProgress(id);
  const [showSolution, setShowSolution] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const user = identity.use();
  const navigate = useNavigate();

  useEffect(() => setShowSolution(false), [id]);

  if (question === undefined || !taxonomy) return <Spinner />;
  if (question === null) {
    return (
      <EmptyState title="No se encuentra esta pregunta" action={<ButtonLink to="/bank" variant="primary">Ir al banco</ButtonLink>}>
        Puede que se haya retirado o que aún no la tengas descargada.
      </EmptyState>
    );
  }

  const paths = question.topicIds.map((topicId) => topicPath(taxonomy.index, topicId)).filter((p) => p !== null);
  const onExport = async () => downloadBlob(await buildExport([question]), `pregunta-${question.id.slice(0, 8)}.json`);
  const practise = async () => {
    try {
      navigate(`/study/session/${await startSession({ mode: 'practice', title: 'Una pregunta', config: { count: 1 }, questionIds: [question.id] })}`);
    } catch (error) {
      toast.error(error instanceof SessionError ? error.message : 'No se ha podido crear la sesión.');
    }
  };
  const canPublish = question.origin !== 'community' && (question.local?.syncState === 'local' || question.local?.syncState === 'rejected');
  const isOwnCommunity = question.origin === 'community' && question.author?.login === user?.login;

  return (
    <>
      <Link to="/bank" className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        Banco de preguntas
      </Link>
      <PageHeader title="Pregunta" documentTitle={excerpt(question.statement, 50)} />

      {question.local?.syncState === 'conflict' ? (
        <Notice tone="warning" className="mb-4" title="La versión comunitaria cambió mientras editabas" action={<ButtonLink to="/sync" size="sm">Resolver</ButtonLink>} />
      ) : null}
      {question.local?.syncState === 'rejected' ? (
        <Notice tone="danger" className="mb-4" title="La publicación se rechazó">
          {question.local.note}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="p-4 sm:p-5">
          <QuestionView question={question} showSolution={showSolution} />
          <div className="mt-4 border-t border-border pt-3">
            <Button variant="ghost" size="sm" icon={showSolution ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} onClick={() => setShowSolution((v) => !v)}>
              {showSolution ? 'Ocultar solución' : 'Ver solución'}
            </Button>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2.5 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={question.type} />
              <OriginBadge origin={question.origin} />
            </div>
            <DifficultyBadge value={question.difficulty} />
            <ul className="flex flex-col gap-1 text-[0.8125rem]">
              {paths.map((path, i) => (
                <li key={i}>
                  <span className="text-muted">
                    {path.subject} › {path.unit} ›
                  </span>{' '}
                  {path.topic}
                </li>
              ))}
            </ul>
            {question.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {question.tags.map((tag) => (
                  <Link key={tag} to={`/bank?tag=${encodeURIComponent(tag)}`}>
                    <Badge>{tag}</Badge>
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
              <AuthorChip author={question.author} />
              <span className="text-xs text-muted" title={`Modificada: ${formatDate(question.updatedAt)}`}>
                {formatDate(question.createdAt)}
              </span>
            </div>
          </Card>

          <Card className="flex flex-col gap-1.5 p-2">
            <Button variant="primary" className="justify-start" icon={<Play size={15} aria-hidden />} onClick={() => void practise()}>
              Practicar esta pregunta
            </Button>
            {canPublish ? (
              <Button className="justify-start" icon={<UploadCloud size={15} aria-hidden />} onClick={() => setPublishing(true)}>
                Publicar
              </Button>
            ) : null}
            <ButtonLink to={`/q/${question.id}/edit`} variant="ghost" className="justify-start" icon={<Pencil size={15} aria-hidden />}>
              {question.origin === 'community' ? 'Proponer una edición' : 'Editar'}
            </ButtonLink>
            <ButtonLink to={`/create?from=${question.id}`} variant="ghost" className="justify-start" icon={<Copy size={15} aria-hidden />}>
              Duplicar
            </ButtonLink>
            <Button variant="ghost" className="justify-start" icon={<Star size={15} className={progress?.favorite ? 'fill-current text-warning' : ''} aria-hidden />} aria-pressed={progress?.favorite === 1} onClick={() => void toggleFavorite(question.id)}>
              {progress?.favorite ? 'Quitar de favoritas' : 'Marcar favorita'}
            </Button>
            <Button variant="ghost" className="justify-start" icon={<Flag size={15} className={progress?.hard ? 'fill-current text-danger' : ''} aria-hidden />} aria-pressed={progress?.hard === 1} onClick={() => void toggleHard(question.id)}>
              {progress?.hard ? 'Quitar marca de difícil' : 'Marcar como difícil para mí'}
            </Button>
            <Button variant="ghost" className="justify-start" icon={<Download size={15} aria-hidden />} onClick={() => void onExport()}>
              Exportar
            </Button>
            {question.origin === 'community' && hasCommunity() ? (
              <>
                {/* Cada pregunta es un fichero de la rama `data`: GitHub guarda quién cambió qué y cuándo. */}
                <a href={config.repoUrl(`/blob/data/questions/${question.subjectId}/${question.id}.json`)} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'md', 'justify-start')}>
                  <ExternalLink size={15} aria-hidden />
                  Ver en GitHub
                </a>
                <a href={config.repoUrl(`/commits/data/questions/${question.subjectId}/${question.id}.json`)} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'md', 'justify-start')}>
                  <History size={15} aria-hidden />
                  Historial de cambios
                </a>
              </>
            ) : null}
            {question.origin !== 'community' ? (
              <Button variant="ghost" className="justify-start text-danger hover:text-danger" icon={<Trash2 size={15} aria-hidden />} onClick={() => setDiscarding(true)}>
                {question.origin === 'edited' ? 'Descartar mi edición' : 'Borrar'}
              </Button>
            ) : null}
            {question.origin === 'community' ? (
              <Button variant="ghost" className="justify-start" icon={<ShieldAlert size={15} aria-hidden />} onClick={() => setReporting(true)}>
                Reportar
              </Button>
            ) : null}
            {isOwnCommunity ? (
              <Button
                variant="ghost"
                className="justify-start"
                icon={<Archive size={15} aria-hidden />}
                onClick={() => {
                  void enqueue({ v: 1, kind: 'retire', nonce: newNonce(), questionId: question.id }, `Retiro mi pregunta «${excerpt(question.statement, 60)}».`, {}).then(() => {
                    toast.success('Preparado. Envíalo desde Sincronización.');
                    navigate('/sync');
                  });
                }}
              >
                Retirar del banco
              </Button>
            ) : null}
          </Card>

          {progress && progress.attempts > 0 ? (
            <Card className="grid grid-cols-2 gap-3 p-4">
              <Stat label="Intentos" value={progress.attempts} />
              <Stat label="Aciertos" value={progress.correct} />
            </Card>
          ) : null}

          {question.references.length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-[0.9375rem] font-bold">Referencias</h2>
              <ReferencesList question={question} />
            </Card>
          ) : null}
        </div>
      </div>
      <DiscardDialog question={question} open={discarding} onClose={() => setDiscarding(false)} />
      <PublishDialog questionIds={[question.id]} open={publishing} onClose={() => setPublishing(false)} />
      <ReportDialog question={question} open={reporting} onClose={() => setReporting(false)} />
    </>
  );
}
