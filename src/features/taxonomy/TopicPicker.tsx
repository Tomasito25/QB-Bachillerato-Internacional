import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Checkbox, Field, Input, Select } from '@/ui/Field';
import { toast } from '@/ui/toast';
import { addTopic, addUnit, createSubject, TaxonomyError, useTaxonomy } from './taxonomyRepo';

interface TopicPickerProps {
  subjectId: string;
  topicIds: string[];
  onChange: (next: { subjectId: string; topicIds: string[] }) => void;
  error?: string;
}

/** Inline, sin salir del editor: crear el tema que falta no debe costarte el borrador. */
function QuickAdd({ label, onAdd }: { label: string; onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const submit = async () => {
    if (!name.trim()) return;
    try {
      await onAdd(name);
      setName('');
    } catch (error) {
      toast.error(error instanceof TaxonomyError ? error.message : 'No se ha podido crear.');
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={label}
        aria-label={label}
        className="h-8 text-[13px]"
      />
      <Button size="sm" onClick={() => void submit()} disabled={!name.trim()} icon={<Plus size={14} aria-hidden />}>
        Añadir
      </Button>
    </div>
  );
}

export function TopicPicker({ subjectId, topicIds, onChange, error }: TopicPickerProps) {
  const taxonomy = useTaxonomy();
  if (!taxonomy) return null;
  const subject = taxonomy.subjects.find((s) => s.id === subjectId);

  const toggle = (topicId: string, checked: boolean) => {
    onChange({ subjectId, topicIds: checked ? [...topicIds, topicId] : topicIds.filter((id) => id !== topicId) });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Asignatura" error={!subjectId ? error : undefined}>
        {(id, describedBy) => (
          <Select id={id} aria-describedby={describedBy} value={subjectId} onChange={(e) => onChange({ subjectId: e.target.value, topicIds: [] })}>
            <option value="">Elige una asignatura…</option>
            {taxonomy.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {!subject ? (
        <QuickAdd
          label="O crea una asignatura nueva"
          onAdd={async (name) => {
            const id = await createSubject(name);
            onChange({ subjectId: id, topicIds: [] });
          }}
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-[13px] font-medium">
            Temas <span className="font-normal text-muted">(puedes marcar varios)</span>
          </p>
          {subject.units.length === 0 ? <p className="text-[13px] text-muted">Esta asignatura aún no tiene unidades. Crea la primera:</p> : null}
          {subject.units.map((unit) => (
            <fieldset key={unit.id} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-medium text-muted">{unit.name}</legend>
              {unit.topics.map((topic) => (
                <Checkbox key={topic.id} checked={topicIds.includes(topic.id)} onChange={(checked) => toggle(topic.id, checked)} label={topic.name} />
              ))}
              <QuickAdd
                label={`Nuevo tema en «${unit.name}»`}
                onAdd={async (name) => {
                  const id = await addTopic(subject.id, unit.id, name);
                  onChange({ subjectId, topicIds: [...topicIds, id] });
                }}
              />
            </fieldset>
          ))}
          <div className="border-t border-border pt-3">
            <QuickAdd label="Nueva unidad" onAdd={async (name) => void (await addUnit(subject.id, name))} />
          </div>
          {error ? (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted">
        Para renombrar o reordenar, usa <Link to="/subjects" className="underline underline-offset-2">Temario</Link>.
      </p>
    </div>
  );
}
