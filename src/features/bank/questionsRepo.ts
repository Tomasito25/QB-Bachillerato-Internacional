import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Question } from '@core/schema/question';
import { db } from '@/infra/db/db';
import type { CommunityQuestionRow, LocalMeta, LocalQuestionRow } from '@/infra/db/types';

/** Procedencia de lo que se ve: comunitaria, sólo mía o comunitaria con una edición mía encima. */
export type QuestionOrigin = 'community' | 'local' | 'edited';

export type ViewQuestion = Question & { origin: QuestionOrigin; local: LocalMeta | null };

function fromCommunity(row: CommunityQuestionRow): ViewQuestion {
  const { shardId: _shardId, ...question } = row;
  return { ...question, origin: 'community', local: null } as ViewQuestion;
}

function fromLocal(row: LocalQuestionRow, editsCommunity: boolean): ViewQuestion {
  return { ...row, origin: editsCommunity ? 'edited' : 'local' } as ViewQuestion;
}

/** Deja sólo los campos del documento: lo que se valida, se exporta y se publica. */
export function toQuestion(view: ViewQuestion | LocalQuestionRow | CommunityQuestionRow): Question {
  const { origin: _origin, local: _local, shardId: _shardId, ...question } = view as ViewQuestion & CommunityQuestionRow;
  return question as Question;
}

async function readAllQuestions(): Promise<ViewQuestion[]> {
  const [community, local] = await Promise.all([db.cQuestions.toArray(), db.lQuestions.toArray()]);
  const byId = new Map<string, ViewQuestion>();
  for (const row of community) byId.set(row.id, fromCommunity(row));
  for (const row of local) byId.set(row.id, fromLocal(row, byId.has(row.id)));
  return [...byId.values()];
}

/**
 * Con miles de preguntas, leerlas todas cuesta cientos de milisegundos, y varias pantallas las
 * piden a la vez. Se guarda el resultado hasta que cambie alguna de las dos tablas, también
 * desde otra pestaña. Quien lo recibe no debe modificarlo: es compartido.
 */
let cached: Promise<ViewQuestion[]> | null = null;

Dexie.on('storagemutated').subscribe((parts: Record<string, unknown>) => {
  if (Object.keys(parts).some((key) => key.includes('/lQuestions/') || key.includes('/cQuestions/'))) cached = null;
});

export async function loadQuestions(): Promise<ViewQuestion[]> {
  // Estas lecturas no sobran: suscriben a `useLiveQuery` a las tablas aunque se use la caché.
  await Promise.all([db.cQuestions.count(), db.lQuestions.count()]);
  cached ??= readAllQuestions().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

export function useQuestions(): ViewQuestion[] | undefined {
  return useLiveQuery(loadQuestions, []);
}

export async function getQuestion(id: string): Promise<ViewQuestion | undefined> {
  const [community, local] = await Promise.all([db.cQuestions.get(id), db.lQuestions.get(id)]);
  if (local) return fromLocal(local, community !== undefined);
  return community ? fromCommunity(community) : undefined;
}

export function useQuestion(id: string | undefined): ViewQuestion | null | undefined {
  return useLiveQuery(async () => (id ? ((await getQuestion(id)) ?? null) : null), [id]);
}

export async function saveLocalQuestion(question: Question, baseRev: number | null): Promise<void> {
  const existing = await db.lQuestions.get(question.id);
  await db.lQuestions.put({
    ...question,
    local: {
      baseRev,
      syncState: 'local',
      outboxId: existing?.local.outboxId ?? null,
      note: null,
    },
  } as LocalQuestionRow);
}

/** Borra la copia local. Si era la edición de una comunitaria, vuelve a verse la original. */
export async function discardLocalQuestion(id: string): Promise<void> {
  await db.lQuestions.delete(id);
}

/**
 * Una línea de texto para listados. Las fórmulas cortas se dejan legibles («$m$» → «m») y las
 * largas se sustituyen: nadie quiere leer `\\frac{1}{2}` en una lista.
 */
export function excerpt(markdown: string, max = 180): string {
  const text = markdown
    .replace(/\$\$[\s\S]*?\$\$/g, ' [fórmula] ')
    .replace(/\$([^$\n]+)\$/g, (_, tex: string) => (tex.length <= 12 && !tex.includes('\\') ? `\u2060${tex}\u2060` : '[fórmula]'))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[imagen]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`#>]|(?<![\w\u2060^])_|_(?![\w^])/g, '')
    .replace(/\u2060/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  // Se corta en un espacio para no dejar palabras a medias, salvo que quede demasiado corto.
  const space = text.lastIndexOf(' ', max);
  return `${text.slice(0, space > max * 0.6 ? space : max).trimEnd()}…`;
}
