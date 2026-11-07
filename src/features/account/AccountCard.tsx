import { AlertTriangle, ExternalLink, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/features/bank/parts';
import { config, hasCommunity } from '@/infra/config';
import { RateLimitError } from '@/infra/github/client';
import { Button } from '@/ui/Button';
import { Checkbox, Field, Input } from '@/ui/Field';
import { OutLink } from '@/ui/OutLink';
import { Card, CardHeader, Notice } from '@/ui/Surface';
import { toast } from '@/ui/toast';
import { cancelConnect, checkConnect, connectWithToken, disconnect, getPendingConnect, identity, removeToken, startConnect, TOKEN_CREATE_URL, tokenReady, type PendingConnect } from './identity';

const POLL_MS = 10_000;
const MAX_POLLS = 18;

/** Conexión sin token: abres un issue con tu sesión de GitHub y la app reconoce quién lo creó. */
function ConnectFlow() {
  const [pending, setPending] = useState<PendingConnect | null>(null);
  const [checking, setChecking] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    void getPendingConnect().then((value) => setPending(value ?? null));
  }, []);

  const check = useCallback(async (manual: boolean) => {
    setChecking(true);
    try {
      const found = await checkConnect();
      if (found) {
        toast.success(`Conectado como @${found.login}.`);
        setPending(null);
      } else if (manual) {
        toast.info('Todavía no aparece el issue. ¿Has pulsado «Create» en GitHub?');
      }
    } catch (error) {
      if (manual) toast.error(error instanceof RateLimitError ? error.message : `No se ha podido comprobar: ${(error as Error).message}`);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!pending) return;
    polls.current = 0;
    const poll = () => {
      // Sin token sólo hay 60 consultas por hora: se comprueba poco, y sólo con la app a la vista.
      if (document.visibilityState === 'visible' && polls.current < MAX_POLLS) {
        polls.current += 1;
        void check(false);
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    // Lo normal es volver de la pestaña de GitHub justo después de pulsar «Create».
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [pending, check]);

  if (!hasCommunity()) {
    return <p className="text-sm text-muted">Este despliegue no tiene repositorio comunitario, así que no hay nada a lo que conectarse.</p>;
  }

  if (!pending) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Tu identidad es tu cuenta de GitHub. No hace falta contraseña ni token: abres un issue con tu propia sesión y GitHub certifica que eres tú. La app funciona entera sin conectar; sólo lo necesitas para publicar y competir.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void startConnect().then(setPending)}>
            Conectar con GitHub
          </Button>
          <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer" className="text-[0.8125rem] text-muted underline underline-offset-2 hover:text-ink">
            No tengo cuenta
          </a>
        </div>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-3 text-sm">
      <li>
        <p className="font-medium">1. Abre GitHub y pulsa «Create»</p>
        <p className="mt-0.5 mb-2 text-[0.8125rem] text-muted">El issue ya está escrito. Sólo prueba que eres tú, y se cierra solo.</p>
        <a href={pending.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover">
          <ExternalLink size={16} aria-hidden />
          Abrir GitHub
        </a>
      </li>
      <li>
        <p className="font-medium">2. Vuelve aquí</p>
        <p className="mt-0.5 mb-2 text-[0.8125rem] text-muted" role="status">
          Se detecta solo en unos segundos.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button busy={checking} onClick={() => void check(true)}>
            Comprobar ahora
          </Button>
          <Button variant="ghost" onClick={() => void cancelConnect().then(() => setPending(null))}>
            Cancelar
          </Button>
        </div>
      </li>
    </ol>
  );
}

function TokenSection() {
  const hasToken = tokenReady.use();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasToken) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="flex items-center gap-2 text-sm">
          <KeyRound size={15} className="text-success" aria-hidden />
          Publicando sin clics, con token.
        </p>
        <Button size="sm" onClick={() => void removeToken().then(() => toast.info('Token olvidado. Revócalo también en GitHub si ya no lo usas.'))}>
          Quitar token
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[0.8125rem] font-medium underline-offset-2 hover:underline">
        Avanzado: publicar sin clics con un token
      </button>
      {open ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            connectWithToken(token, remember)
              .then(({ identity: user, excessive }) => {
                setToken('');
                toast.success(`Token válido para @${user.login}.`);
                if (excessive.length > 0) toast.error(`Este token tiene más permisos de los necesarios (${excessive.join(', ')}). Mejor crea otro sólo con public_repo.`);
              })
              .catch((e: unknown) => setError((e as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <Notice tone="warning" title="Piénsatelo: da permiso de escritura en todos tus repos públicos">
            GitHub sólo permite contribuir a repos ajenos con un token clásico <code>public_repo</code>; los de grano fino no pueden. Ponle caducidad corta. Sin token, todo funciona igual con un clic más: es la opción más segura.
          </Notice>
          <a href={TOKEN_CREATE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] underline underline-offset-2">
            Crear un token en GitHub
            <ExternalLink size={12} aria-hidden />
          </a>
          <Field label="Token" error={error}>
            {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" />}
          </Field>
          <Checkbox
            checked={remember}
            onChange={setRemember}
            label={
              <>
                Recordarlo en este dispositivo <span className="text-muted">(cifrado). Si no, se olvida al cerrar la pestaña.</span>
              </>
            }
          />
          <Button type="submit" className="w-fit" busy={busy} disabled={!token.trim()}>
            Comprobar y guardar
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function AccountCard() {
  const user = identity.use();
  return (
    <Card>
      <CardHeader title="Cuenta" />
      <div className="flex flex-col gap-4 p-4">
        {user ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar user={user} size={36} />
                <div className="min-w-0">
                  <Link to="/profile" className="block truncate text-sm font-semibold hover:underline">
                    @{user.login}
                  </Link>
                  <p className="flex items-center gap-1 text-xs text-muted">
                    <ShieldCheck size={12} className="text-success" aria-hidden />
                    Verificado por GitHub
                  </p>
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<LogOut size={14} aria-hidden />} onClick={() => void disconnect()}>
                Desconectar
              </Button>
            </div>
            {hasCommunity() ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <OutLink href={`https://github.com/${user.login}`}>Tu perfil de GitHub</OutLink>
                <OutLink href={config.repoUrl(`/issues?q=${encodeURIComponent(`author:${user.login}`)}`)}>Tus envíos</OutLink>
                <OutLink href={config.repoUrl()}>El repositorio</OutLink>
              </div>
            ) : null}
            <p className="text-xs text-muted">Desconectar sólo afecta a este dispositivo: tu progreso sigue aquí y lo publicado sigue publicado.</p>
          </>
        ) : (
          <ConnectFlow />
        )}
        {hasCommunity() ? <TokenSection /> : null}
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          Por qué no hay un botón «Iniciar sesión con GitHub»: esos flujos exigen un servidor, porque GitHub no permite completarlos desde una página estática.
        </p>
      </div>
    </Card>
  );
}
