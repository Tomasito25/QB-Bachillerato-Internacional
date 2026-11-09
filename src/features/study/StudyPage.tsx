import { Flag, History, Play, Star, Target, XCircle } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { scopePredicate } from '@core/questions/filter';
import { NextExam } from '@/features/calendar/NextExam';
import { useQuestions } from '@/features/bank/questionsRepo';
import { SyllabusTree } from '@/features/stats/SyllabusTree';
import { preferences } from '@/features/settings/preferences';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { SessionRow } from '@/infra/db/types';
import { Band } from '@/ui/Band';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader, EmptyState, Notice, PageHeader, Spinner } from '@/ui/Surface';
import { timeAgo } from '@/ui/time';
import { useLaunchSession } from './launch';
import { useLocalStats } from './localStats';
import { ScopeCard } from './ScopeCard';
import { SessionBuilder } from './SessionBuilder';
import { MODE_LABELS, useActiveSessions } from './sessions';
import { useSyllabusProgress } from './syllabusProgress';

function ReviewRow({ icon, label, count, onClick }: { icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" disabled={count === 0} onClick={onClick} className="flex min-h-11 w-full items-center gap-2.5 py-2 text-left text-[0.9375rem] font-medium transition-colors hover:text-accent-text disabled:cursor-not-allowed disabled:text-muted">
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="qb-display text-[1.25rem] tabular-nums">{count}</span>
    </button>
  );
}

interface RecentSession {
  session: SessionRow;
  right: number;
  graded: number;
}

function useRecentSessions(): RecentSession[] | undefined {
  return useLiveQuery(async () => {
    const sessions = (await db.sessions.where('state').equals('finished').reverse().sortBy('startedAt')).slice(0, 5);
    const attempts = await db.attempts.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray();
    return sessions.map((session) => {
      const own = attempts.filter((a) => a.sessionId === session.id);
      return { session, right: own.filter((a) => a.correct === true || a.selfGrade === 2).length, graded: own.length };
    });
  }, []);
}

function RecentSessions() {
  const recent = useRecentSessions();
  if (!recent || recent.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Últimas sesiones" />
      <ul className="divide-y divide-border px-4">
        {recent.map(({ session, right, graded }) => (
          <li key={session.id}>
            <Link to={`/study/session/${session.id}/results`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 py-2 hover:underline">
              <span className="min-w-0 flex-1 basis-48 truncate text-[0.9375rem] font-medium">{session.title || MODE_LABELS[session.mode]}</span>
              <span className="text-[0.8125rem] text-muted">
                {MODE_LABELS[session.mode]} · {timeAgo(session.startedAt)}
              </span>
              <span className="w-14 text-right text-sm font-bold tabular-nums">
                {right} / {graded}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function StudyPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const active = useActiveSessions();
  const launch = useLaunchSession();
  const { practiceCount, studyScope } = preferences.use();
  const [params] = useSearchParams();
  const progressRows = useLiveQuery(() => db.progress.toArray(), []);
  const local = useLocalStats();
  const syllabus = useSyllabusProgress();

  const reviewCounts = useMemo(() => {
    if (!progressRows || !questions) return undefined;
    // Sólo cuenta lo que luego puede salir: si no, el botón prometería preguntas que no hay.
    const scoped = new Set(questions.filter(scopePredicate(studyScope)).map((q) => q.id));
    const rows = progressRows.filter((r) => scoped.has(r.questionId));
    const now = Date.now();
    return {
      due: rows.filter((r) => r.attempts > 0 && r.due <= now).length,
      failed: rows.filter((r) => r.lastCorrect === false).length,
      hard: rows.filter((r) => r.hard === 1).length,
      favorites: rows.filter((r) => r.favorite === 1).length,
    };
  }, [progressRows, questions, studyScope]);

  if (!questions || !taxonomy || !reviewCounts || !progressRows) return <Spinner />;

  if (questions.length === 0) {
    return (
      <>
        <PageHeader title="Estudiar" description="Lo que estudies se guarda en este dispositivo, también sin conexión." />
        <EmptyState
          icon={<Target size={28} aria-hidden />}
          title="Aún no hay preguntas para estudiar"
          action={
            <>
              <ButtonLink to="/create" variant="primary">
                Crear una pregunta
              </ButtonLink>
              <ButtonLink to="/sync">Descargar de la comunidad</ButtonLink>
            </>
          }
        >
          Crea las tuyas o descarga las que ha publicado la comunidad.
        </EmptyState>
      </>
    );
  }

  const review = (source: 'due' | 'failed' | 'hard' | 'favorites', title: string) => void launch({ mode: 'review', title, config: { count: 50, source } });
  const resume = active?.[0];
  const seen = local?.seen ?? 0;

  return (
    <>
      <Band
        className="mb-8"
        value={seen / questions.length}
        label="Preguntas vistas del banco"
        title="Estudiar"
        subtitle="Lo que estudies se guarda en este dispositivo, también sin conexión."
        detail={`${seen} de ${questions.length} preguntas vistas`}
        figure={`${Math.round((seen / questions.length) * 100)}%`}
        actions={
          resume ? (
            <ButtonLink to={`/study/session/${resume.id}`} variant="signal" icon={<Play size={16} aria-hidden />}>
              Continuar {MODE_LABELS[resume.mode].toLowerCase()}
            </ButtonLink>
          ) : reviewCounts.due > 0 ? (
            <Button variant="signal" icon={<History size={16} aria-hidden />} onClick={() => review('due', 'Toca repasar')}>
              Repasar {reviewCounts.due}
            </Button>
          ) : (
            <Button variant="signal" icon={<Play size={16} aria-hidden />} onClick={() => void launch({ mode: 'practice', title: 'Todo el banco', config: { count: practiceCount } })}>
              Practicar {practiceCount}
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-8">
        {active && active.length > 1 ? (
          <div className="flex flex-col gap-2">
            {/* La primera ya tiene su botón en la banda. */}
            {active.slice(1).map((session) => (
              <Notice
                key={session.id}
                tone="accent"
                title={`${MODE_LABELS[session.mode]} en curso${session.title ? `: ${session.title}` : ''}`}
                action={
                  <ButtonLink to={`/study/session/${session.id}`} variant="primary" size="sm" icon={<Play size={14} aria-hidden />}>
                    Continuar
                  </ButtonLink>
                }
              >
                Pregunta {session.cursor + 1} de {session.questionIds.length}
              </Notice>
            ))}
          </div>
        ) : null}

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,1fr)]">
          <SessionBuilder key={params.get('subject') ?? ''} questions={questions} taxonomy={taxonomy} progress={progressRows} initialSubject={params.get('subject') ?? undefined} />
          <aside className="flex flex-col gap-6">
            <section className="border-t-2 border-ink pt-3">
              <h2 className="qb-heading sm:text-[2.25rem]">Repaso</h2>
              <p className="mt-1 text-[0.9375rem] text-muted">Cada pregunta vuelve justo cuando empezarías a olvidarla.</p>
              <div className="mt-2 divide-y divide-border">
                <ReviewRow icon={<History size={18} aria-hidden />} label="Toca repasar" count={reviewCounts.due} onClick={() => review('due', 'Toca repasar')} />
                <ReviewRow icon={<XCircle size={18} aria-hidden />} label="Falladas" count={reviewCounts.failed} onClick={() => review('failed', 'Falladas')} />
                <ReviewRow icon={<Flag size={18} aria-hidden />} label="Difíciles para mí" count={reviewCounts.hard} onClick={() => review('hard', 'Difíciles')} />
                <ReviewRow icon={<Star size={18} aria-hidden />} label="Favoritas" count={reviewCounts.favorites} onClick={() => review('favorites', 'Favoritas')} />
              </div>
            </section>
            <NextExam />
            <ScopeCard />
          </aside>
        </div>

        {syllabus && syllabus.length > 0 ? (
          <Card>
            <CardHeader title="Por temas" description="Toca el botón de cualquier fila para practicar sólo eso." />
            <SyllabusTree tree={syllabus} />
          </Card>
        ) : null}

        <RecentSessions />
      </div>
    </>
  );
}
