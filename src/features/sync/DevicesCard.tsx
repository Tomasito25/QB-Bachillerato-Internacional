import { CheckCircle2, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { online } from '@/infra/connectivity';
import { config } from '@/infra/config';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Checkbox, Field, Input } from '@/ui/Field';
import { OutLink } from '@/ui/OutLink';
import { Card, CardHeader, Notice } from '@/ui/Surface';
import { timeAgo } from '@/ui/time';
import { toast } from '@/ui/toast';
import { createPairing, deviceSync, deviceSyncSupported, disableDeviceSync, enableDeviceSync, ExistingCopyError, linkThisDevice, syncDevices, type Pairing } from './deviceSync';
import { sealedFromInput } from './pairing';

const TOKEN_URL = `https://github.com/settings/tokens/new?scopes=gist&description=${encodeURIComponent(`${config.appName} sync`)}`;
/** El código da acceso a tu copia: no se deja a la vista más de lo necesario. */
const PAIRING_VISIBLE_MS = 3 * 60 * 1000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'No se ha podido completar.');

function QrCode({ text }: { text: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null);
  useEffect(() => {
    let live = true;
    void import('uqr').then(({ encode }) => {
      const { size, data } = encode(text, { ecc: 'M', border: 3 });
      let path = '';
      data.forEach((row, y) => row.forEach((on, x) => {
        if (on) path += `M${x} ${y}h1v1h-1z`;
      }));
      if (live) setQr({ size, path });
    });
    return () => {
      live = false;
    };
  }, [text]);
  if (!qr) return <div className="aspect-square w-full max-w-72" />;
  // Negro sobre blanco también en modo oscuro: invertido, muchos lectores no lo leen.
  return (
    <svg role="img" aria-label="Código QR para vincular este dispositivo" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" className="aspect-square w-full max-w-72">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

function PairDialog({ onClose }: { onClose: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  useEffect(() => {
    void createPairing().then(setPairing, (error: unknown) => {
      toast.error(errorText(error));
      onClose();
    });
    const timer = window.setTimeout(onClose, PAIRING_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  const shown = pairing ? `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}` : '';
  return (
    <Dialog open onClose={onClose} title="Vincular otro dispositivo">
      {pairing ? (
        <div className="flex flex-col items-center gap-4">
          <p className="self-start">1. En el móvil, abre la cámara y escanea este código.</p>
          <QrCode text={pairing.url} />
          <p className="self-start">2. Escribe allí este código:</p>
          <p className="qb-display text-[2.5rem] font-black tabular-nums" aria-label={`Código ${pairing.code.split('').join(' ')}`}>
            {shown}
          </p>
          <Button onClick={() => void navigator.clipboard.writeText(pairing.url).then(() => toast.success('Enlace copiado.'), () => toast.error('El navegador no ha permitido copiar.'))}>Copiar el enlace en su lugar</Button>
          <p className="text-[0.8125rem] text-muted">Quien tenga el enlace y el código puede usar tu copia. Esta ventana se cierra sola en 3 minutos. Si tienes la app instalada en un iPhone, copia el enlace y pégalo dentro de la app.</p>
        </div>
      ) : (
        <p role="status">Preparando el código…</p>
      )}
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const [deleteCopy, setDeleteCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Dejar de sincronizar"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() => {
              setBusy(true);
              void disableDeviceSync(deleteCopy).then(onClose, (error: unknown) => {
                toast.error(errorText(error));
                setBusy(false);
              });
            }}
          >
            Dejar de sincronizar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p>Todo lo que hay en este dispositivo se queda aquí. Sólo deja de actualizarse con los otros.</p>
        <Checkbox checked={deleteCopy} onChange={setDeleteCopy} label="Borrar también la copia de GitHub. Los demás dispositivos dejarán de sincronizarse." />
      </div>
    </Dialog>
  );
}

function Enabled() {
  const state = deviceSync.use();
  const isOnline = online.use();
  const [pairing, setPairing] = useState(false);
  const [disabling, setDisabling] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-3 p-4 text-sm">
        {state.status === 'error' ? (
          <Notice tone="danger" title="No se ha podido sincronizar">
            {state.message} Lo que hay en este dispositivo sigue intacto.
          </Notice>
        ) : (
          <p className="flex items-center gap-2 font-medium" role="status">
            <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />
            {state.status === 'syncing' ? 'Sincronizando…' : state.lastSyncAt ? `Al día. Última vez: ${timeAgo(state.lastSyncAt)}` : 'Activa.'}
          </p>
        )}
        <p className="text-muted">Viajan tu progreso, repasos, exámenes, preguntas propias, borradores, amigos y objetivos. El tema, el color y tu PDF se quedan en cada dispositivo.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<MonitorSmartphone size={16} aria-hidden />} onClick={() => setPairing(true)}>
            Vincular otro dispositivo
          </Button>
          <Button busy={state.status === 'syncing'} disabled={!isOnline} icon={<RefreshCw size={16} aria-hidden />} onClick={() => void syncDevices()}>
            Sincronizar ahora
          </Button>
          <Button variant="ghost" onClick={() => setDisabling(true)}>
            Dejar de sincronizar
          </Button>
        </div>
      </div>
      {pairing ? <PairDialog onClose={() => setPairing(false)} /> : null}
      {disabling ? <DisableDialog onClose={() => setDisabling(false)} /> : null}
    </>
  );
}

function Setup() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'token' | 'link' | null>(null);
  const [existing, setExisting] = useState(false);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // El enlace se saca de la barra de direcciones en cuanto llega: que no se quede en el historial.
  useEffect(() => {
    if (!hash.startsWith('#pair=')) return;
    setLink(hash);
    void navigate('/sync', { replace: true });
  }, [hash, navigate]);

  const activate = (startOver: boolean) => {
    setBusy('token');
    setError(null);
    void enableDeviceSync(token, startOver).then(
      () => setToken(''),
      (e: unknown) => {
        if (e instanceof ExistingCopyError) setExisting(true);
        else setError(errorText(e));
      },
    ).finally(() => setBusy(null));
  };

  const pair = () => {
    setBusy('link');
    setError(null);
    void linkThisDevice(sealedFromInput(link), code).catch((e: unknown) => setError(errorText(e))).finally(() => setBusy(null));
  };

  return (
    <div className="grid gap-6 p-4 text-sm md:grid-cols-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          activate(false);
        }}
      >
        <h3 className="font-bold">En el primer dispositivo</h3>
        <p className="text-muted">
          1. <OutLink href={TOKEN_URL}>Crea un token en GitHub</OutLink> con sólo el permiso «gist». Si quieres que no caduque, elige «No expiration».
        </p>
        <Field label="2. Pega aquí el token" hint="Se guarda cifrado en este dispositivo y sólo se usa para hablar con GitHub.">
          {(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" busy={busy === 'token'} disabled={token.trim() === ''} className="self-start">
          Activar
        </Button>
        {existing ? (
          <Notice tone="warning" title="Ya tienes una copia de otro dispositivo">
            <p>Vincula este desde allí, para no perderla: pulsa «Vincular otro dispositivo» en el otro.</p>
            <button type="button" className="mt-2 font-bold underline underline-offset-2" onClick={() => setConfirmStartOver(true)}>
              No tengo ese dispositivo: empezar de cero
            </button>
          </Notice>
        ) : null}
      </form>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          pair();
        }}
      >
        <h3 className="font-bold">Si ya lo activaste en otro</h3>
        {link ? <p className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />Enlace recibido. Falta el código.</p> : (
          <Field label="Enlace de vinculación" hint="Escanea el código QR del otro dispositivo, o pega aquí su enlace.">
            {(id) => <Input id={id} autoComplete="off" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} />}
          </Field>
        )}
        <Field label="Código de 8 caracteres">
          {(id) => <Input id={id} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Button type="submit" variant={link ? 'primary' : 'secondary'} busy={busy === 'link'} disabled={link.trim() === '' || code.trim() === ''} className="self-start">
          Vincular
        </Button>
      </form>
      {error ? (
        <Notice tone="danger" title="No se ha podido" className="md:col-span-2">
          {error}
        </Notice>
      ) : null}
      <Dialog
        open={confirmStartOver}
        onClose={() => setConfirmStartOver(false)}
        size="sm"
        title="¿Empezar de cero?"
        footer={
          <>
            <Button onClick={() => setConfirmStartOver(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmStartOver(false);
                setExisting(false);
                activate(true);
              }}
            >
              Borrar y empezar
            </Button>
          </>
        }
      >
        Se borrará la copia que hay en GitHub. Sólo se conserva lo que tengas en cada dispositivo.
      </Dialog>
    </div>
  );
}

/** Mismo progreso en el móvil y en el ordenador, sin servidores propios. */
export function DevicesCard() {
  const state = deviceSync.use();
  return (
    <Card>
      <CardHeader title="Tus dispositivos" description="Empieza en el ordenador y sigue en el móvil. Tus datos viajan cifrados a un gist secreto de tu cuenta de GitHub." />
      {!deviceSyncSupported() ? (
        <div className="p-4">
          <Notice tone="warning" title="Este navegador es demasiado antiguo">
            Sin soporte de compresión no puede sincronizar. Puedes pasar los datos con una copia, en Configuración.
          </Notice>
        </div>
      ) : state.enabled ? (
        <Enabled />
      ) : (
        <Setup />
      )}
    </Card>
  );
}
