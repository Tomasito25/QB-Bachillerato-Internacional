import { Plus, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES, Login, normalizeLogin, type Difficulty } from '@core/schema/common';
import { COMPETITION_TYPE_LABELS } from '@core/schema/competition';
import { filterQuestions } from '@core/questions/filter';
import { identity, newNonce } from '@/features/account/identity';
import { useQuestions } from '@/features/bank/questionsRepo';
import { enqueue } from '@/features/sync/outbox';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { Button } from '@/ui/Button';
import { Field, Input, Select } from '@/ui/Field';
import { Card, CardHeader, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';

type CreatableType = 'duel' | 'group' | 'tournament';

const DESCRIPTIONS: Record<CreatableType, string> = {
  duel: 'Dos personas, las mismas preguntas. Gana quien acierte más.',
  group: 'Las personas que quieran, con clasificación al cerrar.',
  tournament: 'Eliminatoria por rondas. El cuadro se sortea al cerrar la inscripción.',
};

export default function NewCompetitionPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const user = identity.use();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [type, setType] = useState<CreatableType>(params.get('invite') ? 'duel' : 'group');
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [count, setCount] = useState(10);
  const [minutes, setMinutes] = useState(10);
  const [windowHours, setWindowHours] = useState(48);
  const [invites, setInvites] = useState(params.get('invite') ?? '');
  const [maxParticipants, setMaxParticipants] = useState(8);
  const [registrationHours, setRegistrationHours] = useState(24);
  const [roundHours, setRoundHours] = useState(48);
  const [busy, setBusy] = useState(false);

  const filters = useMemo(
    () => ({
      ...(subjectId ? { subjectId } : {}),
      ...(unitId ? { unitIds: [unitId] } : {}),
      ...(topicId ? { topicIds: [topicId] } : {}),
      ...(difficulties.length > 0 ? { difficulties } : {}),
    }),
    [subjectId, unitId, topicId, difficulties],
  );

  // Se cuenta sólo lo publicado: el servidor no conoce las preguntas que aún son locales.
  const eligible = useMemo(() => (questions && taxonomy ? filterQuestions(questions.filter((q) => q.type === 'mcq' && q.origin === 'community'), filters, taxonomy.index).length : 0), [questions, taxonomy, filters]);

  if (!questions || !taxonomy) return <Spinner />;

  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  const unit = subject?.units.find((u) => u.id === unitId);

  const invited = invites.split(/[\s,]+/).map((v) => normalizeLogin(v.replace(/^@/, ''))).filter(Boolean);
  const badInvite = invited.find((login) => !Login.safeParse(login).success);
  const defaultTitle = `${COMPETITION_TYPE_LABELS[type]} de ${taxonomy.index.topics.get(topicId)?.topic.name ?? unit?.name ?? subject?.name ?? 'todo el banco'}`;
  const canSubmit = user && eligible >= 3 && !badInvite;

  const submit = async () => {
    setBusy(true);
    try {
      await enqueue(
        {
          v: 1,
          kind: 'competition-create',
          nonce: newNonce(),
          type,
          title: title.trim() || defaultTitle,
          filters,
          questionCount: Math.min(count, 50),
          durationSec: minutes * 60,
          windowHours,
          invited,
          maxParticipants: type === 'group' ? null : type === 'duel' ? 2 : maxParticipants,
          ...(type === 'tournament' ? { registrationHours, roundHours } : {}),
        },
        `Creo «${title.trim() || defaultTitle}»${invited.length > 0 ? `, invitando a ${invited.map((l) => `@${l}`).join(', ')}` : ''}.`,
        {},
      );
      toast.success('Preparada. Envíala desde Sincronización.');
      navigate('/sync');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Nueva competición" description="Las preguntas las elige GitHub Actions con una semilla que nadie conoce de antemano." />
      <div className="flex flex-col gap-4">
        {!user ? (
          <Notice tone="warning" title="Para crear una competición, conecta tu cuenta de GitHub" action={<Link to="/settings" className="underline underline-offset-2">Conectar</Link>}>
            Quien organiza y quien participa se identifican con su cuenta.
          </Notice>
        ) : null}

        <div role="radiogroup" aria-label="Tipo de competición" className="grid gap-2 sm:grid-cols-3">
          {(['duel', 'group', 'tournament'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => setType(value)}
              className={cn('rounded-lg border p-3 text-left transition-colors', type === value ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-border-strong')}
            >
              <span className="block text-sm font-semibold">{COMPETITION_TYPE_LABELS[value]}</span>
              <span className="mt-0.5 block text-xs text-muted">{DESCRIPTIONS[value]}</span>
            </button>
          ))}
        </div>

        <Card>
          <CardHeader title="Temario" />
          <div className="flex flex-col gap-3 p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Select
                aria-label="Asignatura"
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setUnitId('');
                  setTopicId('');
                }}
              >
                <option value="">Todo el banco</option>
                {taxonomy.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Unidad"
                disabled={!subject}
                value={unitId}
                onChange={(e) => {
                  setUnitId(e.target.value);
                  setTopicId('');
                }}
              >
                <option value="">Todas las unidades</option>
                {subject?.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Tema" disabled={!unit} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">Todos los temas</option>
                {unit?.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dificultad">
              {DIFFICULTY_VALUES.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={difficulties.includes(level)}
                  onClick={() => setDifficulties((list) => (list.includes(level) ? list.filter((x) => x !== level) : [...list, level]))}
                  className={cn('h-7 rounded-none border px-2.5 text-xs font-medium', difficulties.includes(level) ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-muted hover:text-ink')}
                >
                  {DIFFICULTY_LABELS[level]}
                </button>
              ))}
            </div>
            <p className={cn('text-[0.8125rem]', eligible < 3 ? 'text-danger' : 'text-muted')} role="status">
              {eligible} {eligible === 1 ? 'pregunta publicada' : 'preguntas publicadas'} de tipo test con estos filtros
              {eligible < 3 ? '. Hacen falta al menos 3. Las preguntas sin publicar no cuentan.' : '.'}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reglas" />
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <Field label="Título (opcional)" className="sm:col-span-3">
              {(id) => <Input id={id} maxLength={120} placeholder={defaultTitle} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
            <Field label="Preguntas">{(id) => <Input id={id} type="number" min={3} max={50} value={count} onChange={(e) => setCount(Math.max(3, Math.min(50, Number(e.target.value) || 3)))} />}</Field>
            <Field label="Minutos por intento" hint="Lo controla la app; el plazo de entrega, GitHub.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(240, Number(e.target.value) || 1)))} />}
            </Field>
            {type === 'tournament' ? (
              <>
                <Field label="Máximo de participantes">
                  {(id) => (
                    <Select id={id} value={maxParticipants} onChange={(e) => setMaxParticipants(Number(e.target.value))}>
                      {[4, 8, 16, 32, 64].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Horas de inscripción">{(id) => <Input id={id} type="number" min={1} max={336} value={registrationHours} onChange={(e) => setRegistrationHours(Math.max(1, Math.min(336, Number(e.target.value) || 1)))} />}</Field>
                <Field label="Horas por ronda">{(id) => <Input id={id} type="number" min={1} max={336} value={roundHours} onChange={(e) => setRoundHours(Math.max(1, Math.min(336, Number(e.target.value) || 1)))} />}</Field>
              </>
            ) : (
              <Field label="Horas para entregar">{(id) => <Input id={id} type="number" min={1} max={720} value={windowHours} onChange={(e) => setWindowHours(Math.max(1, Math.min(720, Number(e.target.value) || 1)))} />}</Field>
            )}
            <Field label="Invitar (opcional)" className="sm:col-span-3" hint="Usuarios de GitHub, separados por comas. GitHub les avisa con una mención pública." error={badInvite ? `«${badInvite}» no es un usuario de GitHub válido.` : null}>
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} value={invites} placeholder="ana, luis" onChange={(e) => setInvites(e.target.value)} />}
            </Field>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button variant="primary" busy={busy} disabled={!canSubmit} icon={user ? <Send size={16} aria-hidden /> : <Plus size={16} aria-hidden />} onClick={() => void submit()}>
            Preparar competición
          </Button>
        </div>
      </div>
    </>
  );
}
