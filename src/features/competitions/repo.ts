import { useLiveQuery } from 'dexie-react-hooks';
import type { DerivedCompetition } from '@core/schema/derived';
import { questionsFor } from '@core/competitions/competitions';
import { newNonce } from '@/features/account/identity';
import { startSession } from '@/features/study/sessions';
import { enqueue } from '@/features/sync/outbox';
import { db } from '@/infra/db/db';
import type { OutboxRow, SessionRow } from '@/infra/db/types';

export function useCompetitions(): DerivedCompetition[] | undefined {
  return useLiveQuery(() => db.dCompetitions.toArray(), []);
}

export function useCompetition(id: string | undefined): DerivedCompetition | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.dCompetitions.get(id)) ?? null) : null), [id]);
}

export async function findByCode(code: string): Promise<DerivedCompetition | undefined> {
  return db.dCompetitions.where('code').equals(code).first();
}

export const PHASE_LABELS = {
  upcoming: 'Próximamente',
  registration: 'Inscripción abierta',
  open: 'En juego',
  closed: 'Terminada',
} as const;

/** La ronda que está abierta ahora mismo en un torneo. */
export function currentRound(competition: DerivedCompetition, now: number): number | undefined {
  return competition.rounds?.find((round) => now >= Date.parse(round.opensAt) && now <= Date.parse(round.closesAt))?.index;
}

export function hasEntered(competition: DerivedCompetition, login: string | undefined): boolean {
  return login !== undefined && competition.participants.includes(login);
}

/** Lleva preguntas descargadas: se puede jugar sin conexión, y entregar al volver. */
export async function startCompetitionAttempt(competition: DerivedCompetition, round?: number): Promise<string> {
  const ids = [...questionsFor(competition, round)];
  const available = await db.cQuestions.bulkGet(ids);
  const missing = available.filter((q) => !q).length;
  if (missing > 0) throw new Error(`Faltan ${missing} preguntas en este dispositivo. Sincroniza y vuelve a intentarlo.`);
  const existing = await db.sessions.where('competitionId').equals(competition.id).filter((s) => (s.competitionRound ?? undefined) === round).first();
  if (existing) return existing.id;
  return startSession({ mode: 'competition', title: competition.title, config: { count: ids.length }, questionIds: ids, timeLimitSec: competition.durationSec, competitionId: competition.id, competitionRound: round });
}

export async function joinTournament(competition: DerivedCompetition): Promise<OutboxRow> {
  return enqueue({ v: 1, kind: 'competition-join', nonce: newNonce(), competitionId: competition.id }, `Me inscribo en «${competition.title}».`, {});
}

/** La entrega dice sólo qué se marcó y cuánto se tardó. Corrige Actions. */
export async function submitEntry(session: SessionRow): Promise<OutboxRow> {
  if (!session.competitionId) throw new Error('Esta sesión no es de una competición.');
  const answers = session.questionIds.map((q) => {
    const answer = session.answers[q];
    return { q, sel: answer?.selected ?? [], ms: Math.round(answer?.durationMs ?? 0) };
  });
  const durationMs = Math.max(0, (session.finishedAt ?? Date.now()) - session.startedAt);
  const limit = (session.timeLimitSec ?? 0) * 1000;
  return enqueue(
    {
      v: 1,
      kind: 'competition-entry',
      nonce: newNonce(),
      competitionId: session.competitionId,
      ...(session.competitionRound !== null ? { round: session.competitionRound } : {}),
      durationMs: limit > 0 ? Math.min(durationMs, limit) : durationMs,
      answers,
    },
    `Entrego mis respuestas de «${session.title}».`,
    { sessionId: session.id },
  );
}

export function useMyEntryStatus(sessionId: string | undefined): OutboxRow | undefined {
  return useLiveQuery(async () => (sessionId ? (await db.outbox.toArray()).find((row) => row.related.sessionId === sessionId) : undefined), [sessionId]);
}
