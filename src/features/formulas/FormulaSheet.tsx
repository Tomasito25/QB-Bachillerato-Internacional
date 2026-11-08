import { useState } from 'react';
import { Markdown } from '@/infra/markdown/Markdown';
import { Segmented } from '@/ui/Field';
import { PHYSICAL_CONSTANTS, PHYSICS_FORMULAS, type Formula } from './physics';

function Row({ item }: { item: Formula }) {
  return (
    <li className="grid gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-center">
      <Markdown source={`$${item.tex}$`} className="overflow-x-auto overflow-y-hidden py-1" />
      <p className="text-[0.875rem] text-muted">{item.what}</p>
    </li>
  );
}

/** Se usa en su página y dentro de un simulacro, en un diálogo. */
export function FormulaSheet() {
  const [level, setLevel] = useState<'sl' | 'hl'>('sl');
  const visible = (item: Formula) => level === 'hl' || !item.hl;
  return (
    <div className="flex flex-col gap-8">
      <Segmented label="Nivel" value={level} options={[{ value: 'sl', label: 'SL' }, { value: 'hl', label: 'HL (incluye SL)' }]} onChange={setLevel} />
      {PHYSICS_FORMULAS.map((section) => (
        <section key={section.id}>
          <h2 className="qb-heading border-t-2 border-ink pt-3 sm:text-[2.25rem]">{section.title}</h2>
          {section.groups
            .filter((group) => group.items.some(visible))
            .map((group) => (
              <div key={group.title} className="mt-5">
                <h3 className="text-[0.9375rem] font-bold">{group.title}</h3>
                <ul className="divide-y divide-border">
                  {group.items.filter(visible).map((item) => (
                    <Row key={item.tex} item={item} />
                  ))}
                </ul>
              </div>
            ))}
        </section>
      ))}
      <section>
        <h2 className="qb-heading border-t-2 border-ink pt-3 sm:text-[2.25rem]">Constantes</h2>
        <ul className="mt-3 divide-y divide-border">
          {PHYSICAL_CONSTANTS.map((constant) => (
            <li key={constant.name} className="grid gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-center">
              <Markdown source={`$${constant.tex}$`} className="overflow-x-auto overflow-y-hidden py-1" />
              <p className="text-[0.875rem] text-muted">{constant.name}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
