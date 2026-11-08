import { GraduationCap, Palette, PencilLine, Share2, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { AppearanceControls } from '@/features/settings/appearance';
import { config, hasCommunity } from '@/infra/config';
import { kvGet, kvSet } from '@/infra/db/db';
import { createStore } from '@/infra/store';
import { Button, ButtonLink } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { cn } from '@/ui/cn';

const KEY = 'welcome-tour';
/** Súbelo cuando el tutorial cambie lo bastante como para volver a enseñárselo a todo el mundo. */
const VERSION = 1;

/** Abierto o cerrado. La Guía lo abre a mano con `welcomeTour.set(true)`. */
export const welcomeTour = createStore(false);

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 leading-relaxed">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-none bg-accent" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const Key = ({ children }: { children: ReactNode }) => <kbd className="rounded-none border border-border bg-subtle px-1.5 py-0.5 font-mono text-xs">{children}</kbd>;

interface Step {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  community?: boolean;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: `Te damos la bienvenida a ${config.appName}`,
    body: (
      <Points
        items={[
          'Un banco de preguntas que mantiene la gente que lo usa: estudias con las de todos y, si quieres, añades las tuyas.',
          'Funciona sin conexión y sin cuenta. Lo tuyo se queda en este dispositivo hasta que decidas publicarlo.',
          'Son cinco pasos. Puedes saltarlos y volver cuando quieras desde la Guía.',
        ]}
      />
    ),
  },
  {
    icon: Palette,
    title: 'Ponla a tu gusto',
    body: (
      <div className="flex flex-col gap-4">
        <AppearanceControls />
        <p className="text-xs text-muted">Esto y más (objetivo diario, preguntas por práctica…) está en Configuración.</p>
      </div>
    ),
  },
  {
    icon: GraduationCap,
    title: 'Estudia a tu ritmo',
    body: (
      <Points
        items={[
          'Práctica: una tanda corta con la corrección al momento.',
          'Examen: con reloj, y las soluciones al entregar.',
          'Repaso: cada pregunta vuelve justo cuando empezarías a olvidarla.',
          <>
            Con teclado: <Key>1</Key>–<Key>9</Key> o <Key>A</Key>, <Key>B</Key>… eligen, <Key>Intro</Key> comprueba y pasa, <Key>Espacio</Key> enseña la solución y <Key>F</Key> marca favorita.
          </>,
        ]}
      />
    ),
  },
  {
    icon: PencilLine,
    title: 'Crea tus preguntas',
    body: (
      <Points
        items={[
          'Con «Nueva pregunta»: tipo test, o de desarrollo.',
          'El botón Σ abre el asistente de fórmulas: fracciones, raíces, letras griegas y unidades con un clic, y la vista previa al lado.',
          'Cada opción de un tipo test puede llevar su imagen o su fórmula.',
          'Las de desarrollo se pueden dividir en apartados a), b), c)…, cada uno con su solución, sus imágenes y sus puntos.',
        ]}
      />
    ),
  },
  {
    icon: Share2,
    title: 'Comparte y compite, si quieres',
    community: true,
    body: (
      <Points
        items={[
          'Conecta tu cuenta de GitHub para publicar preguntas, salir en los rankings y competir. Para estudiar no hace falta.',
          'Ponte un nombre visible en tu perfil. Se puede cambiar una vez al mes.',
          'Añade amigos para comparar vuestro progreso o retarlos a un duelo. La lista es tuya: nadie más la ve.',
        ]}
      />
    ),
  },
];

/** Tutorial de bienvenida: sale una vez y luego se abre desde la Guía. */
export function WelcomeTour() {
  const open = welcomeTour.use();
  const [step, setStep] = useState(0);
  const steps = STEPS.filter((s) => !s.community || hasCommunity());

  useEffect(() => {
    void kvGet<number>(KEY).then((seen) => {
      if ((seen ?? 0) < VERSION) welcomeTour.set(true);
    });
  }, []);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const close = () => {
    welcomeTour.set(false);
    void kvSet(KEY, VERSION);
  };

  const current = steps[step] ?? steps[0];
  if (!current) return null;
  const Icon = current.icon;
  const last = step === steps.length - 1;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Tutorial"
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5" aria-label={`Paso ${step + 1} de ${steps.length}`} role="img">
            {steps.map((s, index) => (
              <span key={s.title} className={cn('size-1.5 rounded-none', index === step ? 'bg-accent' : 'bg-border-strong')} />
            ))}
          </div>
          {step > 0 ? (
            <Button onClick={() => setStep(step - 1)}>Atrás</Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              Saltar
            </Button>
          )}
          {last ? (
            <>
              <ButtonLink to="/guide" onClick={close}>
                Ver la guía
              </ButtonLink>
              <Button variant="primary" onClick={close}>
                Empezar
              </Button>
            </>
          ) : (
            <Button variant="primary" data-autofocus onClick={() => setStep(step + 1)}>
              Siguiente
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-none bg-accent-soft text-accent-text">
            <Icon size={20} aria-hidden />
          </span>
          <h3 className="text-base font-semibold tracking-tight">{current.title}</h3>
        </div>
        {current.body}
      </div>
    </Dialog>
  );
}
