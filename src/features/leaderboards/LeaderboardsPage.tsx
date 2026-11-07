import { Info, Trophy } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Leaderboard } from '@core/schema/derived';
import { identity } from '@/features/account/identity';
import { FriendsRanking } from '@/features/friends/FriendsPage';
import { Avatar } from '@/features/bank/parts';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import { ButtonLink } from '@/ui/Button';
import { Select } from '@/ui/Field';
import { Card, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { cn } from '@/ui/cn';

const BOARDS: { id: string; label: string; description: string }[] = [
  { id: 'week', label: 'Semanal', description: 'Puntos recibidos esta semana.' },
  { id: 'month', label: 'Mensual', description: 'Puntos recibidos este mes.' },
  { id: 'global', label: 'Global', description: 'Todos los puntos.' },
  { id: 'friends', label: 'Amigos', description: 'Tú y la gente que sigues, por puntos totales. La lista sólo está en este dispositivo.' },
  { id: 'subject', label: 'Por asignatura', description: 'Puntos ganados en esa asignatura.' },
  { id: 'contributors', label: 'Aportaciones', description: 'Preguntas aprobadas. Al lado, cuántas personas las han usado.' },
  { id: 'performance', label: 'Rendimiento', description: 'Precisión con corrección estadística: 950/1000 vale más que 10/10. Mínimo 30 respuestas.' },
  { id: 'competitions', label: 'Competiciones', description: 'Puntos ganados compitiendo.' },
];

function formatValue(board: Leaderboard, value: number): string {
  if (board.unit === 'wilson') return `${value.toLocaleString('es')} %`;
  if (board.unit === 'questions') return value.toLocaleString('es');
  return `${value.toLocaleString('es')} pts`;
}

function detailLabel(board: Leaderboard, detail: number | undefined): string | null {
  if (detail === undefined) return null;
  if (board.unit === 'wilson') return `${detail.toLocaleString('es')} respuestas`;
  if (board.unit === 'questions') return `usadas por ${detail}`;
  if (board.unit === 'competitions') return `${detail} ${detail === 1 ? 'competición' : 'competiciones'}`;
  return null;
}

export default function LeaderboardsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'week';
  const taxonomy = useTaxonomy();
  const [subjectId, setSubjectId] = useState('');
  const boards = useLiveQuery(() => db.dLeaderboards.toArray(), []);
  const profiles = useLiveQuery(async () => new Map((await db.dProfiles.toArray()).map((p) => [p.login, p])), []);
  const me = identity.use();

  if (!boards || !profiles || !taxonomy) return <Spinner />;

  const subjectBoards = boards.filter((b) => b.id.startsWith('subject:'));
  const effectiveSubject = subjectId || subjectBoards[0]?.id.slice('subject:'.length) || '';
  const boardId = tab === 'subject' ? `subject:${effectiveSubject}` : tab;
  const board = boards.find((b) => b.id === boardId);
  const definition = BOARDS.find((b) => b.id === tab);
  const myProfile = me ? profiles.get(me.login) : undefined;
  const myRank = myProfile?.ranks[tab];
  const inTop = board?.entries.some((e) => e.login === me?.login);

  return (
    <>
      <PageHeader title="Rankings" description="Se recalculan desde el registro público en cada despliegue. Cualquiera puede comprobarlos." />

      {/* La línea va en una sombra interior, no en un borde: un margen negativo en las pestañas desbordaría en vertical y sacaría barras de desplazamiento. */}
      <div role="tablist" aria-label="Clasificación" className="mb-3 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]">
        {BOARDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setParams({ tab: item.id }, { replace: true })}
            className={cn('border-b-2 px-2.5 py-2 text-[0.8125rem] font-medium whitespace-nowrap', tab === item.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">
          {definition?.description}
          {board?.period ? ` Periodo: ${board.period}.` : ''}
        </p>
        {tab === 'subject' && subjectBoards.length > 0 ? (
          <Select aria-label="Asignatura" className="h-8 w-auto text-[0.8125rem]" value={effectiveSubject} onChange={(e) => setSubjectId(e.target.value)}>
            {subjectBoards.map((b) => {
              const id = b.id.slice('subject:'.length);
              return (
                <option key={id} value={id}>
                  {taxonomy.index.subjects.get(id)?.name ?? id}
                </option>
              );
            })}
          </Select>
        ) : null}
      </div>

      {tab === 'friends' ? (
        <FriendsRanking />
      ) : !board || board.entries.length === 0 ? (
        <EmptyState
          icon={<Trophy size={28} aria-hidden />}
          title={boards.length === 0 ? 'Aún no hay datos de rankings' : 'Nadie ha puntuado aquí todavía'}
          action={
            <>
              <ButtonLink to="/study" variant="primary">
                Estudiar
              </ButtonLink>
              <ButtonLink to="/sync">Publicar resultados</ButtonLink>
            </>
          }
        >
          Para aparecer, conecta tu cuenta de GitHub y publica tus resultados. Estudiar sin publicar es privado y no entra aquí.
        </EmptyState>
      ) : (
        <>
          {me && !inTop && myRank ? (
            <Notice tone="accent" className="mb-3" title={`Vas en el puesto ${myRank} de ${board.total}`}>
              La lista muestra a los {board.entries.length} primeros.
            </Notice>
          ) : null}
          <Card>
            <ol>
              {board.entries.map((entry) => {
                const profile = profiles.get(entry.login);
                const detail = detailLabel(board, entry.detail);
                const isMe = entry.login === me?.login;
                return (
                  <li key={entry.login} className={cn('border-b border-border last:border-0', isMe && 'bg-accent-soft')}>
                    <Link to={`/u/${entry.login}`} className="flex items-center gap-3 px-4 py-2 hover:bg-subtle/60">
                      <span className={cn('w-7 shrink-0 text-right text-sm font-semibold tabular-nums', entry.rank > 3 && 'font-normal text-muted')}>{entry.rank}</span>
                      <Avatar user={{ id: profile?.githubId ?? 0, login: entry.login }} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {profile?.displayName ?? entry.login}
                        {/* El nombre lo elige cada cual: el login, que no se puede imitar, va siempre al lado. */}
                        {profile?.displayName ? <span className="ml-1.5 text-xs text-muted">@{entry.login}</span> : null}
                        {isMe ? <span className="ml-1.5 text-xs text-muted">(tú)</span> : null}
                      </span>
                      {detail ? <span className="hidden shrink-0 text-xs text-muted sm:inline">{detail}</span> : null}
                      <span className="shrink-0 text-sm font-medium tabular-nums">{formatValue(board, entry.value)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
        <Info size={13} className="mt-px shrink-0" aria-hidden />
        <span>
          Los puntos no se pueden escribir a mano: se deducen de respuestas que corrige GitHub Actions, con topes y sin premiar la repetición. Pero el banco es público, así que nada impide contestar con la solución delante. Es un juego de estudio entre personas, no una credencial.
        </span>
      </p>
    </>
  );
}
