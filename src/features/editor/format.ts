/** Transformaciones de la barra de formato. Son puras: se prueban sin navegador. */

export type FormatAction = 'bold' | 'italic' | 'heading' | 'ul' | 'ol' | 'quote' | 'link' | 'code' | 'codeblock' | 'math' | 'mathblock';

export interface TextState {
  value: string;
  start: number;
  end: number;
}

function wrap(state: TextState, before: string, after: string, placeholder: string): TextState {
  const selected = state.value.slice(state.start, state.end);
  const inner = selected || placeholder;
  // Si la selección ya está envuelta, deshacer: el botón funciona como interruptor.
  if (selected && state.value.slice(state.start - before.length, state.start) === before && state.value.slice(state.end, state.end + after.length) === after) {
    return {
      value: state.value.slice(0, state.start - before.length) + selected + state.value.slice(state.end + after.length),
      start: state.start - before.length,
      end: state.end - before.length,
    };
  }
  const value = state.value.slice(0, state.start) + before + inner + after + state.value.slice(state.end);
  return { value, start: state.start + before.length, end: state.start + before.length + inner.length };
}

function lineStart(value: string, position: number): number {
  return value.lastIndexOf('\n', position - 1) + 1;
}

function prefixLines(state: TextState, prefix: (index: number) => string): TextState {
  const from = lineStart(state.value, state.start);
  const block = state.value.slice(from, state.end);
  const lines = block.split('\n');
  const already = lines.every((line, i) => line.startsWith(prefix(i)));
  const changed = lines.map((line, i) => (already ? line.slice(prefix(i).length) : prefix(i) + line)).join('\n');
  const value = state.value.slice(0, from) + changed + state.value.slice(state.end);
  return { value, start: from, end: from + changed.length };
}

/** Bloque en sus propias líneas, con una línea en blanco delante si hace falta. */
function block(state: TextState, open: string, close: string, placeholder: string): TextState {
  const selected = state.value.slice(state.start, state.end) || placeholder;
  const before = state.value.slice(0, state.start);
  const after = state.value.slice(state.end);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const opening = `${lead}${open}\n`;
  const value = `${before}${opening}${selected}\n${close}${trail}${after}`;
  const start = before.length + opening.length;
  return { value, start, end: start + selected.length };
}

export function applyFormat(state: TextState, action: FormatAction): TextState {
  switch (action) {
    case 'bold':
      return wrap(state, '**', '**', 'texto en negrita');
    case 'italic':
      return wrap(state, '*', '*', 'texto en cursiva');
    case 'code':
      return wrap(state, '`', '`', 'código');
    case 'math':
      return wrap(state, '$', '$', 'x^2');
    case 'heading':
      return prefixLines(state, () => '### ');
    case 'ul':
      return prefixLines(state, () => '- ');
    case 'ol':
      return prefixLines(state, (i) => `${i + 1}. `);
    case 'quote':
      return prefixLines(state, () => '> ');
    case 'codeblock':
      return block(state, '```', '```', 'código');
    case 'mathblock':
      return block(state, '$$', '$$', '\\frac{a}{b}');
    case 'link': {
      const selected = state.value.slice(state.start, state.end) || 'texto del enlace';
      const urlPlaceholder = 'https://';
      const inserted = `[${selected}](${urlPlaceholder})`;
      const value = state.value.slice(0, state.start) + inserted + state.value.slice(state.end);
      const urlStart = state.start + selected.length + 3;
      return { value, start: urlStart, end: urlStart + urlPlaceholder.length };
    }
  }
}

export function insertAt(state: TextState, text: string): TextState {
  const value = state.value.slice(0, state.start) + text + state.value.slice(state.end);
  const position = state.start + text.length;
  return { value, start: position, end: position };
}

/** Una fórmula ya escrita: dónde está (con sus `$`) y qué lleva dentro. */
export interface FormulaSpan {
  start: number;
  end: number;
  latex: string;
  display: boolean;
}

/** La fórmula en la que está el cursor, para editarla en vez de escribir otra. */
export function formulaAt(state: TextState): FormulaSpan | null {
  const caret = state.start;
  for (const match of state.value.matchAll(/\$\$([\s\S]*?)\$\$|\$(?!\s)([^$\n]*?[^\s$\\])\$/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (caret > start && caret < end) return { start, end, latex: (match[1] ?? match[2] ?? '').trim(), display: match[1] !== undefined };
    if (start > caret) break;
  }
  return null;
}

/** Pone la fórmula en lugar de la selección: `$…$` en la línea, o un bloque `$$` aparte. */
export function insertFormula(state: TextState, latex: string, display: boolean): TextState {
  const tex = latex.trim();
  if (!display) return insertAt(state, `$${tex}$`);
  const inserted = block({ value: state.value.slice(0, state.start) + state.value.slice(state.end), start: state.start, end: state.start }, '$$', '$$', tex);
  const after = inserted.end + '\n$$'.length;
  return { value: inserted.value, start: after, end: after };
}

/**
 * Plantilla de la paleta, como `\frac{}{}`. Lo seleccionado entra en el primer hueco y el
 * cursor salta al siguiente; sin selección, el cursor se queda en el primero.
 */
export function applyTemplate(state: TextState, template: string): TextState {
  const selected = state.value.slice(state.start, state.end);
  const slot = template.indexOf('{}');
  let text = template;
  let caret = template.length;
  if (slot !== -1) {
    text = template.slice(0, slot + 1) + selected + template.slice(slot + 1);
    const next = text.indexOf('{}', slot + 1 + selected.length);
    caret = !selected ? slot + 1 : next === -1 ? text.length : next + 1;
  }
  const value = state.value.slice(0, state.start) + text + state.value.slice(state.end);
  return { value, start: state.start + caret, end: state.start + caret };
}
