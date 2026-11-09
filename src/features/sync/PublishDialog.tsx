import { useState } from 'react';
import { Link } from 'react-router-dom';
import { identity, tokenReady } from '@/features/account/identity';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Checkbox } from '@/ui/Field';
import { Notice } from '@/ui/Surface';
import { toast } from '@/ui/toast';
import { flushWithToken } from './outbox';
import { MAX_QUESTIONS_PER_PULL, publishViaIssue, publishViaPull, PublishError, type ContentOrigin } from './publish';

const ORIGINS: { value: ContentOrigin; label: string }[] = [
  { value: 'own', label: 'La he escrito yo' },
  { value: 'open-licensed', label: 'Viene de una fuente con licencia abierta compatible, y la cito' },
  { value: 'public-domain', label: 'Es de dominio público' },
];

export function PublishDialog({ questionIds, open, onClose, onPublished }: { questionIds: readonly string[]; open: boolean; onClose: () => void; onPublished?: () => void }) {
  const user = identity.use();
  const hasToken = tokenReady.use();
  const [origin, setOrigin] = useState<ContentOrigin | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = questionIds.length;
  const viaPull = hasToken && count <= MAX_QUESTIONS_PER_PULL;

  const submit = async () => {
    if (!origin) return;
    setBusy(true);
    try {
      if (viaPull) {
        await publishViaPull(questionIds, origin);
        toast.success('Pull request abierto. La validación tarda un par de minutos.');
      } else {
        const rows = await publishViaIssue(questionIds, origin);
        if (hasToken) {
          await flushWithToken();
          toast.success(`Enviados ${rows.length} lotes. Se publican en unos minutos.`);
        } else {
          toast.success(rows.length === 1 ? 'Listo para enviar. Falta confirmarlo en GitHub, en Sincronización.' : `Preparados ${rows.length} envíos. Falta confirmarlos en GitHub, en Sincronización.`);
        }
      }
      onPublished?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof PublishError ? error.message : `No se ha podido publicar: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Publicar ${count} ${count === 1 ? 'pregunta' : 'preguntas'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" busy={busy} disabled={!origin || !accepted || !user} onClick={() => void submit()}>
            {hasToken ? 'Publicar' : 'Preparar envío'}
          </Button>
        </>
      }
    >
      {!user ? (
        <Notice tone="warning" title="Primero conecta tu cuenta de GitHub" action={<Link to="/settings" className="underline underline-offset-2">Conectar</Link>}>
          Lo que se publica queda a tu nombre: hay que saber quién eres.
        </Notice>
      ) : null}
      <div className="mt-1 flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[0.8125rem] font-medium">¿De dónde sale este contenido?</legend>
          {ORIGINS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="origin" checked={origin === option.value} onChange={() => setOrigin(option.value)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
              {option.label}
            </label>
          ))}
          <p className="text-xs text-muted">No publiques preguntas copiadas de exámenes o libros con derechos de autor, aunque sean para estudiar: este repositorio es público.</p>
        </fieldset>
        <Checkbox
          checked={accepted}
          onChange={setAccepted}
          label={
            <>
              Publico este contenido con licencia{' '}
              <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.es" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                CC BY-SA 4.0
              </a>
              . Entiendo que será público, con mi nombre de GitHub, y que Git conserva el historial.
            </>
          }
        />
        <p className="text-[0.8125rem] text-muted">
          {viaPull
            ? 'Se abrirá un pull request desde tu fork. Una Action lo valida y, si todo está bien, lo publica.'
            : hasToken
              ? 'Se enviará por lotes, sin que tengas que hacer nada. Una Action los valida y, si todo está bien, los publica.'
              : 'Se reparte en los menos envíos posibles; una pregunta con muchas imágenes puede necesitar varios. En Sincronización los confirmas en GitHub, uno tras otro, y una Action lo valida y lo publica. Con un token, se envía todo de una vez.'}
        </p>
      </div>
    </Dialog>
  );
}
