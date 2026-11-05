import { Download, HardDriveDownload, HardDriveUpload, Moon, Monitor, Sun, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountCard } from '@/features/account/AccountCard';
import { disconnect } from '@/features/account/identity';
import { downloadBlob } from '@/features/bank/importExport';
import { config } from '@/infra/config';
import { installPrompt, isIos, isStandalone, promptInstall, requestPersistence, storageInfo, type StorageInfo } from '@/infra/pwa/pwa';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { cn } from '@/ui/cn';
import { Card, CardHeader, Notice, PageHeader } from '@/ui/Surface';
import { Field, Input, Toggle } from '@/ui/Field';
import { toast } from '@/ui/toast';
import { BackupError, buildBackup, restoreBackup, wipeLocalData } from './backup';
import { preferences, updatePreferences, type ThemePreference } from './preferences';

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function AppearanceCard() {
  const prefs = preferences.use();
  return (
    <Card>
      <CardHeader title="Apariencia" />
      <div className="p-4">
        <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-md border border-border bg-subtle p-0.5">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={prefs.theme === value}
              onClick={() => void updatePreferences({ theme: value })}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium',
                prefs.theme === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
              )}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function StudyCard() {
  const prefs = preferences.use();
  return (
    <Card>
      <CardHeader title="Estudio" />
      <div className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Objetivo diario" hint="Respuestas al día.">
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                max={500}
                value={prefs.dailyGoal}
                onChange={(e) => void updatePreferences({ dailyGoal: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
              />
            )}
          </Field>
          <Field label={`Retención objetivo: ${Math.round(prefs.retention * 100)} %`} hint="Más alta significa recordar más, a cambio de repasar más a menudo.">
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="range"
                min={0.8}
                max={0.97}
                step={0.01}
                value={prefs.retention}
                onChange={(e) => void updatePreferences({ retention: Number(e.target.value) })}
                className="h-9 w-full accent-[var(--accent)]"
              />
            )}
          </Field>
        </div>
        <Toggle label="Avanzar al acertar" description="Pasa sola a la siguiente pregunta tras una respuesta correcta." checked={prefs.autoAdvance} onChange={(v) => void updatePreferences({ autoAdvance: v })} />
        <Toggle label="Ver la dificultad antes de responder" checked={prefs.showDifficulty} onChange={(v) => void updatePreferences({ showDifficulty: v })} />
      </div>
    </Card>
  );
}

function InstallCard() {
  const prompt = installPrompt.use();
  if (isStandalone()) return <Notice tone="success" title="La app está instalada en este dispositivo." />;
  return (
    <Card>
      <CardHeader title="Instalar la app" description="Se abre en su propia ventana y funciona sin conexión." />
      <div className="p-4 text-sm text-muted">
        {prompt ? (
          <Button variant="primary" icon={<Download size={16} aria-hidden />} onClick={() => void promptInstall()}>
            Instalar QuestionBank
          </Button>
        ) : isIos() ? (
          <p>En Safari: botón Compartir → «Añadir a pantalla de inicio».</p>
        ) : (
          <p>Usa la opción «Instalar» del menú del navegador, si está disponible. No todos los navegadores de escritorio la ofrecen.</p>
        )}
      </div>
    </Card>
  );
}

function StorageCard() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void storageInfo().then(setInfo);
  useEffect(refresh, []);

  const backup = async () => {
    downloadBlob(await buildBackup(), `questionbank-copia-${new Date().toISOString().slice(0, 10)}.json`);
    toast.success('Copia descargada.');
  };

  const restore = async (file: File) => {
    try {
      const report = await restoreBackup(file);
      toast.success(`Copia combinada: ${report.attempts} intentos y ${report.questions} preguntas nuevas.`);
      refresh();
    } catch (error) {
      toast.error(error instanceof BackupError ? error.message : 'No se ha podido restaurar la copia.');
    }
  };

  return (
    <Card>
      <CardHeader title="Datos locales" description="Tu progreso vive en este navegador. Nada sale de aquí salvo lo que publiques." />
      <div className="flex flex-col gap-3 p-4 text-sm">
        {info ? (
          <p className="text-muted">
            Ocupado: <span className="font-medium text-ink tabular-nums">{formatBytes(info.usage)}</span> de {formatBytes(info.quota)} disponibles.
          </p>
        ) : (
          <p className="text-muted">Este navegador no informa del espacio usado.</p>
        )}
        {info && !info.persisted ? (
          <Notice
            tone="warning"
            title="El navegador podría borrar estos datos si se queda sin espacio."
            action={
              <Button size="sm" onClick={() => void requestPersistence().then(refresh)}>
                Proteger datos
              </Button>
            }
          />
        ) : null}
        {info?.persisted ? <p className="text-success">Almacenamiento protegido frente a borrados automáticos.</p> : null}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button icon={<HardDriveDownload size={16} aria-hidden />} onClick={() => void backup()}>
            Descargar copia
          </Button>
          <Button icon={<HardDriveUpload size={16} aria-hidden />} onClick={() => input.current?.click()}>
            Combinar una copia
          </Button>
          <Button variant="danger" icon={<Trash2 size={16} aria-hidden />} onClick={() => setConfirmWipe(true)}>
            Borrar datos
          </Button>
        </div>
        <p className="text-xs text-muted">Para llevar tu progreso a otro dispositivo: descarga la copia aquí y combínala allí. Se suman los intentos sin duplicar nada.</p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void restore(file);
          }}
        />
      </div>
      <Dialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Borrar los datos de este dispositivo"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmWipe(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                void (async () => {
                  await disconnect();
                  await wipeLocalData();
                  window.location.assign(config.base);
                })();
              }}
            >
              Borrar todo
            </Button>
          </>
        }
      >
        Se perderán tu progreso, tus borradores y lo que no hayas publicado. Lo ya publicado sigue en el repositorio. No se puede deshacer: descarga antes una copia si tienes dudas.
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configuración" description="Cuenta, preferencias y datos de este dispositivo." />
      <div className="flex flex-col gap-4">
        <AccountCard />
        <AppearanceCard />
        <StudyCard />
        <InstallCard />
        <StorageCard />
        <p className="text-xs text-faint">
          Versión {config.version} · <Link to="/sync" className="underline underline-offset-2">Sincronización</Link>
        </p>
      </div>
    </>
  );
}
