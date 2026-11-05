import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { QuestionImage } from '@core/schema/question';
import { config } from '@/infra/config';
import { db } from '@/infra/db/db';
import { cn } from '@/ui/cn';
import { isMathReady, loadMath, needsMath, renderMarkdown } from './render';

async function imageUrl(hash: string, ext: string): Promise<{ url: string; revoke: boolean }> {
  const local = await db.localImages.get(hash);
  if (local) return { url: URL.createObjectURL(local.blob), revoke: true };
  return { url: config.communityUrl(`images/${hash}.${ext}`), revoke: false };
}

interface MarkdownProps {
  source: string;
  images?: readonly QuestionImage[];
  className?: string;
}

/** Pinta Markdown saneado. Es el único sitio donde se inserta HTML generado por usuarios. */
export function Markdown({ source, images, className }: MarkdownProps) {
  const [mathVersion, bump] = useReducer((n: number) => n + 1, 0);
  const wantsMath = needsMath(source);

  useEffect(() => {
    if (wantsMath && !isMathReady()) void loadMath().then(() => bump());
  }, [wantsMath]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- mathVersion fuerza repintar cuando llega KaTeX.
  const html = useMemo(() => renderMarkdown(source), [source, mathVersion]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    const urls: string[] = [];
    const extensions = new Map(images?.map((i) => [i.hash, i.ext]));
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-qb-hash]')) {
      const hash = img.getAttribute('data-qb-hash') as string;
      img.loading = 'lazy';
      img.decoding = 'async';
      void imageUrl(hash, extensions.get(hash) ?? 'webp').then(({ url, revoke }) => {
        if (cancelled) {
          if (revoke) URL.revokeObjectURL(url);
          return;
        }
        if (revoke) urls.push(url);
        img.src = url;
      });
    }
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [html, images]);

  return <div ref={ref} className={cn('qb-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Imagen adjunta que no está incrustada en el texto. */
export function AttachedImage({ image, className }: { image: QuestionImage; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let cancelled = false;
    let toRevoke: string | null = null;
    void imageUrl(image.hash, image.ext).then(({ url, revoke }) => {
      if (cancelled) {
        if (revoke) URL.revokeObjectURL(url);
        return;
      }
      if (revoke) toRevoke = url;
      if (ref.current) ref.current.src = url;
    });
    return () => {
      cancelled = true;
      if (toRevoke) URL.revokeObjectURL(toRevoke);
    };
  }, [image.hash, image.ext]);
  return <img ref={ref} alt={image.alt} width={image.width} height={image.height} loading="lazy" className={cn('h-auto max-w-full rounded-lg border border-border bg-white', className)} />;
}
