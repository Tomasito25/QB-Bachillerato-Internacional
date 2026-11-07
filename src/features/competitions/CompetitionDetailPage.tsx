import { ArrowLeft, Check, Copy, Info, Play, Trophy, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitionPhase } from '@core/competitions/competitions';
import { COMPETITION_TYPE_LABELS } from '@core/schema/competition';
import { DIFFICULTY_LABELS } from '@core/schema/common';
import type { BracketMatch, DerivedCompetition } from '@core/schema/derived';
import { identity } from '@/features/account/identity';
import { formatDuration } from '@/features/study/sessions';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { Button, ButtonLink } from '@/ui/Button';
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Spinner, Stat } from '@/ui/Surface';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { currentRound, hasEntered, joinTournament, PHASE_LABELS, startCompetitionAttempt, useCompetition, useMyEntryStatus } from './repo';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

function StandingsTable({ competition, me }: { competition: DerivedCompetition; me?: string }) {
  if (competition.standings.length === 0) return <p className="p-4 text-[0.8125rem] text-muted">Aún no ha entregado nadie.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted">
          <tr>
            <th className="w-10 px-4 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Participante</th>
            <th className="px-2 py-2 text-right font-medium">Aciertos</th>
            <th className="px-4 py-2 text-right font-medium" title="Lo declara la app de cada participante. Sólo desempata.">
              Tiempo declarado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {competition.standings.map((row) => (
            <tr key={row.login} className={cn(row.login === me && 'bg-accent-soft')}>
              <td className="px-4 py-2 font-semibold tabular-nums">{row.rank}</td>
              <td className="px-2 py-2">
                <Link to={`/u/${row.login}`} className="hover:underline">
                  {row.login}
                </Link>
                {row.login === me ? <span className="ml-1.5 text-xs text-muted">(tú)</span> : null}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {row.correct} / {row.total}
              </td>
              <td className="px-4 py-2 text-right text-muted tabular-nums">{formatDuration(row.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DECIDED_BY: Record<BracketMatch['decidedBy'], string> = {
  pending: 'Por jugar',
  score: 'Por aciertos',
  time: 'Por tiempo declarado',
  submission: 'Por hora de entrega',
  walkover: 'Por incomparecencia',
  bye: 'Pasa directo',
  seed: 'Por sorteo: no se presentó nadie',
};

function MatchCard({ match, me }: { match: BracketMatch; me?: string }) {
  const side = (login: string | null, correct: number | null) => (
    <div className={cn('flex items-center justify-between gap-3 px-2.5 py-1.5 text-[0.8125rem]', match.winner === login && login !== null && 'font-semibold', login === me && 'bg-accent-soft')}>
      <span className="min-w-0 truncate">{login ?? <span className="text-muted">—</span>}</span>
      <span className="shrink-0 text-muted tabular-nums">{correct ?? ''}</span>
    </div>
  );
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {side(match.a, match.correctA)}
      <div className="border-t border-border" />
      {side(match.b, match.correctB)}
      <p className="border-t border-border bg-subtle/60 px-2.5 py-1 text-xs text-muted">{DECIDED_BY[match.decidedBy]}</p>
    </div>
  );
}

function Bracket({ competition, me }: { competition: DerivedCompetition; me?: string }) {
  if (!competition.bracket || competition.bracket.length === 0) {
    return <p className="p-4 text-[0.8125rem] text-muted">El cuadro se sortea al cerrar la inscripción. Hacen falta al menos 2 inscritos.</p>;
  }
  return (
    <div className="flex gap-4 overflow-x-auto p-4">
      {competition.bracket.map((round, i) => (
        <section key={round.index} className="flex min-w-44 flex-col gap-2" aria-label={`Ronda ${i + 1}`}>
          <h3 className="text-xs font-semibold text-muted">{i === (competition.bracket?.length ?? 0) - 1 ? 'Final' : `Ronda ${i + 1}`}</h3>
          <p className="text-xs text-muted">Hasta {dateFormat.format(new Date(round.closesAt))}</p>
          <div className="flex flex-1 flex-col justify-around gap-2">
            {round.matches.map((match, m) => (
              <MatchCard key={m} match={match} me={me} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-sm hover:bg-subtle"
      title="Copiar el código"
    >
      {code}
      {copied ? <Check size={13} className="text-success" aria-label="Copiado" /> : <Copy size={13} className="text-muted" aria-hidden />}
    </button>
  );
}

export default function CompetitionDetailPage() {
  const { id } = useParams();
  const competition = useCompetition(id);
  const taxonomy = useTaxonomy();
  const user = identity.use();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const session = useLiveQuery(async () => (id ? db.sessions.where('competitionId').equals(id).last() : undefined), [id]);
  const entry = useMyEntryStatus(session?.id);

  if (competition === undefined || !taxonomy) return <Spinner />;
  if (competition === null) {
    return (
      <EmptyState title="No se encuentra esta competición" action={<ButtonLink to="/competitions" variant="primary">Ver competiciones</ButtonLink>}>
        Si se acaba de crear, aparecerá en unos minutos: sincroniza de nuevo.
      </EmptyState>
    );
  }

  const now = Date.now();
  const phase = competitionPhase(competition, now);
  const isTournament = competition.type === 'tournament';
  const round = isTournament ? currentRound(competition, now) : undefined;
  const entered = hasEntered(competition, user?.login);
  const registered = isTournament && entered;
  // En un torneo sólo juega quien sigue vivo, y no quien pasa directo esta ronda.
  const myMatch = competition.bracket?.find((r) => r.index === round)?.matches.find((m) => m.a === user?.login || m.b === user?.login);
  const canPlay = user && phase === 'open' && (!isTournament ? !entered : registered && myMatch?.decidedBy === 'pending');
  const playedThisRound = session && (session.competitionRound ?? undefined) === round && session.state === 'finished';
  const subject = competition.filters.subjectId ? taxonomy.index.subjects.get(competition.filters.subjectId)?.name : null;
  const full = competition.maxParticipants !== null && competition.participants.length >= competition.maxParticipants;

  const play = async () => {
    setBusy(true);
    try {
      navigate(`/study/session/${await startCompetitionAttempt(competition, round)}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/competitions" className="mb-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
        <ArrowLeft size={14} aria-hidden />
        Competiciones
      </Link>
      <PageHeader
        title={competition.title}
        description={`${COMPETITION_TYPE_LABELS[competition.type]}${competition.createdBy ? ` · creada por @${competition.createdBy.login}` : ''}`}
        actions={
          <>
            <Badge tone={phase === 'closed' ? 'neutral' : 'accent'}>{PHASE_LABELS[phase]}</Badge>
            <CopyCode code={competition.code} />
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {competition.champion ? (
          <Notice tone="success" title={`Campeón: @${competition.champion}`}>
            <Trophy size={13} className="mr-1 inline" aria-hidden />
            Torneo terminado.
          </Notice>
        ) : null}

        {!user && phase !== 'closed' ? (
          <Notice tone="warning" title="Para participar, conecta tu cuenta de GitHub" action={<ButtonLink to="/settings" size="sm">Conectar</ButtonLink>} />
        ) : null}

        {isTournament && phase === 'registration' && user ? (
          registered ? (
            <Notice tone="success" title="Estás inscrito">Avisa a quien quieras: el cuadro se sortea al cerrar la inscripción.</Notice>
          ) : (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm">Inscripción abierta hasta el {dateFormat.format(new Date(competition.registrationClosesAt as string))}.</p>
              <Button
                variant="primary"
                disabled={full}
                icon={<UserPlus size={16} aria-hidden />}
                onClick={() => {
                  void joinTournament(competition).then(() => {
                    toast.success('Preparada. Envíala desde Sincronización.');
                    navigate('/sync');
                  });
                }}
              >
                {full ? 'Torneo completo' : 'Inscribirme'}
              </Button>
            </Card>
          )
        ) : null}

        {canPlay && !playedThisRound ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{session?.state === 'active' ? 'Tienes un intento a medias' : isTournament ? `Te toca la ronda ${(round ?? 0) + 1}` : 'Cuando quieras'}</p>
              <p className="text-[0.8125rem] text-muted">
                {competition.questionCount} preguntas · {Math.round(competition.durationSec / 60)} minutos desde que empieces. Sólo hay un intento.
              </p>
            </div>
            <Button variant="primary" busy={busy} icon={<Play size={16} aria-hidden />} onClick={() => void play()}>
              {session?.state === 'active' ? 'Continuar' : 'Empezar'}
            </Button>
          </Card>
        ) : null}

        {isTournament && registered && phase === 'open' && round !== undefined && !myMatch ? <Notice tone="neutral" title="Has quedado fuera en esta ronda">Puedes seguir el cuadro hasta el final.</Notice> : null}
        {isTournament && myMatch?.decidedBy === 'bye' ? <Notice tone="success" title="Pasas directo esta ronda">Te ha tocado exención en el sorteo.</Notice> : null}

        {session?.state === 'finished' && !entry && (isTournament || !entered) ? (
          <Notice tone="accent" title="Has terminado: falta entregar" action={<ButtonLink to={`/study/session/${session.id}/results`} size="sm" variant="primary">Entregar</ButtonLink>}>
            Sólo cuenta si llega a GitHub antes del {dateFormat.format(new Date(competition.closesAt))}.
          </Notice>
        ) : null}

        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Participantes" value={`${competition.participants.length}${competition.maxParticipants ? ` / ${competition.maxParticipants}` : ''}`} />
          <Stat label="Preguntas" value={competition.questionCount} />
          <Stat label="Por intento" value={`${Math.round(competition.durationSec / 60)} min`} />
          <Stat label="Cierra" value={<span className="text-sm">{dateFormat.format(new Date(competition.closesAt))}</span>} />
        </Card>

        <Card>
          <CardHeader title={isTournament ? 'Cuadro' : 'Clasificación'} description={isTournament ? undefined : 'Corregida por GitHub Actions. Desempata el tiempo y, después, la hora de entrega.'} />
          {isTournament ? <Bracket competition={competition} me={user?.login} /> : <StandingsTable competition={competition} me={user?.login} />}
        </Card>

        {isTournament && competition.participants.length > 0 ? (
          <Card>
            <CardHeader title="Inscritos" />
            <ul className="flex flex-wrap gap-1.5 p-4">
              {competition.participants.map((login) => (
                <li key={login}>
                  <Link to={`/u/${login}`}>
                    <Badge tone={login === user?.login ? 'accent' : 'neutral'}>{login}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info size={13} className="mt-px shrink-0" aria-hidden />
          <span>
            {subject ? `Temario: ${subject}. ` : 'Temario: todo el banco. '}
            {competition.filters.difficulties?.length ? `Dificultad: ${competition.filters.difficulties.map((d) => DIFFICULTY_LABELS[d]).join(', ')}. ` : ''}
            GitHub certifica quién entrega y cuándo; el tiempo por intento lo mide la app de cada participante, así que es declarado. Las entregas son públicas: esto es un juego entre personas, no un examen vigilado.
          </span>
        </p>
      </div>
    </>
  );
}
