import DOMPurify from 'dompurify';
import type KatexModule from 'katex';
import MarkdownIt, { type StateBlock, type StateInline } from 'markdown-it';

/**
 * Del Markdown de un usuario a HTML que se puede insertar.
 *
 * Tres barreras, por este orden:
 *   1. markdown-it con `html: false`: el HTML crudo se escapa, no se interpreta.
 *   2. KaTeX con `trust: false`: sin `\href`, `\url` ni `\includegraphics`.
 *   3. DOMPurify sobre el resultado. Si algo se cuela por las dos primeras, se queda aquí.
 *
 * Y detrás, la CSP de `index.html`, que impide ejecutar scripts en línea aunque todo fallara.
 */

type Katex = typeof KatexModule;

let katex: Katex | null = null;
let katexLoading: Promise<void> | null = null;

/** KaTeX pesa bastante: se carga sólo si alguna pregunta lleva fórmulas. */
export function loadMath(): Promise<void> {
  katexLoading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
    katex = module.default;
  });
  return katexLoading;
}

export const isMathReady = (): boolean => katex !== null;
export const needsMath = (source: string): boolean => source.includes('$');

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

function renderMath(tex: string, displayMode: boolean): string {
  const escaped = md.utils.escapeHtml(tex);
  if (!katex) return `<code>${escaped}</code>`;
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 500,
      maxSize: 20,
      output: 'htmlAndMathml',
    });
  } catch {
    return `<span class="qb-math-error">${escaped}</span>`;
  }
}

/**
 * `$...$`. Para no confundirlo con dinero («de $5 a $10»), el que abre no puede ir seguido
 * de espacio, el que cierra no puede ir precedido de espacio ni seguido de una cifra.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src[pos] !== '$') return false;
  const delimiter = src[pos + 1] === '$' ? '$$' : '$';
  const contentStart = pos + delimiter.length;
  const first = src[contentStart];
  if (first === undefined || (delimiter === '$' && /\s/.test(first))) return false;

  let end = contentStart;
  for (;;) {
    end = src.indexOf(delimiter, end);
    if (end === -1 || end >= posMax) return false;
    let backslashes = 0;
    for (let i = end - 1; i >= contentStart && src[i] === '\\'; i--) backslashes += 1;
    if (backslashes % 2 === 0) break;
    end += 1;
  }
  if (end === contentStart) return false;
  if (delimiter === '$') {
    if (/\s/.test(src[end - 1] as string)) return false;
    if (/\d/.test(src[end + 1] ?? '')) return false;
  }
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(contentStart, end);
    token.markup = delimiter;
  }
  state.pos = end + delimiter.length;
  return true;
}

/** `$$` en su propia línea, hasta otra línea que termine en `$$`. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = (state.bMarks[startLine] as number) + (state.tShift[startLine] as number);
  const max = state.eMarks[startLine] as number;
  if (start + 2 > max || state.src.slice(start, start + 2) !== '$$') return false;
  if (silent) return true;

  const firstLine = state.src.slice(start + 2, max);
  let found = firstLine.trimEnd().endsWith('$$');
  let content = found ? firstLine.trimEnd().slice(0, -2) : firstLine;
  let line = startLine;
  while (!found) {
    line += 1;
    if (line >= endLine) return false;
    const lineStart = (state.bMarks[line] as number) + (state.tShift[line] as number);
    const lineEnd = state.eMarks[line] as number;
    const text = state.src.slice(lineStart, lineEnd);
    if (text.trimEnd().endsWith('$$')) {
      content += `\n${text.trimEnd().slice(0, -2)}`;
      found = true;
    } else {
      content += `\n${text}`;
    }
  }
  state.line = line + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, state.line];
  token.markup = '$$';
  return true;
}

md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.after('blockquote', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.math_inline = (tokens, idx) => {
  const token = tokens[idx];
  return renderMath(token?.content ?? '', token?.markup === '$$');
};
md.renderer.rules.math_block = (tokens, idx) => `<div class="qb-math">${renderMath(tokens[idx]?.content ?? '', true)}</div>`;

const QB_IMAGE = /^qbimg:([0-9a-f]{64})$/;

/**
 * Sólo imágenes propias. Se pintan sin `src`: la dirección la pone después `hydrateImages`,
 * que sabe si está en este dispositivo o publicada.
 */
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  if (!token) return '';
  const alt = md.utils.escapeHtml(token.content);
  const match = QB_IMAGE.exec(String(token.attrGet('src') ?? ''));
  if (!match) return `<span class="qb-math-error">[imagen externa bloqueada]</span>`;
  return `<img data-qb-hash="${match[1]}" alt="${alt}" />`;
};

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta', 'base', 'use', 'image', 'foreignObject', 'animate', 'set'],
  FORBID_ATTR: ['srcset', 'src', 'action', 'formaction', 'xlink:href', 'background', 'ping'],
  // DOMPurify aplica esta expresión a todos los atributos con valor, no sólo a los enlaces.
  // Por eso admite lo que no tiene esquema (el `d` de un <path>, un ancho…) y, de lo que lo
  // tiene, sólo http, https y mailto: fuera `javascript:`, `data:` y compañía.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['data-qb-hash', 'target'],
};

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    // Un `<img>` sin hash propio no tiene de dónde salir: fuera.
    if (node.tagName === 'IMG' && !/^[0-9a-f]{64}$/.test(node.getAttribute('data-qb-hash') ?? '')) {
      node.remove();
    }
  });
}

export function renderMarkdown(source: string): string {
  installHooks();
  return DOMPurify.sanitize(md.render(source), PURIFY_CONFIG) as string;
}
