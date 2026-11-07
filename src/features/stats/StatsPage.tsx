import { useMemo, useState } from 'react';
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES } from '@core/schema/common';
import { filterQuestions } from '@core/questions/filter';
import { bankStats } from '@core/questions/stats';
import { useQuestions } from '@/features/bank/questionsRepo';
import { useLocalStats } from '@/features/study/localStats';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { ButtonLink } from '@/ui/Button';
import { BarList, ColumnChart, SplitBar, type BarDatum } from '@/ui/charts';
import { Select } from '@/ui/Field';
import { Card, CardHeader, EmptyState, PageHeader, Spinner, Stat } from '@/ui/Surface';

const dayFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

export default function StatsPage() {
  const questions = useQuestions();
  const taxonomy = useTaxonomy();
  const local = useLocalStats();
  const [subjectId, setSubjectId] = useState('');

  const scoped = useMemo(() => (questions && taxonomy ? filterQuestions(questions, { subjectId: subjectId || undefined }, taxonomy.index) : []), [questions, taxonomy, subjectId]);
  const bank = useMemo(() => (taxonomy ? bankStats(scoped, taxonomy.index) : null), [scoped, taxonomy]);

  if (!questions || !taxonomy || !local || !bank) return <Spinner />;

  const subject = taxonomy.subjects.find((s) => s.id === subjectId);
  const bySubject: BarDatum[] = taxonomy.subjects
    .map((s) => ({ key: s.id, label: s.name, value: bank.bySubject.get(s.id) ?? 0, to: `/bank?subject=${s.id}` }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const byUnit: BarDatum[] = (subject?.units ?? [])
    .map((u) => ({ key: u.id, label: u.name, value: bank.byUnit.get(u.id) ?? 0, to: `/bank?subject=${subject?.id}&unit=${u.id}` }))
    .sort((a, b) => b.value - a.value);
  const byTopic: BarDatum[] = (subject?.units ?? [])
    .flatMap((u) => u.topics.map((t) => ({ key: t.id, label: `${u.name} › ${t.name}`, value: bank.byTopic.get(t.id) ?? 0, to: `/bank?subject=${subject?.id}&topic=${t.id}` })))
    .sort((a, b) => b.value - a.value);

  const accuracyBySubject: BarDatum[] = taxonomy.subjects
    .flatMap((s) => {
      const row = local.bySubject.get(s.id);
      return row && row.mcq > 0 ? [{ key: s.id, label: s.name, value: Math.round((row.correct / row.mcq) * 100), detail: `${row.correct} de ${row.mcq}` }] : [];
    })
    .sort((a, b) => b.value - a.value);

  const activity = local.recentDays.map((d, i) => {
    const date = parseDay(d.day);
    return { key: d.day, label: dayFormat.format(date), value: d.answers, tick: i % 7 === 0 ? dayFormat.format(date) : '' };
  });

  return (
    <>
      <PageHeader title="Estadísticas" description="Tu progreso en este dispositivo y el contenido del banco." />
      <div className="flex flex-col gap-4">
        <section aria-labelledby="my-progress" className="flex flex-col gap-4">
          <h2 id="my-progress" className="text-xs font-semibold tracking-wide text-muted uppercase">
            Tu progreso <span className="font-normal normal-case">(sólo en este dispositivo)</span>
          </h2>
          {local.total === 0 ? (
            <EmptyState title="Aún no has respondido ninguna pregunta" action={<ButtonLink to="/study" variant="primary">Empezar a estudiar</ButtonLink>} />
          ) : (
            <>
              <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                <Stat label="Respuestas" value={local.total.toLocaleString('es')} />
                <Stat label="Precisión en test" value={percent(local.accuracy)} hint={`${local.mcqCorrect} de ${local.mcqTotal}`} />
                <Stat label="Racha" value={`${local.streak} ${local.streak === 1 ? 'día' : 'días'}`} hint={`Mejor: ${local.longestStreak}`} />
                <Stat label="Dominadas" value={local.mastered} hint={`de ${local.seen} vistas`} />
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <ColumnChart data={activity} title="Respuestas por día, últimos 28 días" unit="respuestas" />
                </Card>
                <Card>
                  <CardHeader title="Precisión por asignatura" description="Sólo preguntas tipo test." />
                  <div className="p-4">
                    <BarList data={accuracyBySubject} max={100} format={(v) => `${v} %`} emptyLabel="Aún no has respondido preguntas tipo test." />
                  </div>
                </Card>
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="bank-stats" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="bank-stats" className="text-xs font-semibold tracking-wide text-muted uppercase">
              Banco de preguntas
            </h2>
            <Select aria-label="Filtrar estadísticas por asignatura" className="h-8 w-auto text-[0.8125rem]" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Todas las asignaturas</option>
              {taxonomy.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          {bank.total === 0 ? (
            <EmptyState title="No hay preguntas todavía" action={<ButtonLink to="/create" variant="primary">Crear una pregunta</ButtonLink>} />
          ) : (
            <>
              <Card className="flex flex-col gap-3 p-4">
                <Stat label="Preguntas" value={bank.total.toLocaleString('es')} />
                <SplitBar
                  label="Tipos de pregunta"
                  parts={[
                    { key: 'mcq', label: 'Tipo test', value: bank.byType.mcq, className: 'bg-chart' },
                    { key: 'open', label: 'Desarrollo', value: bank.byType.open, className: 'bg-faint' },
                  ]}
                />
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Por dificultad" />
                  <div className="p-4">
                    <BarList data={DIFFICULTY_VALUES.map((level) => ({ key: String(level), label: DIFFICULTY_LABELS[level], value: bank.byDifficulty[level], to: `/bank?difficulty=${level}${subjectId ? `&subject=${subjectId}` : ''}` }))} />
                  </div>
                </Card>
                {subject ? (
                  <Card>
                    <CardHeader title="Por unidad" />
                    <div className="p-4">
                      <BarList data={byUnit} emptyLabel="Esta asignatura no tiene unidades." />
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader title="Por asignatura" />
                    <div className="p-4">
                      <BarList data={bySubject} />
                    </div>
                  </Card>
                )}
                {subject ? (
                  <Card className="lg:col-span-2">
                    <CardHeader title="Por tema" />
                    <div className="p-4">
                      <BarList data={byTopic} emptyLabel="Esta asignatura no tiene temas." />
                    </div>
                  </Card>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
