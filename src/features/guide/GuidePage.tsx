import { GraduationCap, Keyboard, Palette, PencilLine, PlayCircle, Rocket, Share2, ShieldCheck, Swords, Users, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { config, hasCommunity } from '@/infra/config';
import { Button, ButtonLink } from '@/ui/Button';
import { OutLink } from '@/ui/OutLink';
import { Card, CardHeader, PageHeader } from '@/ui/Surface';
import { welcomeTour } from './WelcomeTour';

interface Tutorial {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  steps: string[];
  links: { to: string; label: string }[];
  /** Habla de GitHub: sin repositorio comunitario no hay nada que hacer ahí. */
  community?: boolean;
  keys?: [string, string][];
}

// Los nombres entre comillas son los de los botones: si cambia uno, cámbialo aquí también.
const TUTORIALS: Tutorial[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    summary: 'Qué necesitas para empezar: nada más que preguntas.',
    icon: Rocket,
    steps: [
      'Consigue preguntas: descarga las de la comunidad en Sincronización o escribe las tuyas con «Nueva pregunta».',
      'En Inicio tienes tu objetivo del día, cómo vas por asignatura y los temas a reforzar. En Estudiar están los modos, los simulacros y el calendario.',
      'Todo se guarda en este dispositivo y funciona sin conexión. Para estudiar no hace falta cuenta.',
      'El banco comunitario se actualiza solo: al abrir la app, al recuperar la conexión y cada pocos minutos.',
      'Instálala desde Configuración para abrirla en su propia ventana, como una app más.',
    ],
    links: [
      { to: '/sync', label: 'Sincronización' },
      { to: '/study', label: 'Estudiar' },
    ],
  },
  {
    id: 'estudiar',
    title: 'Estudiar',
    summary: 'Cuatro formas de estudiar y los atajos de teclado.',
    icon: GraduationCap,
    steps: [
      'Práctica: una tanda corta con corrección y explicación al momento. Cuántas preguntas, lo eliges en Configuración.',
      'Examen: tú pones el número de preguntas y los minutos. Las soluciones se ven al entregar.',
      'Repaso: repetición espaciada. «Toca repasar» trae lo que estás a punto de olvidar; también puedes repasar falladas, difíciles o favoritas.',
      'Personalizado: filtra por asignatura, unidad, tema, tipo o dificultad, y elige el modo.',
      '«Temario que entra» te deja estudiar sólo unos temas o bloquear los que no te entren. Vale para práctica, examen y repaso, hasta que lo cambies.',
      'El objetivo diario se fija por separado para tipo test y desarrollo. En Inicio, «Hacer lo que falta» te prepara justo eso.',
      'En las de desarrollo con apartados respondes cada uno, ves su solución y dices qué tal te ha salido: la nota se sugiere sola, según los puntos de cada apartado.',
      'Al terminar verás tus resultados. En Estadísticas, cómo vas en cada asignatura.',
      'En Simulacros haces una prueba con el tiempo y el número de preguntas del IB; el test se corrige solo y el desarrollo lo autoevalúas al entregar.',
      'En Calendario apuntas tus mocks y exámenes y lo que entra en cada uno. El plan de cada día se calcula con tu progreso y se rehace al estudiar.',
    ],
    keys: [
      ['1–9 o A, B, C…', 'Elegir respuesta'],
      ['Intro', 'Comprobar, o pasar a la siguiente'],
      ['Espacio', 'Ver la solución de una pregunta de desarrollo'],
      ['F', 'Marcar como favorita'],
    ],
    links: [
      { to: '/study', label: 'Estudiar' },
      { to: '/stats', label: 'Estadísticas' },
    ],
  },
  {
    id: 'crear',
    title: 'Crear preguntas',
    summary: 'Escribir, dar formato y ordenar por temas.',
    icon: PencilLine,
    steps: [
      'Pulsa «Nueva pregunta» y elige el tipo: tipo test (una o varias correctas) o desarrollo.',
      'Para una fórmula, pulsa Σ: el asistente tiene botones para fracciones, raíces, potencias, letras griegas, cálculo y unidades, y enseña el resultado mientras escribes. Con el cursor dentro de una fórmula, Σ la edita.',
      'Cada opción de un tipo test tiene sus botones de fórmula e imagen, y debajo ves cómo quedará.',
      'Una de desarrollo se puede dividir en apartados a), b), c)… y cada apartado en subapartados i), ii)…: cada uno con su pregunta, su solución, sus imágenes y sus puntos. Caben hasta 10 imágenes por pregunta.',
      'Mira la vista previa antes de guardar: es como la verá quien estudie.',
      'Clasifícala por asignatura, unidad y tema. Si falta alguno, créalo en Temario.',
      'Se queda en este dispositivo. Sólo se comparte si la publicas.',
    ],
    links: [
      { to: '/create', label: 'Nueva pregunta' },
      { to: '/subjects', label: 'Temario' },
      { to: '/bank', label: 'Banco de preguntas' },
    ],
  },
  {
    id: 'github',
    title: 'Compartir con GitHub',
    summary: 'Conectar tu cuenta y publicar preguntas o resultados.',
    icon: Share2,
    community: true,
    steps: [
      'En Configuración › Cuenta, pulsa «Conectar con GitHub». Se abre un issue ya escrito: pulsa «Create» y vuelve. Así GitHub certifica que eres tú, sin contraseñas ni tokens.',
      'Para publicar una pregunta, ábrela y pulsa «Publicar». Para varias a la vez, márcalas en Sincronización › Sin publicar.',
      'Se abre GitHub con el envío preparado: pulsa «Create». Si no cabe en la dirección, la app te pide copiarlo y pegarlo en la descripción.',
      'Con muchas preguntas, márcalas por asignatura en Sin publicar. La app las reparte en los menos envíos posibles y en Envíos te deja confirmarlos uno tras otro.',
      'Una GitHub Action lo revisa y, si está bien, lo publica. Suele tardar unos minutos; el estado lo ves en Sincronización › Envíos.',
      'Opcional: con un token de GitHub (permiso public_repo) los envíos salen sin abrir GitHub. Se guarda cifrado en este dispositivo, pero da permiso de escritura en todos tus repos públicos.',
    ],
    links: [
      { to: '/settings', label: 'Conectar' },
      { to: '/sync', label: 'Sincronización' },
    ],
  },
  {
    id: 'competir',
    title: 'Competir y rankings',
    summary: 'Duelos, grupos, torneos y retos para todo el mundo.',
    icon: Swords,
    community: true,
    steps: [
      'En Competiciones › Crear eliges duelo (dos personas), grupal (las que quieran) o torneo (eliminatoria por rondas), el temario y las reglas.',
      'Pasa el código a quien invites: lo escribe en «¿Tienes un código?». Para participar hace falta la cuenta conectada.',
      'Cada persona juega cuando puede, dentro del plazo. Los retos diarios y semanales son los mismos para todo el mundo.',
      'Para salir en Rankings, publica tus resultados en Sincronización. Los puntos los calcula GitHub Actions a partir de las respuestas: nadie puede escribirlos a mano.',
    ],
    links: [
      { to: '/competitions', label: 'Competiciones' },
      { to: '/leaderboards', label: 'Rankings' },
    ],
  },
  {
    id: 'amigos',
    title: 'Tu nombre y tus amigos',
    summary: 'Cómo te ven los demás y a quién sigues tú.',
    icon: Users,
    community: true,
    steps: [
      'Tu identidad es tu cuenta de GitHub. En tu perfil, «Editar» deja poner un nombre visible y una biografía. Con «Preparar envío» queda listo, y se manda desde Sincronización, como lo demás.',
      'El nombre se puede cambiar una vez cada 30 días, y no puede ser el de otra persona. Al lado se verá siempre tu @usuario, que es lo que nadie puede imitar.',
      'Para añadir amigos, escribe su usuario en Amigos o pulsa «Añadir a amigos» en su perfil. Verás sus puntos, su nivel y su racha junto a los tuyos, y también en Rankings › Amigos.',
      'La lista de amigos sólo está en este dispositivo (y en tus copias): nadie se entera de a quién añades. Para llevarla a otro, usa la copia de seguridad.',
      'En la lista de amigos, «Retar» prepara un duelo con esa persona.',
    ],
    links: [
      { to: '/friends', label: 'Amigos' },
      { to: '/profile', label: 'Mi perfil' },
    ],
  },
  {
    id: 'personalizar',
    title: 'Personalizar',
    summary: 'Que la app se parezca a cómo estudias tú.',
    icon: Palette,
    steps: [
      'Tema claro, oscuro o el del sistema, y seis colores de acento.',
      'Tamaño del texto (de pequeño a muy grande) y tipo de letra: Inter, la de tu sistema o una con serifa, más cómoda para leer mucho rato.',
      '«Sólo estudiar» quita competiciones, rankings y amigos de los menús y de Inicio.',
      'Ajusta tu objetivo diario de cada tipo de pregunta y cuántas preguntas trae cada práctica.',
      'Decide si pasar sola a la siguiente al acertar y si ver la dificultad antes de responder.',
    ],
    links: [{ to: '/settings', label: 'Configuración' }],
  },
  {
    id: 'datos',
    title: 'Tus datos',
    summary: 'Qué se queda aquí, qué es público y cómo llevártelo.',
    icon: ShieldCheck,
    steps: [
      'Tu progreso, tus borradores y lo que no publicas sólo están en este navegador. No hay ningún servidor que los guarde.',
      'Lo que publicas va a un repositorio público de GitHub, con tu usuario y licencia CC BY-SA 4.0. Aunque luego se retire, sigue en la historia del repositorio.',
      'Para tener el móvil y el ordenador al día, activa «Tus dispositivos» en Sincronización y escanea el código desde el otro. Los datos viajan cifrados a un gist secreto de tu cuenta.',
      'El navegador puede borrar los datos si se queda sin espacio: descarga una copia de vez en cuando.',
    ],
    links: [{ to: '/settings', label: 'Configuración' }],
  },
];

function TutorialCard({ tutorial }: { tutorial: Tutorial }) {
  const Icon = tutorial.icon;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Icon size={16} className="shrink-0 text-accent-text" aria-hidden />
            {tutorial.title}
          </span>
        }
        description={tutorial.summary}
      />
      <div className="flex flex-col gap-4 p-4">
        <ol className="flex flex-col gap-3">
          {tutorial.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-accent-soft text-xs font-semibold text-accent-text tabular-nums">{index + 1}</span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        {tutorial.keys ? (
          <div className="rounded-md bg-subtle/70 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Keyboard size={14} aria-hidden />
              Atajos durante una sesión
            </p>
            <dl className="grid gap-x-4 gap-y-1.5 text-[0.8125rem] sm:grid-cols-[auto_1fr]">
              {tutorial.keys.map(([keys, action]) => (
                <div key={keys} className="contents">
                  <dt>
                    <kbd className="rounded-none border border-border bg-surface px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
                  </dt>
                  <dd className="mb-1 text-muted sm:mb-0">{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {tutorial.links.map((link) => (
            <ButtonLink key={link.to} to={link.to} size="sm">
              {link.label}
            </ButtonLink>
          ))}
          {tutorial.id === 'github' ? <OutLink href={config.repoUrl()} className="ml-1">El repositorio</OutLink> : null}
        </div>
      </div>
    </Card>
  );
}

export default function GuidePage() {
  const tutorials = TUTORIALS.filter((tutorial) => !tutorial.community || hasCommunity());
  const { hash } = useLocation();
  // ScrollRestoration busca el #ancla antes de que llegue esta página diferida: al recargar no la encuentra.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  return (
    <>
      <PageHeader
        title="Guía"
        description={`Cómo sacarle partido a ${config.appName}, paso a paso.`}
        actions={
          <Button icon={<PlayCircle size={16} aria-hidden />} onClick={() => welcomeTour.set(true)}>
            Tutorial de bienvenida
          </Button>
        }
      />
      <nav aria-label="Tutoriales" className="mb-5 flex flex-wrap gap-1.5">
        {tutorials.map((tutorial) => (
          <a key={tutorial.id} href={`#${tutorial.id}`} className="rounded-none border border-border bg-surface px-3 py-1 text-[0.8125rem] text-muted hover:border-border-strong hover:text-ink">
            {tutorial.title}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-4">
        {tutorials.map((tutorial) => (
          <section key={tutorial.id} id={tutorial.id} aria-label={tutorial.title} className="scroll-mt-20">
            <TutorialCard tutorial={tutorial} />
          </section>
        ))}
      </div>
    </>
  );
}
