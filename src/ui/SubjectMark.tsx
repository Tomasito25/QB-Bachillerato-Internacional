import { cn } from './cn';
import { markColor, subjectCode } from './marks';

/** La ficha de cada asignatura: mismo color y mismo código en toda la app. */
export function SubjectMark({ id, name, small, className }: { id: string; name: string; small?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('qb-display inline-flex shrink-0 items-center justify-center text-white', small ? 'size-7 text-[0.75rem]' : 'size-11 text-[1.25rem]', className)} style={{ background: markColor(id) }}>
      {subjectCode(name)}
    </span>
  );
}
