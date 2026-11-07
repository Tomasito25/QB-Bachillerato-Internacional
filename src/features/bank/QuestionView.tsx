import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { partLabel, type OpenPart, type Question } from '@core/schema/question';
import { scanImageReferences } from '@core/questions/refs';
import { AttachedImage, Markdown } from '@/infra/markdown/Markdown';
import { cn } from '@/ui/cn';

/**
 * Imágenes adjuntas que ningún texto incrusta: se muestran bajo el enunciado. Las de una
 * opción o una solución van en su sitio; sacarlas aquí adelantaría la respuesta.
 */
export function loose(question: Question) {
  const used = scanImageReferences(question).hashes;
  return question.images.filter((image) => !used.has(image.hash));
}

export function QuestionStatement({ question }: { question: Question }) {
  const attachments = loose(question);
  return (
    <div>
      <Markdown source={question.statement} images={question.images} className="text-[0.96875rem]" />
      {attachments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-3">
          {attachments.map((image) => (
            <AttachedImage key={image.hash} image={image} className="max-h-80 w-auto" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SolutionBlock({ title, source, question }: { title: string; source: string; question: Question }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <Markdown source={source} images={question.images} className="text-sm" />
    </section>
  );
}

/** Un apartado: su letra, su pregunta y sus puntos. Debajo, lo que toque: la respuesta, la solución… */
export function PartBlock({ question, part, index, children }: { question: Question; part: OpenPart; index: number; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="w-5 shrink-0 text-[0.9375rem] font-semibold">{partLabel(index)}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <Markdown source={part.statement} images={question.images} className="min-w-0 text-[0.9375rem]" />
          {part.marks ? (
            <span className="shrink-0 pt-0.5 text-xs text-muted tabular-nums">
              {part.marks} {part.marks === 1 ? 'punto' : 'puntos'}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/** Vista completa, de consulta. No es la de responder: esa está en el modo de estudio. */
export function QuestionView({ question, showSolution }: { question: Question; showSolution: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <QuestionStatement question={question} />
      {question.type === 'mcq' ? (
        <ul className="flex flex-col gap-1.5">
          {question.answers.map((answer) => {
            const correct = showSolution && answer.correct;
            const Icon = correct ? CheckCircle2 : Circle;
            return (
              <li key={answer.id} className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm', correct ? 'border-success bg-success-soft' : 'border-border')}>
                <Icon size={16} className={cn('mt-0.5 shrink-0', correct ? 'text-success' : 'text-faint')} aria-label={correct ? 'Correcta' : undefined} aria-hidden={!correct} />
                <div className="min-w-0 flex-1">
                  <Markdown source={answer.text} images={question.images} />
                  {showSolution && answer.feedback ? <p className="mt-1 text-xs text-muted">{answer.feedback}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {question.type === 'open' && question.parts ? (
        <ol className="flex flex-col gap-4">
          {question.parts.map((part, index) => (
            <PartBlock key={part.id} question={question} part={part} index={index}>
              {showSolution ? <SolutionBlock title="Solución" source={part.modelAnswer} question={question} /> : null}
            </PartBlock>
          ))}
        </ol>
      ) : null}
      {showSolution && question.type === 'open' && question.modelAnswer ? <SolutionBlock title={question.parts ? 'Solución general' : 'Respuesta modelo'} source={question.modelAnswer} question={question} /> : null}
      {showSolution && question.type === 'open' && question.criteria.length > 0 ? (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Criterios de corrección</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {question.criteria.map((criterion) => (
              <li key={criterion.id} className="flex items-baseline justify-between gap-3">
                <span>{criterion.text}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{criterion.weight} {criterion.weight === 1 ? 'punto' : 'puntos'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {showSolution && question.explanation ? <SolutionBlock title="Explicación" source={question.explanation} question={question} /> : null}
    </div>
  );
}

export function ReferencesList({ question }: { question: Question }) {
  if (question.references.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {question.references.map((reference, i) => (
        <li key={i}>
          {reference.url ? (
            <a href={reference.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline">
              {reference.title}
              <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            reference.title
          )}
        </li>
      ))}
    </ul>
  );
}
