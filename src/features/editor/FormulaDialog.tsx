import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '@/infra/markdown/Markdown';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Segmented } from '@/ui/Field';
import { applyTemplate, type TextState } from './format';

/** `{}` es un hueco: ahí va lo seleccionado o el cursor. Los comandos acaban en espacio para poder seguir escribiendo. */
const PALETTE: { group: string; items: [label: string, latex: string, title: string][] }[] = [
  {
    group: 'Estructuras',
    items: [
      ['a⁄b', '\\frac{}{}', 'Fracción'],
      ['xⁿ', '^{}', 'Potencia'],
      ['xᵢ', '_{}', 'Subíndice'],
      ['√x', '\\sqrt{}', 'Raíz cuadrada'],
      ['∛x', '\\sqrt[3]{}', 'Raíz cúbica'],
      // La flecha combinada (v⃗) no se pinta en todas las letras: mejor la palabra.
      ['vector', '\\vec{}', 'Vector'],
      ['x̄', '\\bar{}', 'Barra o media'],
      ['|x|', '\\left|{}\\right|', 'Valor absoluto'],
      ['( )', '\\left({}\\right)', 'Paréntesis que crecen'],
      ['×10ⁿ', '\\times 10^{}', 'Notación científica'],
      ['Aa', '\\text{}', 'Texto normal dentro de la fórmula'],
    ],
  },
  {
    group: 'Símbolos',
    items: [
      ['±', '\\pm ', 'Más menos'],
      ['×', '\\times ', 'Por'],
      ['·', '\\cdot ', 'Producto'],
      ['÷', '\\div ', 'Entre'],
      ['≈', '\\approx ', 'Aproximadamente'],
      ['≠', '\\neq ', 'Distinto'],
      ['≤', '\\leq ', 'Menor o igual'],
      ['≥', '\\geq ', 'Mayor o igual'],
      ['∝', '\\propto ', 'Proporcional a'],
      ['→', '\\rightarrow ', 'Flecha'],
      ['⇒', '\\Rightarrow ', 'Implica'],
      ['⇌', '\\rightleftharpoons ', 'Equilibrio'],
      ['∞', '\\infty ', 'Infinito'],
      ['°', '^{\\circ}', 'Grados'],
    ],
  },
  {
    group: 'Griegas',
    items: [
      ['α', '\\alpha ', 'alfa'],
      ['β', '\\beta ', 'beta'],
      ['γ', '\\gamma ', 'gamma'],
      ['δ', '\\delta ', 'delta'],
      ['ε', '\\varepsilon ', 'épsilon'],
      ['θ', '\\theta ', 'theta'],
      ['λ', '\\lambda ', 'lambda'],
      ['μ', '\\mu ', 'mu'],
      ['π', '\\pi ', 'pi'],
      ['ρ', '\\rho ', 'rho'],
      ['σ', '\\sigma ', 'sigma'],
      ['τ', '\\tau ', 'tau'],
      ['φ', '\\varphi ', 'fi'],
      ['ω', '\\omega ', 'omega'],
      ['Δ', '\\Delta ', 'Delta mayúscula'],
      ['Σ', '\\Sigma ', 'Sigma mayúscula'],
      ['Φ', '\\Phi ', 'Fi mayúscula'],
      ['Ω', '\\Omega ', 'Omega mayúscula'],
    ],
  },
  {
    group: 'Cálculo',
    items: [
      ['∫', '\\int_{}^{} ', 'Integral'],
      ['∑', '\\sum_{}^{} ', 'Sumatorio'],
      ['lím', '\\lim_{x \\to {}} ', 'Límite'],
      ['d/dx', '\\frac{d}{dx}', 'Derivada'],
      ['∂', '\\partial ', 'Parcial'],
      ['∇', '\\nabla ', 'Nabla'],
      ['log', '\\log ', 'Logaritmo'],
      ['ln', '\\ln ', 'Logaritmo neperiano'],
      ['sin', '\\sin ', 'Seno'],
      ['cos', '\\cos ', 'Coseno'],
      ['tan', '\\tan ', 'Tangente'],
    ],
  },
  {
    group: 'Unidades',
    items: [
      ['m', '\\,\\text{m}', 'metros'],
      ['s', '\\,\\text{s}', 'segundos'],
      ['kg', '\\,\\text{kg}', 'kilogramos'],
      ['m s⁻¹', '\\,\\text{m s}^{-1}', 'metros por segundo'],
      ['m s⁻²', '\\,\\text{m s}^{-2}', 'metros por segundo al cuadrado'],
      ['N', '\\,\\text{N}', 'newtons'],
      ['J', '\\,\\text{J}', 'julios'],
      ['W', '\\,\\text{W}', 'vatios'],
      ['Pa', '\\,\\text{Pa}', 'pascales'],
      ['Hz', '\\,\\text{Hz}', 'hercios'],
      ['V', '\\,\\text{V}', 'voltios'],
      ['A', '\\,\\text{A}', 'amperios'],
      ['Ω', '\\,\\Omega', 'ohmios'],
      ['K', '\\,\\text{K}', 'kelvin'],
      ['°C', '\\,^{\\circ}\\text{C}', 'grados Celsius'],
      ['mol', '\\,\\text{mol}', 'moles'],
    ],
  },
];

interface FormulaDialogProps {
  open: boolean;
  initial: string;
  display: boolean;
  /** Se está cambiando una fórmula que ya estaba en el texto. */
  editing: boolean;
  onClose: () => void;
  onInsert: (latex: string, display: boolean) => void;
}

/** Fórmulas sin saber LaTeX: botones para lo habitual y la vista previa al lado. */
export function FormulaDialog({ open, initial, display: initialDisplay, editing, onClose, onInsert }: FormulaDialogProps) {
  const [latex, setLatex] = useState(initial);
  const [display, setDisplay] = useState(initialDisplay);
  const [pending, setPending] = useState<TextState | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setLatex(initial);
    setDisplay(initialDisplay);
  }, [open, initial, initialDisplay]);

  // Tras pulsar un botón, el cursor vuelve al hueco de la plantilla.
  useEffect(() => {
    if (pending && input.current) {
      input.current.focus();
      input.current.setSelectionRange(pending.start, pending.end);
      setPending(null);
    }
  }, [pending]);

  const use = (template: string) => {
    const el = input.current;
    const next = applyTemplate({ value: latex, start: el?.selectionStart ?? latex.length, end: el?.selectionEnd ?? latex.length }, template);
    setLatex(next.value);
    setPending(next);
  };

  const insert = () => {
    if (latex.trim()) onInsert(latex, display);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      insert();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Editar fórmula' : 'Insertar fórmula'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!latex.trim()} onClick={insert}>
            {editing ? 'Guardar fórmula' : 'Insertar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label="Dónde va la fórmula"
          value={display}
          options={[
            { value: false, label: 'Dentro del texto' },
            { value: true, label: 'En un bloque aparte' },
          ]}
          onChange={setDisplay}
        />

        <div className="flex min-h-16 items-center justify-center overflow-x-auto rounded-md border border-border bg-subtle/50 px-3 py-3" aria-live="polite">
          {latex.trim() ? <Markdown source={display ? `$$\n${latex.trim()}\n$$` : `$${latex.trim()}$`} images={[]} className="text-base" /> : <p className="text-sm text-faint">Aquí verás la fórmula mientras la escribes.</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-[0.8125rem] font-medium">
            Fórmula
          </label>
          <textarea
            id={id}
            ref={input}
            data-autofocus
            rows={2}
            value={latex}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => setLatex(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Por ejemplo: v = \frac{\Delta x}{\Delta t}"
            className="block w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
          <p className="text-xs text-muted">Usa los botones o escribe en LaTeX. Para elevar o bajar varias cosas, ponlas entre llaves: x^{'{2n}'}.</p>
        </div>

        <div className="flex flex-col gap-2.5">
          {PALETTE.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-xs font-medium text-muted">{group}</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label={group}>
                {items.map(([label, template, title]) => (
                  <button
                    key={template}
                    type="button"
                    title={title}
                    aria-label={title}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => use(template)}
                    className="h-8 min-w-8 rounded-none border border-border bg-surface px-1.5 text-sm hover:border-border-strong hover:bg-hover"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
