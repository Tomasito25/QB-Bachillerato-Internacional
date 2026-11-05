import { beforeAll, describe, expect, it } from 'vitest';
import { loadMath, renderMarkdown } from '@/infra/markdown/render';

const HASH = 'b'.repeat(64);

/** Lo que nunca debe llegar al DOM, se escriba como se escriba. */
function expectSafe(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  expect(root.querySelector('script, iframe, object, embed, style, form, link, meta, base')).toBeNull();
  for (const element of root.querySelectorAll('*')) {
    for (const attr of element.attributes) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      expect(attr.value.toLowerCase().replace(/\s/g, '')).not.toMatch(/^(javascript|vbscript|data):/);
    }
  }
  for (const img of root.querySelectorAll('img')) {
    expect(img.getAttribute('src')).toBeNull();
    expect(img.getAttribute('data-qb-hash')).toMatch(/^[0-9a-f]{64}$/);
  }
}

describe('Markdown: formato', () => {
  it('pinta lo habitual', () => {
    const html = renderMarkdown('**negrita** *cursiva* `código`\n\n- uno\n- dos');
    expect(html).toContain('<strong>negrita</strong>');
    expect(html).toContain('<em>cursiva</em>');
    expect(html).toContain('<code>código</code>');
    expect(html).toContain('<li>uno</li>');
  });

  it('pinta bloques de código sin interpretarlos', () => {
    const html = renderMarkdown('```js\nconst a = "<b>";\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('abre los enlaces fuera, sin referente ni acceso a la ventana', () => {
    const html = renderMarkdown('[Gray](https://example.org)');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noopener');
    expect(html).toContain('noreferrer');
  });

  it('convierte las imágenes propias y bloquea las ajenas', () => {
    expect(renderMarkdown(`![figura](qbimg:${HASH})`)).toContain(`data-qb-hash="${HASH}"`);
    const external = renderMarkdown('![x](https://evil.example/pixel.gif)');
    expect(external).not.toContain('evil.example');
    expect(external).toContain('bloqueada');
  });
});

describe('Markdown: XSS', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)></svg>',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](  javascript:alert(1))',
    '[x](vbscript:msgbox(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '![x](javascript:alert(1))',
    '![x](data:image/svg+xml,<svg onload=alert(1)>)',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<style>@import "https://evil.example/x.css";</style>',
    '<form action="https://evil.example"><input name=x></form>',
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '[x](https://ok.example "title\\" onmouseover=alert(1) x=\\"")',
    '`<img src=x onerror=alert(1)>`',
    '<!--><img src=x onerror=alert(1)>-->',
  ];

  it.each(attacks)('neutraliza %s', (attack) => {
    expectSafe(renderMarkdown(attack));
  });

  it('el HTML crudo se muestra como texto, no se ejecuta', () => {
    const html = renderMarkdown('<b>hola</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('Markdown: fórmulas', () => {
  beforeAll(async () => {
    await loadMath();
  });

  it('pinta LaTeX en línea y en bloque', () => {
    expect(renderMarkdown('La energía $E = mc^2$ es.')).toContain('katex');
    expect(renderMarkdown('$$\n\\int_0^1 x\\,dx\n$$')).toContain('katex-display');
    expect(renderMarkdown('$$a^2$$')).toContain('katex');
  });

  it('una fórmula con fracción y raíz sobrevive al saneado', () => {
    const html = renderMarkdown('$\\frac{1}{\\sqrt{2}}$');
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('.katex-html')).not.toBeNull();
    expect(root.querySelector('.mfrac')).not.toBeNull();
    expect(html).toContain('style=');
    // El trazo de la raíz es un <path>: sin su `d` y su `viewBox` no se ve nada.
    const svg = root.querySelector('svg');
    expect(svg?.getAttribute('viewBox') ?? svg?.getAttribute('viewbox')).toBeTruthy();
    expect(root.querySelector('svg path')?.getAttribute('d')).toBeTruthy();
  });

  it('no confunde dinero con fórmulas', () => {
    expect(renderMarkdown('Cuesta $5 y luego $10.')).not.toContain('katex');
    expect(renderMarkdown('De 5$ a 10$')).not.toContain('katex');
  });

  it('respeta el dólar escapado', () => {
    expect(renderMarkdown('Un \\$ suelto y $x$')).toContain('katex');
    expect(renderMarkdown('solo \\$a\\$')).not.toContain('katex');
  });

  it('una fórmula errónea no rompe el resto', () => {
    const html = renderMarkdown('Antes $\\frac{$ después **sigue**');
    expect(html).toContain('<strong>sigue</strong>');
  });

  const mathAttacks = [
    '$\\href{javascript:alert(1)}{x}$',
    '$\\url{javascript:alert(1)}$',
    '$\\includegraphics{https://evil.example/x.png}$',
    '$\\htmlData{onclick=alert(1)}{x}$',
    '$\\html@mathml{<img src=x onerror=alert(1)>}{x}$',
    '$$\\href{javascript:alert(1)}{x}$$',
  ];

  it.each(mathAttacks)('neutraliza %s', (attack) => {
    const html = renderMarkdown(attack);
    expectSafe(html);
    expect(html.toLowerCase()).not.toContain('href="javascript');
  });
});
