import { useMemo, useState } from 'react';
import { detectFormat, EXAM_FORMATS } from '@core/exams/papers';
import { useTaxonomy } from '@/features/taxonomy/taxonomyRepo';
import { db } from '@/infra/db/db';
import type { ExamRow } from '@/infra/db/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Checkbox, Field, Input, Segmented, Select } from '@/ui/Field';

type Scope = 'all' | 'some';

export function ExamDialog({ exam, today, onClose }: { exam: ExamRow | null; today: string; onClose: () => void }) {
  const taxonomy = useTaxonomy();
  const [kind, setKind] = useState<ExamRow['kind']>(exam?.kind ?? 'mock');
  const [title, setTitle] = useState(exam?.title ?? '');
  const [date, setDate] = useState(exam?.date ?? '');
  const [subjectId, setSubjectId] = useState(exam?.subjectId ?? '');
  const [paperId, setPaperId] = useState(exam?.paperId ?? '');
  const [scope, setScope] = useState<Scope>(exam && exam.topicIds.length > 0 ? 'some' : 'all');
  const [topicIds, setTopicIds] = useState<string[]>(exam?.topicIds ?? []);

  const subjects = useMemo(() => taxonomy?.subjects.filter((s) => s.units.some((u) => u.topics.length > 0)) ?? [], [taxonomy]);
  const subject = subjects.find((s) => s.id === subjectId);
  const detected = subject ? detectFormat(subject.name) : null;
  const formats = detected ? [detected, ...EXAM_FORMATS.filter((f) => f.id !== detected.id)] : EXAM_FORMATS;

  const toggle = (ids: readonly string[], on: boolean) => {
    setTopicIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return [...next];
    });
  };

  const fallback = `${kind === 'mock' ? 'Mock' : 'Examen final'}${subject ? ` de ${subject.name}` : ''}`;
  const ready = subjectId !== '' && date !== '' && (scope === 'all' || topicIds.length > 0);

  const save = async () => {
    const now = Date.now();
    await db.exams.put({ id: exam?.id ?? crypto.randomUUID(), kind, title: title.trim() || fallback, date, subjectId, paperId: paperId || null, topicIds: scope === 'all' ? [] : topicIds, createdAt: exam?.createdAt ?? now, updatedAt: now });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={exam ? 'Editar examen' : 'Añadir examen'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented label="Tipo" value={kind} options={[{ value: 'mock', label: 'Mock' }, { value: 'final', label: 'Examen final' }]} onChange={setKind} />
        <Field label="Asignatura">
          {(id) => (
            <Select
              id={id}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTopicIds([]);
                setPaperId('');
              }}
            >
              <option value="">Elige una</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha">{(id) => <Input id={id} type="date" min={exam ? undefined : today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Nombre" hint="Opcional.">{(id) => <Input id={id} placeholder={fallback} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        </div>
        <Field label="Prueba" hint="Si la eliges, el calendario ensayará antes con un simulacro de esa duración.">
          {(id) => (
            <Select id={id} value={paperId} onChange={(e) => setPaperId(e.target.value)}>
              <option value="">Sin formato oficial</option>
              {formats.map((format) => (
                <optgroup key={format.id} label={format.name}>
                  {format.papers.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {format.name} · {paper.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        {subject ? (
          <div className="flex flex-col gap-2">
            <Segmented label="Qué entra" value={scope} options={[{ value: 'all', label: 'Todo' }, { value: 'some', label: 'Sólo unos temas' }]} onChange={setScope} />
            {scope === 'some'
              ? subject.units
                  .filter((unit) => unit.topics.length > 0)
                  .map((unit) => {
                    const ids = unit.topics.map((topic) => topic.id);
                    return (
                      <fieldset key={unit.id} className="border-t border-border pt-2">
                        <Checkbox checked={ids.every((id) => topicIds.includes(id))} onChange={(on) => toggle(ids, on)} label={<span className="font-bold">{unit.name}</span>} />
                        <div className="mt-1 flex flex-col gap-1 pl-6">
                          {unit.topics.map((topic) => (
                            <Checkbox key={topic.id} checked={topicIds.includes(topic.id)} onChange={(on) => toggle([topic.id], on)} label={topic.name} />
                          ))}
                        </div>
                      </fieldset>
                    );
                  })
              : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
