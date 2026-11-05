import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildBracket, competitionAwards, computeStandings } from '../core/competitions/competitions.ts';
import { aggregate, type CompetitionAward } from '../core/scoring/aggregate.ts';
import type { DerivedCompetition, Manifest, ManifestShard, ShardKind } from '../core/schema/derived.ts';
import type { StoredAnswerEvent } from '../core/schema/events.ts';
import type { Question } from '../core/schema/question.ts';
import { sha256Hex } from '../core/util/encoding.ts';
import { DAY, toIso } from '../core/util/time.ts';
import { DataStore } from './lib/data-store.ts';

/**
 * Convierte la rama `data` en los ficheros estáticos que sirve Pages.
 *
 * Lo derivado (rankings, perfiles, clasificaciones) no se versiona: se recalcula aquí. Por eso
 * cualquiera puede comprobarlo clonando `data` y ejecutando este mismo script.
 *
 * Los fragmentos llevan su hash en el nombre: el cliente sólo baja los que han cambiado.
 */

export interface BuildOptions {
  dataDir: string;
  outDir: string;
  now: number;
  commit: string;
}

const BUCKETS = 16;
/** Competiciones cerradas hace más de esto dejan de bajarse en cada sincronización. */
const COMPETITION_RETENTION_DAYS = 120;

export function bucketOf(questionId: string): string {
  return questionId[0] ?? '0';
}

class Writer {
  readonly shards: ManifestShard[] = [];
  private readonly outDir: string;

  constructor(outDir: string) {
    this.outDir = outDir;
  }

  async shard(id: string, kind: ShardKind, base: string, value: unknown, count: number, subjectId?: string): Promise<void> {
    const json = JSON.stringify(value);
    const hash = await sha256Hex(json);
    const path = `${base}.${hash.slice(0, 12)}.json`;
    const file = join(this.outDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, json);
    this.shards.push({ id, kind, path, hash, count, ...(subjectId ? { subjectId } : {}) });
  }

  async file(path: string, value: unknown): Promise<void> {
    const file = join(this.outDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
}

export async function buildCommunity(options: BuildOptions): Promise<Manifest> {
  const { dataDir, outDir, now, commit } = options;
  const store = await new DataStore(dataDir).load();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const writer = new Writer(outDir);

  const excluded = new Set([...store.hidden, ...store.retired]);
  const visible = [...store.questions.values()].filter((q) => !excluded.has(q.id));
  const subjects = store.subjects().sort((a, b) => a.id.localeCompare(b.id));

  await writer.shard('taxonomy', 'taxonomy', 'taxonomy', subjects, subjects.length);

  // Preguntas, por asignatura y cubo. Una pregunta nueva sólo invalida uno de los 16 cubos.
  const bySubject = new Map<string, Question[]>();
  for (const question of visible) bySubject.set(question.subjectId, [...(bySubject.get(question.subjectId) ?? []), question]);
  for (const [subjectId, questions] of [...bySubject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const buckets = new Map<string, Question[]>();
    for (const question of questions) buckets.set(bucketOf(question.id), [...(buckets.get(bucketOf(question.id)) ?? []), question]);
    for (const [bucket, docs] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      docs.sort((a, b) => a.id.localeCompare(b.id));
      await writer.shard(`q/${subjectId}/${bucket}`, 'questions', `q/${subjectId}/${bucket}`, docs, docs.length, subjectId);
    }
    if (questions.length > BUCKETS * 2000) console.warn(`La asignatura ${subjectId} tiene muchas preguntas: conviene subir BUCKETS.`);
  }

  // Sólo se copian las imágenes que usa alguna pregunta visible: lo retirado deja de servirse.
  const usedImages = new Set(visible.flatMap((q) => q.images.map((i) => `${i.hash}.${i.ext}`)));
  await mkdir(join(outDir, 'images'), { recursive: true });
  for (const name of usedImages) {
    if (store.images.has(name)) await copyFile(store.path('images', name), join(outDir, 'images', name));
  }

  // Competiciones
  const questionMap = new Map<string, Question>(store.questions);
  const awards: CompetitionAward[] = [];
  const derived: DerivedCompetition[] = [];
  for (const competition of (await store.allCompetitions()).sort((a, b) => a.id.localeCompare(b.id))) {
    const entries = await store.readEntries(competition.id);
    const registered = (await store.readRegistrations(competition.id)).map((r) => r.user.login);
    const standings = competition.type === 'tournament' ? [] : computeStandings(competition, entries, questionMap);
    const bracket = competition.type === 'tournament' ? buildBracket(competition, registered, entries, questionMap, now) : null;
    awards.push(...competitionAwards(competition, standings, bracket, entries, now));
    const participants = [...new Set([...registered, ...entries.map((e) => e.user.login)])].sort();
    const isRecent = now - Date.parse(competition.closesAt) < COMPETITION_RETENTION_DAYS * DAY;
    if (isRecent) derived.push({ ...competition, participants, standings, bracket: bracket?.rounds ?? null, champion: bracket?.champion ?? null });
  }

  // Rankings y perfiles
  const answers = new Map<string, StoredAnswerEvent[]>();
  let answerCount = 0;
  for await (const { login, events } of store.allAnswers()) {
    const list = answers.get(login);
    if (list) list.push(...events);
    else answers.set(login, events);
    answerCount += events.length;
  }
  const output = aggregate({
    now,
    users: [...store.users.values()].sort((a, b) => a.login.localeCompare(b.login)),
    answers,
    questions: [...store.questions.values()],
    excludedQuestions: excluded,
    system: await store.allSystemEvents(),
    awards,
    banned: store.banned,
    trusted: store.trusted,
  });

  await writer.shard('profiles', 'profiles', 'profiles', output.profiles, output.profiles.length);
  await writer.shard('leaderboards', 'leaderboards', 'leaderboards', output.leaderboards, output.leaderboards.length);
  await writer.shard('competitions', 'competitions', 'competitions', derived, derived.length);
  await writer.shard('question-stats', 'question-stats', 'question-stats', output.questionStats, output.questionStats.length);
  await writer.shard('moderation', 'moderation', 'moderation', { hiddenQuestions: [...store.hidden].sort(), retiredQuestions: [...store.retired].sort() }, store.hidden.size + store.retired.size);

  // Detalle de cada usuario: se pide al abrir su perfil, no con cada sincronización.
  for (const detail of output.details) await writer.file(`u/${detail.login}.json`, detail);

  // Informe público: la moderación también es auditable.
  await writer.file('integrity.json', { generatedAt: toIso(now), suspects: output.suspects, quarantined: store.quarantined });

  const manifest: Manifest = {
    schemaVersion: 1,
    generatedAt: toIso(now),
    dataCommit: commit,
    shards: writer.shards,
    counts: {
      questions: visible.length,
      subjects: subjects.length,
      users: store.users.size,
      answers: answerCount,
      competitions: derived.length,
    },
    quarantined: store.quarantined.length,
  };
  await writer.file('manifest.json', manifest);
  return manifest;
}

function dataCommit(dir: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local';
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: '.data' },
      out: { type: 'string', default: 'dist/community' },
    },
  });
  const dataDir = resolve(values.data);
  const outDir = resolve(values.out);
  const manifest = await buildCommunity({ dataDir, outDir, now: Date.now(), commit: dataCommit(dataDir) });
  console.log(`Datos comunitarios en ${outDir}: ${JSON.stringify(manifest.counts)}, ${manifest.shards.length} fragmentos, ${manifest.quarantined} apartados.`);
  if (manifest.quarantined > 0) console.warn('Hay documentos apartados: mira integrity.json.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
