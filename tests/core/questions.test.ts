import { describe, expect, it } from 'vitest';
import { gradeAnswer, isCorrectSelection, partialScore, suggestFromParts, suggestSelfGrade } from '@core/questions/grading';
import { duplicateIndexEntry, findDuplicates, jaccard, normalizeText, plainText, questionFingerprint, searchableText } from '@core/questions/normalize';
import { scopePredicate } from '@core/questions/filter';
import { gradedItems } from '@core/schema/question';
import { scanImageReferences } from '@core/questions/refs';
import { makeMcq, makeOpen } from '../fixtures';

const HASH = 'a'.repeat(64);

describe('corrección', () => {
  const single = makeMcq();
  const multi = makeMcq({
    multiple: true,
    answers: [
      { id: 'a', text: 'Uno', correct: true },
      { id: 'b', text: 'Dos', correct: true },
      { id: 'c', text: 'Tres', correct: false },
      { id: 'd', text: 'Cuatro', correct: false },
    ],
  });

  it('respuesta única', () => {
    expect(isCorrectSelection(single, ['a'])).toBe(true);
    expect(isCorrectSelection(single, ['b'])).toBe(false);
    expect(isCorrectSelection(single, [])).toBe(false);
  });

  it('respuesta múltiple: exactamente las correctas, sin importar el orden', () => {
    expect(isCorrectSelection(multi, ['b', 'a'])).toBe(true);
    expect(isCorrectSelection(multi, ['a'])).toBe(false);
    expect(isCorrectSelection(multi, ['a', 'b', 'c'])).toBe(false);
  });

  it('marcar todas las opciones no da acierto', () => {
    expect(isCorrectSelection(multi, ['a', 'b', 'c', 'd'])).toBe(false);
    expect(partialScore(multi, ['a', 'b', 'c', 'd'])).toBe(0);
  });

  it('repetir la opción correcta no suma', () => {
    expect(isCorrectSelection(single, ['a', 'a'])).toBe(true);
    expect(partialScore(multi, ['a', 'a'])).toBe(0.5);
    expect(isCorrectSelection(multi, ['a', 'a'])).toBe(false);
  });

  it('nota parcial: cada error resta un acierto', () => {
    expect(partialScore(multi, ['a', 'b'])).toBe(1);
    expect(partialScore(multi, ['a'])).toBe(0.5);
    expect(partialScore(multi, ['a', 'c'])).toBe(0);
    expect(partialScore(multi, ['c', 'd'])).toBe(0);
  });

  it('el desarrollo no tiene acierto objetivo', () => {
    expect(gradeAnswer(makeOpen(), { g: 2 })).toEqual({ correct: null, score: 1 });
    expect(gradeAnswer(makeOpen(), { g: 1 })).toEqual({ correct: null, score: 0.5 });
    expect(gradeAnswer(makeOpen(), {})).toEqual({ correct: null, score: 0 });
  });

  it('la autoevaluación sugerida pondera los criterios', () => {
    const criteria = [
      { id: 'x', weight: 3 },
      { id: 'y', weight: 1 },
    ];
    expect(suggestSelfGrade(criteria, ['x', 'y'])).toBe(2);
    expect(suggestSelfGrade(criteria, ['x'])).toBe(1);
    expect(suggestSelfGrade(criteria, ['y'])).toBe(0);
    expect(suggestSelfGrade([], [])).toBe(0);
  });

  it('con apartados, la nota sugerida pesa cada uno por sus puntos', () => {
    const parts = [{ id: 'a', marks: 4 }, { id: 'b' }];
    expect(suggestFromParts(parts, { a: 2 })).toBeNull();
    expect(suggestFromParts(parts, { a: 2, b: 0 })).toBe(1);
    expect(suggestFromParts(parts, { a: 0, b: 2 })).toBe(0);
    expect(suggestFromParts(parts, { a: 2, b: 2 })).toBe(2);
  });
});

describe('apartados y subapartados', () => {
  const parts = [
    { id: 'a', statement: 'Uno', modelAnswer: 'x', marks: 3 },
    { id: 'b', statement: '', modelAnswer: '', subparts: [{ id: 'a', statement: 'Dos zarzamora', modelAnswer: 'y', marks: 1 }, { id: 'b', statement: 'Tres', modelAnswer: 'z' }] },
  ];

  it('se valora cada subapartado, o el apartado si no tiene', () => {
    expect(gradedItems(parts)).toEqual([{ id: 'a', marks: 3 }, { id: 'b.a', marks: 1 }, { id: 'b.b', marks: undefined }]);
    // 4 de 5 puntos es 0,8: se queda en «a medias».
    expect(suggestFromParts(gradedItems(parts), { a: 2, 'b.a': 2, 'b.b': 0 })).toBe(1);
    expect(suggestFromParts(gradedItems(parts), { a: 2, 'b.a': 2, 'b.b': 2 })).toBe(2);
    expect(suggestFromParts(gradedItems(parts), { a: 2 })).toBeNull();
  });

  it('se busca también en los subapartados, y distinguen a dos preguntas', async () => {
    const question = makeOpen({ modelAnswer: '', parts });
    expect(searchableText(question)).toContain('zarzamora');
    const other = makeOpen({ modelAnswer: '', parts: [parts[0] as (typeof parts)[0], { ...(parts[1] as (typeof parts)[1]), subparts: [{ id: 'a', statement: 'Otra cosa', modelAnswer: 'y' }] }] });
    expect(await questionFingerprint(question)).not.toBe(await questionFingerprint(other));
  });
});

describe('temario de estudio', () => {
  const question = (...topicIds: string[]) => ({ topicIds });

  it('«sólo» deja pasar lo que toque un tema marcado', () => {
    const inScope = scopePredicate({ mode: 'only', topicIds: ['a', 'b'] });
    expect(inScope(question('a'))).toBe(true);
    expect(inScope(question('c', 'b'))).toBe(true);
    expect(inScope(question('c'))).toBe(false);
  });

  it('«bloquear» saca todo lo que toque un tema marcado, aunque tenga otros', () => {
    const inScope = scopePredicate({ mode: 'block', topicIds: ['a'] });
    expect(inScope(question('a'))).toBe(false);
    expect(inScope(question('c', 'a'))).toBe(false);
    expect(inScope(question('c'))).toBe(true);
  });

  it('sin nada marcado no filtra: no se queda nadie sin preguntas por un descuido', () => {
    expect(scopePredicate({ mode: 'only', topicIds: [] })(question('a'))).toBe(true);
    expect(scopePredicate({ mode: 'block', topicIds: [] })(question('a'))).toBe(true);
    expect(scopePredicate({ mode: 'all', topicIds: ['a'] })(question('b'))).toBe(true);
  });
});

describe('normalización', () => {
  it('ignora mayúsculas, acentos y puntuación', () => {
    expect(normalizeText('¿Cuál es el FÉMUR?')).toBe('cual es el femur');
  });

  it('quita marcas de Markdown y conserva el texto de los enlaces', () => {
    expect(plainText('**negrita** y [enlace](https://x.org) ![img](qbimg:abc)')).toBe('negrita y enlace');
  });

  it('la huella no depende del orden de las opciones ni de la tipografía', async () => {
    const a = makeMcq();
    const b = makeMcq({ statement: '¿CUÁL es el hueso más largo del cuerpo humano adulto', answers: [...makeMcq().answers].reverse() });
    expect(await questionFingerprint(a)).toBe(await questionFingerprint(b));
  });

  it('la huella cambia si cambian las opciones', async () => {
    const other = makeMcq({ answers: makeMcq().answers.map((x, i) => (i === 0 ? { ...x, text: 'Radio' } : x)) });
    expect(await questionFingerprint(makeMcq())).not.toBe(await questionFingerprint(other));
  });

  it('jaccard en los extremos', () => {
    expect(jaccard(new Set(['a']), new Set(['a']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('busca también en las opciones y etiquetas, no en la explicación', () => {
    const text = searchableText(makeMcq({ tags: ['Traumatología'], explanation: 'Palabra exclusiva: zarzamora' }));
    expect(text).toContain('femur');
    expect(text).toContain('traumatologia');
    expect(text).not.toContain('zarzamora');
    expect(searchableText(makeOpen())).toContain('sistole');
  });
});

describe('duplicados', () => {
  const base = makeOpen({ statement: 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole' });

  it('detecta una copia exacta aunque cambie la tipografía', () => {
    const copy = makeOpen({ statement: 'EXPLICA detalladamente, las fases del ciclo cardiaco y que ocurre en cada una de ellas durante la sistole.' });
    const [match] = findDuplicates(copy, [duplicateIndexEntry(base)]);
    expect(match?.exact).toBe(true);
  });

  it('detecta una casi copia', () => {
    const near = makeOpen({ statement: 'Explica detalladamente las fases del ciclo cardíaco y qué ocurre en cada una de ellas durante la sístole ventricular' });
    const [match] = findDuplicates(near, [duplicateIndexEntry(base)]);
    expect(match?.exact).toBe(false);
    expect(match?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('no confunde preguntas cortas parecidas', () => {
    const a = makeOpen({ statement: '¿Qué es la mitosis?' });
    const b = makeOpen({ statement: '¿Qué es la meiosis?' });
    expect(findDuplicates(a, [duplicateIndexEntry(b)])).toEqual([]);
  });

  it('no confunde preguntas distintas', () => {
    const other = makeOpen({ statement: 'Enumera los huesos que forman el cráneo humano y describe brevemente su localización anatómica' });
    expect(findDuplicates(other, [duplicateIndexEntry(base)])).toEqual([]);
  });

  it('no se detecta a sí misma', () => {
    expect(findDuplicates(base, [duplicateIndexEntry(base)])).toEqual([]);
  });
});

describe('referencias a imágenes', () => {
  it('reconoce las internas', () => {
    const report = scanImageReferences(makeMcq({ statement: `Mira ![figura](qbimg:${HASH})` }));
    expect([...report.hashes]).toEqual([HASH]);
    expect(report.external).toEqual([]);
  });

  it('señala las externas, incluidas las de opciones y explicación', () => {
    const q = makeMcq({ explanation: '![x](https://evil.example/pixel.gif)' });
    q.answers[0] = { id: 'a', text: '![y](http://evil.example/2.png)', correct: true };
    expect(scanImageReferences(q).external).toEqual(['https://evil.example/pixel.gif', 'http://evil.example/2.png']);
  });

  it('señala las de datos incrustados', () => {
    expect(scanImageReferences(makeMcq({ statement: '![x](data:image/png;base64,AAA)' })).external).toHaveLength(1);
  });

  it('señala las de HTML crudo', () => {
    expect(scanImageReferences(makeMcq({ statement: '<img src=x onerror=alert(1)>' })).rawHtml).toBe(true);
  });

  it('un hash con otra longitud no cuenta como interna', () => {
    expect(scanImageReferences(makeMcq({ statement: '![x](qbimg:abc)' })).external).toEqual(['qbimg:abc']);
  });

  it('revisa el desarrollo: respuesta modelo y criterios', () => {
    const q = makeOpen({ modelAnswer: `![a](qbimg:${HASH})`, criteria: [{ id: 'c', text: '![b](https://x.org/b.png)', weight: 1 }] });
    const report = scanImageReferences(q);
    expect([...report.hashes]).toEqual([HASH]);
    expect(report.external).toEqual(['https://x.org/b.png']);
  });
});
