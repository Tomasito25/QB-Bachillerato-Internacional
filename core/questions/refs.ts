import type { Question } from '../schema/question.ts';

/**
 * Las imágenes del Markdown sólo pueden ser `qbimg:<sha256>`. Esto evita los píxeles de
 * rastreo y que una pregunta deje de verse porque desapareció un servidor ajeno.
 */
const IMAGE_MARKDOWN = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const QB_IMAGE = /^qbimg:([0-9a-f]{64})$/;
/** Imágenes en HTML crudo. El renderizador las desactiva; aquí se rechazan antes. */
const RAW_IMG = /<\s*img\b/i;

export function markdownFields(question: Question): string[] {
  const fields = [question.statement, question.explanation ?? ''];
  if (question.type === 'mcq') {
    for (const answer of question.answers) {
      fields.push(answer.text, answer.feedback ?? '');
    }
  } else {
    fields.push(question.modelAnswer, ...question.criteria.map((c) => c.text));
    for (const part of question.parts ?? []) {
      fields.push(part.statement, part.modelAnswer);
      for (const sub of part.subparts ?? []) fields.push(sub.statement, sub.modelAnswer);
    }
  }
  return fields;
}

export interface ImageReferenceReport {
  hashes: Set<string>;
  external: string[];
  rawHtml: boolean;
}

export function scanImageReferences(question: Question): ImageReferenceReport {
  const report: ImageReferenceReport = { hashes: new Set(), external: [], rawHtml: false };
  for (const field of markdownFields(question)) {
    if (RAW_IMG.test(field)) report.rawHtml = true;
    for (const match of field.matchAll(IMAGE_MARKDOWN)) {
      const target = match[1] ?? '';
      const qb = QB_IMAGE.exec(target);
      if (qb?.[1]) report.hashes.add(qb[1]);
      else report.external.push(target);
    }
  }
  return report;
}
