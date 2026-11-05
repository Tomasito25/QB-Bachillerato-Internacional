import { CalendarDays, Plus, Swords, Timer, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { competitionPhase, normalizeCode } from '@core/competitions/competitions';
import type { CompetitionType } from '@core/schema/competition';
import type { DerivedCompetition } from '@core/schema/derived';
import { identity } from '@/features/account/identity';
import { ButtonLink, Button } from '@/ui/Button';
import { Input } from '@/ui/Field';
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { toast } from '@/ui/toast';
import { findByCode, hasEntered, PHASE_LABELS, useCompetitions } from './repo';

const TYPE_ICONS: Record<CompetitionType, typeof Swords> = { duel: Swords, group: Users, tournament: Trophy, daily: CalendarDays, weekly: CalendarDays };
const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

export function CompetitionRow({ competition, now }: { competition: DerivedCompetition; now: number }) {
  const login = identity.use()?.login;
  const phase = competitionPhase(competition, now);
  const Icon = TYPE_ICONS[competition.type];
  return (
    <li>
      <Link to={`/competitions/${competition.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-subtle/60">
        <Icon size={15} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{competition.title}</span>
        <span className="text-xs text-muted tabular-nums">{competition.participants.length} {competition.participants.length === 1 ? 'participante' : 'participantes'}</span>
        <span className="hidden text-xs text-muted sm:inline">{phase === 'closed' ? `Cerró ${dateFormat.format(new Date(competition.closesAt))}` : `Hasta ${dateFormat.format(new Date(competition.closesAt))}`}</span>
        {hasEntered(competition, login) ? <Badge tone="success">Participas</Badge> : null}
        <Badge tone={phase === 'closed' ? 'neutral' : 'accent'}>{PHASE_LABELS[phase]}</Badge>
      </Link>
    </li>
  );
}

function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void findByCode(normalizeCode(code)).then((competition) => {
          if (competition) navigate(`/competitions/${competition.id}`);
          else toast.error('No se encuentra ese código. Si la competición es muy reciente, sincroniza dentro de unos minutos.');
        });
      }}
    >
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="QB-A1B2C3" aria-label="Código de competición" className="w-40 font-mono uppercase" />
      <Button type="submit" disabled={!code.trim()}>
        Unirme
      </Button>
    </form>
  );
}

export default function CompetitionsPage() {
  const competitions = useCompetitions();
  if (!competitions) return <Spinner />;
  const now = Date.now();
  const challenges = competitions.filter((c) => (c.type === 'daily' || c.type === 'weekly') && competitionPhase(c, now) !== 'closed');
  const active = competitions.filter((c) => c.type !== 'daily' && c.type !== 'weekly' && competitionPhase(c, now) !== 'closed').sort((a, b) => a.closesAt.localeCompare(b.closesAt));
  const finished = competitions.filter((c) => competitionPhase(c, now) === 'closed').sort((a, b) => b.closesAt.localeCompare(a.closesAt)).slice(0, 20);

  return (
    <>
      <PageHeader
        title="Competiciones"
        description="Asíncronas: cada persona juega cuando puede, dentro del plazo."
        actions={
          <ButtonLink to="/competitions/new" variant="primary" icon={<Plus size={16} aria-hidden />}>
            Crear
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-4">
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">¿Tienes un código?</p>
            <p className="text-[13px] text-muted">Te lo pasa quien te invita.</p>
          </div>
          <JoinByCode />
        </Card>

        {competitions.length === 0 ? (
          <EmptyState icon={<Swords size={28} aria-hidden />} title="Todavía no hay competiciones" action={<ButtonLink to="/competitions/new" variant="primary">Crear la primera</ButtonLink>}>
            Los retos diarios y semanales aparecen solos en cuanto el banco comunitario tiene preguntas suficientes.
          </EmptyState>
        ) : null}

        {challenges.length > 0 ? (
          <Card>
            <CardHeader title="Retos" description="Los mismos para todo el mundo." />
            <ul className="divide-y divide-border">
              {challenges.map((competition) => (
                <CompetitionRow key={competition.id} competition={competition} now={now} />
              ))}
            </ul>
          </Card>
        ) : null}
        {active.length > 0 ? (
          <Card>
            <CardHeader title="En curso" />
            <ul className="divide-y divide-border">
              {active.map((competition) => (
                <CompetitionRow key={competition.id} competition={competition} now={now} />
              ))}
            </ul>
          </Card>
        ) : null}
        {finished.length > 0 ? (
          <Card>
            <CardHeader title="Terminadas" />
            <ul className="divide-y divide-border">
              {finished.map((competition) => (
                <CompetitionRow key={competition.id} competition={competition} now={now} />
              ))}
            </ul>
          </Card>
        ) : null}

        <Notice tone="neutral" title="¿Por qué no en tiempo real?">
          <span className="inline-flex items-start gap-1.5">
            <Timer size={13} className="mt-0.5 shrink-0" aria-hidden />
            Sin un servidor propio no hay conexiones en directo. A cambio, nadie tiene que coincidir: GitHub certifica quién entrega y cuándo, y Actions corrige. La clasificación se actualiza en unos minutos.
          </span>
        </Notice>
      </div>
    </>
  );
}
