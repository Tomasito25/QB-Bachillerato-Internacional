// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { duplicateIndexEntry } from '@core/questions/normalize';
import type { Question } from '@core/schema/question';
import type { SubjectDoc } from '@core/schema/taxonomy';
import { sha256Hex } from '@core/util/encoding';
import { isAccepted, needsReview, validateContribution, type Actor, type ContributionInput, type DataView, type ProposedImage } from '@core/validation/contribution';
import { sniffImage } from '@core/validation/images';
import { makeMcq, makeOpen, makeSubject, SUBJECT_ID, TOPIC_ID, uuid } from '../fixtures';

const NOW = Date.UTC(2026, 10, 5, 12);
const ANA: Actor = { login: 'ana', id: 1, isMaintainer: false };
const LUIS: Actor = { login: 'luis', id: 2, isMaintainer: false };
const MOD: Actor = { login: 'mod', id: 3, isMaintainer: true };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function view(options: { questions?: Question[]; subjects?: SubjectDoc[]; images?: string[]; retired?: string[] } = {}): DataView {
  const questions = new Map((options.questions ?? []).map((q) => [q.id, q]));
  const subjects = new Map((options.subjects ?? [makeSubject()]).map((s) => [s.id, s]));
  return {
    question: (id) => questions.get(id) ?? null,
    subject: (id) => subjects.get(id) ?? null,
    subjects: () => [...subjects.values()],
    duplicateEntries: () => [...questions.values()].map(duplicateIndexEntry),
    imageExists: (hash, ext) => options.images?.includes(`${hash}.${ext}`) ?? false,
    isRetired: (id) => options.retired?.includes(id) ?? false,
  };
}

function input(overrides: Partial<ContributionInput>): ContributionInput {
  return { actor: ANA, questions: [], subjects: [], images: [], now: NOW, mode: 'issue', ...overrides };
}

const codes = (result: { findings: { code: string }[] }) => result.findings.map((f) => f.code);

describe('aportación por issue', () => {
  it('acepta una pregunta nueva y fija autor y fechas desde el servidor', async () => {
    const question = makeMcq({ author: null, createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' });
    const result = await validateContribution(input({ questions: [question] }), view());
    expect(result.findings).toEqual([]);
    expect(isAccepted(result)).toBe(true);
    expect(needsReview(result)).toBe(false);
    expect(result.newQuestionIds).toEqual([question.id]);
    const accepted = result.questions[0];
    expect(accepted?.author).toEqual({ login: 'ana', id: 1 });
    expect(accepted?.createdAt).toBe(new Date(NOW).toISOString());
    expect(accepted?.updatedAt).toBe(new Date(NOW).toISOString());
  });

  it('el cliente no puede atribuir la pregunta a otra persona', async () => {
    const forged = makeMcq({ author: { login: 'victima', id: 99 } });
    const result = await validateContribution(input({ questions: [forged] }), view());
    expect(result.questions[0]?.author?.login).toBe('ana');
  });

  it('rechaza un documento mal formado sin afectar a los demás', async () => {
    const good = makeOpen();
    const result = await validateContribution(input({ questions: [{ foo: 'bar' }, good] }), view());
    expect(codes(result)).toContain('schema');
    expect(isAccepted(result)).toBe(false);
    expect(result.questions.map((q) => q.id)).toEqual([good.id]);
  });

  it('rechaza campos inventados como puntos o nivel', async () => {
    const result = await validateContribution(input({ questions: [{ ...makeMcq(), points: 9999 }] }), view());
    expect(codes(result)).toContain('schema');
  });

  it('rechaza documentos de una versión futura', async () => {
    const result = await validateContribution(input({ questions: [{ ...makeMcq(), schemaVersion: 99 }] }), view());
    expect(codes(result)).toContain('future-schema');
  });

  it('rechaza una copia exacta', async () => {
    const existing = makeMcq();
    const copy = makeMcq();
    const result = await validateContribution(input({ questions: [copy] }), view({ questions: [existing] }));
    expect(codes(result)).toContain('duplicate');
    expect(result.questions).toEqual([]);
  });

  it('rechaza dos copias dentro del mismo envío', async () => {
    const result = await validateContribution(input({ questions: [makeMcq(), makeMcq()] }), view());
    expect(codes(result)).toContain('duplicate');
    expect(result.questions).toHaveLength(1);
  });

  it('una casi copia se acepta sólo tras revisión', async () => {
    const statement = 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole';
    const existing = makeOpen({ statement });
    const near = makeOpen({ statement: `${statement} ventricular` });
    const result = await validateContribution(input({ questions: [near] }), view({ questions: [existing] }));
    expect(isAccepted(result)).toBe(true);
    expect(needsReview(result)).toBe(true);
    expect(codes(result)).toEqual(['near-duplicate']);
  });

  it('rechaza imágenes externas y HTML crudo', async () => {
    const external = await validateContribution(input({ questions: [makeMcq({ statement: '![x](https://evil.example/a.png)' })] }), view());
    expect(codes(external)).toContain('external-image');
    const html = await validateContribution(input({ questions: [makeMcq({ statement: 'Hola <img src=x onerror=alert(1)>' })] }), view());
    expect(codes(html)).toContain('raw-html');
  });

  it('exige que exista el tema y que pertenezca a la asignatura', async () => {
    const missing = await validateContribution(input({ questions: [makeMcq({ topicIds: [uuid(555)] })] }), view());
    expect(codes(missing)).toContain('taxonomy-missing');
    const wrongSubject = await validateContribution(input({ questions: [makeMcq({ subjectId: uuid(556) })] }), view());
    expect(codes(wrongSubject)).toContain('taxonomy-missing');
  });

  it('no deja republicar una pregunta retirada', async () => {
    const question = makeMcq();
    const result = await validateContribution(input({ questions: [question] }), view({ retired: [question.id] }));
    expect(codes(result)).toContain('retired');
  });

  it('una nueva debe tener revisión 1', async () => {
    const result = await validateContribution(input({ questions: [makeMcq({ rev: 5 })] }), view());
    expect(codes(result)).toContain('rev-conflict');
  });
});

describe('ediciones', () => {
  const base = makeMcq({ rev: 3, author: { login: 'ana', id: 1 }, createdAt: '2026-01-01T00:00:00.000Z' });

  it('el autor edita con la revisión siguiente; se conservan autor y creación', async () => {
    const edit = { ...base, rev: 4, statement: `${base.statement} Revisada.`, author: null };
    const result = await validateContribution(input({ questions: [edit] }), view({ questions: [base] }));
    expect(result.findings).toEqual([]);
    expect(result.newQuestionIds).toEqual([]);
    expect(result.questions[0]?.author?.login).toBe('ana');
    expect(result.questions[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('una base obsoleta es un conflicto, no una sobrescritura', async () => {
    const stale = { ...base, rev: 3, statement: 'Otra versión de la pregunta anterior' };
    const result = await validateContribution(input({ questions: [stale] }), view({ questions: [base] }));
    expect(codes(result)).toContain('rev-conflict');
    expect(result.questions).toEqual([]);
  });

  it('editar la pregunta de otra persona requiere revisión', async () => {
    const edit = { ...base, rev: 4, statement: 'Corrección propuesta a la pregunta de otra persona' };
    const result = await validateContribution(input({ actor: LUIS, questions: [edit] }), view({ questions: [base] }));
    expect(isAccepted(result)).toBe(true);
    expect(codes(result)).toEqual(['foreign-edit']);
    // Aunque la edite otro, el autor sigue siendo quien la creó.
    expect(result.questions[0]?.author?.login).toBe('ana');
  });

  it('un mantenedor edita sin revisión', async () => {
    const edit = { ...base, rev: 4, statement: 'Corrección de un mantenedor' };
    const result = await validateContribution(input({ actor: MOD, questions: [edit] }), view({ questions: [base] }));
    expect(result.findings).toEqual([]);
  });
});

describe('aportación por pull request', () => {
  it('acepta si autor y fechas cuadran', async () => {
    const result = await validateContribution(input({ mode: 'pr', questions: [makeMcq()] }), view());
    expect(result.findings).toEqual([]);
  });

  it('rechaza si declara otro autor: aquí no se reescribe el fichero', async () => {
    const result = await validateContribution(input({ mode: 'pr', actor: LUIS, questions: [makeMcq()] }), view());
    expect(codes(result)).toContain('author-mismatch');
  });

  it('rechaza fechas futuras', async () => {
    const q = makeMcq({ updatedAt: '2099-01-01T00:00:00.000Z' });
    expect(codes(await validateContribution(input({ mode: 'pr', questions: [q] }), view()))).toContain('bad-dates');
  });

  it('no deja cambiar la fecha de creación al editar', async () => {
    const base = makeMcq();
    const edit = { ...base, rev: 2, statement: 'Pregunta editada', createdAt: '2020-01-01T00:00:00.000Z' };
    expect(codes(await validateContribution(input({ mode: 'pr', questions: [edit] }), view({ questions: [base] })))).toContain('bad-dates');
  });

  it('no deja borrar nodos del temario enviando el fichero sin ellos', async () => {
    const stripped = makeSubject({ units: [] });
    const result = await validateContribution(input({ mode: 'pr', subjects: [stripped] }), view());
    expect(codes(result)).toContain('taxonomy-removal');
  });
});

describe('temario', () => {
  it('añadir un tema a la asignatura de otra persona no requiere revisión', async () => {
    const proposal = makeSubject({ units: [{ id: makeSubject().units[0]!.id, name: 'Sistema locomotor', order: 0, topics: [{ id: TOPIC_ID, name: 'Huesos', order: 0 }, { id: uuid(300), name: 'Músculos', order: 1 }] }] });
    const result = await validateContribution(input({ actor: LUIS, subjects: [proposal] }), view());
    expect(result.findings).toEqual([]);
    expect(result.subjects[0]?.units[0]?.topics).toHaveLength(2);
    // Sigue siendo de quien la creó.
    expect(result.subjects[0]?.createdBy?.login).toBe('ana');
  });

  it('renombrar la asignatura de otra persona requiere revisión', async () => {
    const result = await validateContribution(input({ actor: LUIS, subjects: [makeSubject({ name: 'Anatomía humana' })] }), view());
    expect(codes(result)).toEqual(['taxonomy-edit']);
  });

  it('la dueña renombra sin revisión', async () => {
    const result = await validateContribution(input({ subjects: [makeSubject({ name: 'Anatomía humana' })] }), view());
    expect(result.findings).toEqual([]);
  });

  it('una asignatura con el mismo nombre se funde con la existente y reescribe las preguntas', async () => {
    const otherSubject = uuid(400);
    const otherUnit = uuid(401);
    const otherTopic = uuid(402);
    const proposal = makeSubject({
      id: otherSubject,
      name: 'ANATOMÍA',
      createdBy: null,
      units: [{ id: otherUnit, name: 'sistema LOCOMOTOR', order: 0, topics: [{ id: otherTopic, name: 'huesos', order: 0 }] }],
    });
    const question = makeMcq({ subjectId: otherSubject, topicIds: [otherTopic], author: null });
    const result = await validateContribution(input({ actor: LUIS, subjects: [proposal], questions: [question] }), view());
    expect(isAccepted(result)).toBe(true);
    expect(result.subjects.map((s) => s.id)).toEqual([SUBJECT_ID]);
    expect(result.questions[0]?.subjectId).toBe(SUBJECT_ID);
    expect(result.questions[0]?.topicIds).toEqual([TOPIC_ID]);
  });

  it('una asignatura nueva queda a nombre de quien la envía', async () => {
    const doc = makeSubject({ id: uuid(410), name: 'Bioquímica', createdBy: { login: 'victima', id: 99 }, units: [] });
    const result = await validateContribution(input({ subjects: [doc] }), view());
    expect(result.subjects[0]?.createdBy?.login).toBe('ana');
  });

  it('limita cuánto temario se puede crear de una vez', async () => {
    const units = Array.from({ length: 70 }, (_, i) => ({ id: uuid(1000 + i), name: `Unidad ${i}`, order: i, topics: [] }));
    const result = await validateContribution(input({ subjects: [makeSubject({ id: uuid(420), name: 'Enorme', units })] }), view());
    expect(codes(result)).toContain('taxonomy-too-big');
  });
});

describe('imágenes', () => {
  async function image(bytes: Uint8Array, ext: ProposedImage['ext'] = 'png'): Promise<ProposedImage> {
    return { hash: await sha256Hex(bytes), ext, bytes };
  }

  function withImage(hash: string, ext: 'png' | 'webp' | 'jpg' = 'png') {
    return makeMcq({ statement: `Mira ![x](qbimg:${hash}) atentamente`, images: [{ hash, ext, width: 10, height: 10, bytes: 11, alt: '' }] });
  }

  it('acepta una imagen correcta y la devuelve para escribirla', async () => {
    const img = await image(PNG);
    const result = await validateContribution(input({ questions: [withImage(img.hash)], images: [img] }), view());
    expect(result.findings).toEqual([]);
    expect(result.images.map((i) => i.hash)).toEqual([img.hash]);
  });

  it('acepta una imagen que ya está en el repositorio', async () => {
    const img = await image(PNG);
    const result = await validateContribution(input({ questions: [withImage(img.hash)] }), view({ images: [`${img.hash}.png`] }));
    expect(result.findings).toEqual([]);
  });

  it('rechaza una imagen que no llega', async () => {
    const result = await validateContribution(input({ questions: [withImage('d'.repeat(64))] }), view());
    expect(codes(result)).toContain('image-missing');
  });

  it('rechaza un fichero disfrazado: un SVG con extensión .png', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const img = await image(svg);
    expect(codes(await validateContribution(input({ questions: [withImage(img.hash)], images: [img] }), view()))).toContain('image-invalid');
  });

  it('rechaza un formato que no es el que dice', async () => {
    const img = await image(PNG, 'webp');
    expect(codes(await validateContribution(input({ images: [img] }), view()))).toContain('image-invalid');
  });

  it('rechaza un contenido que no coincide con su hash', async () => {
    const img = { hash: 'e'.repeat(64), ext: 'png' as const, bytes: PNG };
    expect(codes(await validateContribution(input({ images: [img] }), view()))).toContain('image-invalid');
  });

  it('rechaza una imagen demasiado grande', async () => {
    const big = new Uint8Array(600 * 1024);
    big.set(PNG);
    expect(codes(await validateContribution(input({ images: [await image(big)] }), view()))).toContain('image-invalid');
  });

  it('descarta imágenes que ninguna pregunta usa: el repositorio no es un almacén libre', async () => {
    const img = await image(PNG);
    const result = await validateContribution(input({ questions: [makeMcq()], images: [img] }), view());
    expect(result.images).toEqual([]);
  });

  it('reconoce los formatos por su firma', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(new TextEncoder().encode('RIFF1234WEBPVP8 '))).toBe('webp');
    expect(sniffImage(new TextEncoder().encode('<svg'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
