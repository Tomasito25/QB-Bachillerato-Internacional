import { normalizeText } from '../questions/normalize.ts';

/**
 * Duración y composición de las pruebas del IB. Las duraciones salen de sus calendarios de examen;
 * los puntos y el número de preguntas, de resúmenes de sus guías, porque los PDF no se pudieron
 * leer directamente. Si el IB cambia un programa, aquí es donde hay que tocar.
 */

export interface PaperPart {
  label: string;
  kind: 'mcq' | 'open';
  /** Número de preguntas. Sólo en tipo test: en desarrollo manda la puntuación. */
  count?: number;
  marks: number;
  /** Prefiere preguntas con esta etiqueta, si las hay. */
  preferTag?: string;
}

export interface Paper {
  id: string;
  name: string;
  minutes: number;
  parts: PaperPart[];
  calculator: boolean;
  /** Se permite un cuadernillo de fórmulas o datos. */
  booklet: boolean;
}

export interface ExamFormat {
  id: string;
  name: string;
  papers: Paper[];
}

export const paperMarks = (paper: Paper): number => paper.parts.reduce((sum, part) => sum + part.marks, 0);

const DATA_TAG = 'datos';

/** Las tres ciencias comparten forma desde 2025: 1A de test, 1B con datos y paper 2 escrito. */
function science(id: string, name: string, sl: [number, number, number], hl: [number, number, number]): ExamFormat[] {
  const build = (level: 'sl' | 'hl', [mcq, data, written]: [number, number, number]): ExamFormat => ({
    id: `${id}-${level}`,
    name: `${name} ${level.toUpperCase()}`,
    papers: [
      {
        id: `${id}-${level}-1`,
        name: 'Paper 1',
        minutes: level === 'sl' ? 90 : 120,
        parts: [
          { label: 'Paper 1A · tipo test', kind: 'mcq', count: mcq, marks: mcq },
          { label: 'Paper 1B · análisis de datos', kind: 'open', marks: data, preferTag: DATA_TAG },
        ],
        calculator: true,
        booklet: true,
      },
      { id: `${id}-${level}-2`, name: 'Paper 2', minutes: level === 'sl' ? 90 : 150, parts: [{ label: 'Respuesta corta y desarrollo', kind: 'open', marks: written }], calculator: true, booklet: true },
    ],
  });
  return [build('sl', sl), build('hl', hl)];
}

function maths(id: string, name: string, firstPaperCalculator: boolean): ExamFormat[] {
  const paper = (level: string, n: number, minutes: number, marks: number, calculator: boolean): Paper => ({ id: `${id}-${level}-${n}`, name: `Paper ${n}`, minutes, parts: [{ label: 'Desarrollo', kind: 'open', marks }], calculator, booklet: true });
  return [
    { id: `${id}-sl`, name: `${name} SL`, papers: [paper('sl', 1, 90, 80, firstPaperCalculator), paper('sl', 2, 90, 80, true)] },
    { id: `${id}-hl`, name: `${name} HL`, papers: [paper('hl', 1, 120, 110, firstPaperCalculator), paper('hl', 2, 120, 110, true), paper('hl', 3, 60, 55, true)] },
  ];
}

const business = (level: 'sl' | 'hl', papers: [number, number, number][]): ExamFormat => ({
  id: `business-${level}`,
  name: `Business Management ${level.toUpperCase()}`,
  papers: papers.map(([n, minutes, marks]) => ({ id: `business-${level}-${n}`, name: `Paper ${n}`, minutes, parts: [{ label: 'Desarrollo', kind: 'open', marks }], calculator: n === 2, booklet: false })),
});

export const EXAM_FORMATS: ExamFormat[] = [
  ...science('physics', 'Física', [25, 20, 55], [40, 20, 90]),
  ...science('chemistry', 'Química', [30, 25, 50], [40, 35, 90]),
  ...science('biology', 'Biología', [30, 25, 50], [40, 35, 80]),
  ...maths('math-aa', 'Matemáticas AA', false),
  ...maths('math-ai', 'Matemáticas AI', true),
  business('sl', [[1, 90, 30], [2, 90, 40]]),
  business('hl', [[1, 90, 30], [2, 105, 50], [3, 75, 25]]),
];

export function findPaper(paperId: string | null | undefined): { format: ExamFormat; paper: Paper } | null {
  for (const format of EXAM_FORMATS) {
    const paper = format.papers.find((p) => p.id === paperId);
    if (paper) return { format, paper };
  }
  return null;
}

const SUBJECTS: [RegExp, string][] = [
  [/\b(fisica|physics)\b/, 'physics'],
  [/\b(quimica|chemistry)\b/, 'chemistry'],
  [/\b(biologia|biology)\b/, 'biology'],
  [/\b(mae|aa|analisis|analysis)\b/, 'math-aa'],
  [/\b(mai|ai|aplicaciones|applications)\b/, 'math-ai'],
  [/\b(business|bm|empresa|empresas)\b/, 'business'],
];

/** Adivina el formato por el nombre. Si no lo tiene claro, no elige: se le pregunta a la persona. */
export function detectFormat(subjectName: string): ExamFormat | null {
  const name = normalizeText(subjectName);
  const subject = SUBJECTS.find(([pattern]) => pattern.test(name))?.[1];
  const level = /\b(hl|ns)\b/.test(name) ? 'hl' : /\b(sl|nm)\b/.test(name) ? 'sl' : null;
  if (!subject || !level) return null;
  return EXAM_FORMATS.find((format) => format.id === `${subject}-${level}`) ?? null;
}
