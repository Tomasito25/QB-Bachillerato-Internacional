import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFile } from '@/features/bank/importExport';
import { db } from '@/infra/db/db';

// Con jsdom, import.meta.url no es un file://: se lee desde la raíz del proyecto, donde corre Vitest.
const EXAMPLE = readFileSync(join(process.cwd(), 'docs', 'import-example.json'), 'utf8');

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('el ejemplo de docs/IMPORT.md', () => {
  it('se importa entero, con su imagen y sus apartados', async () => {
    const report = await importFile(new File([EXAMPLE], 'ejemplo.json', { type: 'application/json' }));
    expect(report).toEqual({ imported: 4, existing: 0, duplicates: 0, invalid: 0, images: 1 });
    const open = (await db.lQuestions.toArray()).find((q) => q.type === 'open');
    expect(open?.type === 'open' && open.parts?.map((p) => p.marks)).toEqual([2, 2, 1]);
    // Las fórmulas llegan con su barra invertida: en JSON va doble.
    expect((await db.lQuestions.toArray()).some((q) => q.statement.includes('\\text{m s}^{-2}'))).toBe(true);
  });

  it('una asignatura con el mismo nombre que otra ya existente recibe las preguntas', async () => {
    await importFile(new File([EXAMPLE], 'ejemplo.json'));
    const again = JSON.parse(EXAMPLE) as { subjects: { id: string; name: string }[]; questions: { id: string; subjectId: string; statement: string }[] };
    // Otros UUID y otro nombre escrito distinto: se empareja por nombre igualmente.
    const subject = again.subjects[0] as { id: string; name: string };
    const oldId = subject.id;
    subject.id = crypto.randomUUID();
    subject.name = 'fisica sl (EJEMPLO)';
    for (const q of again.questions) {
      q.id = crypto.randomUUID();
      q.statement = `${q.statement} (bis)`;
      if (q.subjectId === oldId) q.subjectId = subject.id;
    }
    const report = await importFile(new File([JSON.stringify(again)], 'otra.json'));
    expect(report.imported).toBe(4);
    expect((await db.lSubjects.toArray()).map((s) => s.name).sort()).toEqual(['Business Management (example)', 'Física SL (ejemplo)']);
  });
});
