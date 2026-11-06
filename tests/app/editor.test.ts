import { describe, expect, it } from 'vitest';
import { applyFormat, insertAt } from '@/features/editor/format';
import { formToQuestion, newForm, nextId, questionToForm, removeImageReferences, type QuestionForm } from '@/features/editor/form';
import { excerpt } from '@/features/bank/questionsRepo';
import { makeMcq, makeOpen, SUBJECT_ID, TOPIC_ID } from '../fixtures';

const HASH = 'c'.repeat(64);

function validForm(overrides: Partial<QuestionForm> = {}): QuestionForm {
  const form = newForm(SUBJECT_ID, [TOPIC_ID]);
  return {
    ...form,
    statement: '¿Cuál?',
    answers: form.answers.map((a, i) => ({ ...a, text: `Opción ${i}`, correct: i === 0 })),
    ...overrides,
  };
}

describe('barra de formato', () => {
  it('envuelve la selección', () => {
    const result = applyFormat({ value: 'hola mundo', start: 5, end: 10 }, 'bold');
    expect(result.value).toBe('hola **mundo**');
    expect(result.value.slice(result.start, result.end)).toBe('mundo');
  });

  it('sin selección inserta un texto de ejemplo seleccionado', () => {
    const result = applyFormat({ value: '', start: 0, end: 0 }, 'math');
    expect(result.value).toBe('$x^2$');
    expect(result.value.slice(result.start, result.end)).toBe('x^2');
  });

  it('pulsar otra vez deshace el formato', () => {
    const once = applyFormat({ value: 'hola', start: 0, end: 4 }, 'bold');
    const twice = applyFormat(once, 'bold');
    expect(twice.value).toBe('hola');
  });

  it('las listas afectan a todas las líneas seleccionadas', () => {
    const value = 'uno\ndos\ntres';
    expect(applyFormat({ value, start: 0, end: value.length }, 'ul').value).toBe('- uno\n- dos\n- tres');
    expect(applyFormat({ value, start: 0, end: value.length }, 'ol').value).toBe('1. uno\n2. dos\n3. tres');
  });

  it('una lista funciona aunque el cursor esté a mitad de línea', () => {
    expect(applyFormat({ value: 'uno\ndos', start: 5, end: 5 }, 'quote').value).toBe('uno\n> dos');
  });

  it('los bloques quedan en líneas propias', () => {
    const result = applyFormat({ value: 'antes', start: 5, end: 5 }, 'codeblock');
    expect(result.value).toBe('antes\n\n```\ncódigo\n```');
    expect(result.value.slice(result.start, result.end)).toBe('código');
  });

  it('el enlace deja seleccionada la dirección', () => {
    const result = applyFormat({ value: 'mira esto', start: 5, end: 9 }, 'link');
    expect(result.value).toBe('mira [esto](https://)');
    expect(result.value.slice(result.start, result.end)).toBe('https://');
  });

  it('inserta en el cursor', () => {
    expect(insertAt({ value: 'ab', start: 1, end: 1 }, 'X')).toEqual({ value: 'aXb', start: 2, end: 2 });
  });
});

describe('identificadores de opción', () => {
  it('nunca reutiliza uno existente', () => {
    expect(nextId([{ id: 'a' }, { id: 'b' }])).toBe('c');
    expect(nextId([{ id: 'b' }])).toBe('a');
    const all = 'abcdefghijklmnopqrstuvwxyz'.split('').map((id) => ({ id }));
    expect(nextId(all)).toBe('a1');
  });
});

describe('del formulario a la pregunta', () => {
  it('produce un documento válido', () => {
    const { question, errors } = formToQuestion(validForm());
    expect(errors).toEqual({});
    expect(question?.type).toBe('mcq');
    expect(question?.rev).toBe(1);
  });

  it('explica cada error en español', () => {
    expect(formToQuestion(validForm({ statement: '  ' })).errors.statement).toBeTruthy();
    expect(formToQuestion(validForm({ topicIds: [] })).errors.topics).toBeTruthy();
    const form = validForm();
    expect(formToQuestion({ ...form, answers: form.answers.slice(0, 3) }).errors.answers).toContain('al menos 4');
    expect(formToQuestion({ ...form, answers: form.answers.map((a) => ({ ...a, correct: false })) }).errors.answers).toContain('correcta');
    expect(formToQuestion({ ...form, answers: form.answers.map((a) => ({ ...a, text: '' })) }).errors.answers).toContain('vacías');
    expect(formToQuestion({ ...form, answers: form.answers.map((a) => ({ ...a, correct: true })) }).errors.answers).toContain('única');
    expect(formToQuestion(validForm({ type: 'open', modelAnswer: '' })).errors.modelAnswer).toBeTruthy();
  });

  it('permite varias correctas con respuesta múltiple', () => {
    const form = validForm({ multiple: true });
    const { question } = formToQuestion({ ...form, answers: form.answers.map((a, i) => ({ ...a, correct: i < 2 })) });
    expect(question).not.toBeNull();
  });

  it('no deja un enlace peligroso en las referencias', () => {
    const { errors } = formToQuestion(validForm({ references: [{ title: 'x', url: 'javascript:alert(1)' }] }));
    expect(errors.references).toBeTruthy();
  });

  it('rechaza imágenes externas', () => {
    expect(formToQuestion(validForm({ statement: '![x](https://evil.example/a.png)' })).errors.images).toBeTruthy();
  });

  it('rechaza referencias a imágenes no adjuntas', () => {
    expect(formToQuestion(validForm({ statement: `![x](qbimg:${HASH})` })).errors.images).toBeTruthy();
  });

  it('acepta imágenes adjuntas', () => {
    const images = [{ hash: HASH, ext: 'webp' as const, width: 10, height: 10, bytes: 100, alt: '' }];
    expect(formToQuestion(validForm({ statement: `Mira ![x](qbimg:${HASH})`, images })).question).not.toBeNull();
  });

  it('quitar una imagen limpia sus referencias', () => {
    const images = [{ hash: HASH, ext: 'webp' as const, width: 10, height: 10, bytes: 100, alt: '' }];
    const form = removeImageReferences(validForm({ statement: `Antes ![x](qbimg:${HASH}) después`, images }), HASH);
    expect(form.images).toEqual([]);
    expect(form.statement).toBe('Antes  después');
    expect(formToQuestion(form).question).not.toBeNull();
  });

  it('ida y vuelta sin perder datos', () => {
    for (const original of [makeMcq({ tags: ['a'], references: [{ title: 'Gray' }] }), makeOpen()]) {
      const { question, errors } = formToQuestion(questionToForm(original), Date.parse(original.updatedAt));
      expect(errors).toEqual({});
      expect(JSON.parse(JSON.stringify(question))).toEqual(JSON.parse(JSON.stringify(original)));
    }
  });
});

describe('extracto para listados', () => {
  it('deja legibles las fórmulas cortas y sustituye las largas', () => {
    expect(excerpt('Masa $m$ y velocidad $v_0$:\n\n$$E_c = \\frac{1}{2} m v^2$$\n\nentonces')).toBe('Masa m y velocidad v_0: [fórmula] entonces');
    expect(excerpt('Sea $\\frac{a}{b}$ una fracción')).toBe('Sea [fórmula] una fracción');
  });

  it('quita las marcas de formato sin tocar palabras con guion bajo', () => {
    expect(excerpt('**negrita** y `código` y variable_nombre')).toBe('negrita y código y variable_nombre');
    expect(excerpt('[enlace](https://x.org) y ![foto](qbimg:abc)')).toBe('enlace y [imagen]');
  });

  it('recorta por una palabra entera', () => {
    expect(excerpt('Uno dos tres cuatro cinco seis', 16)).toBe('Uno dos tres…');
  });

  it('recorta lo largo', () => {
    expect(excerpt('a'.repeat(300), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});
