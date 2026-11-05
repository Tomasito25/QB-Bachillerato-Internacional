import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { duplicateIndexEntry, type DuplicateIndexEntry } from '../../core/questions/normalize.ts';
import { Competition, CompetitionEntry, CompetitionRegistration } from '../../core/schema/competition.ts';
import { StoredAnswerEvent, SystemEvent } from '../../core/schema/events.ts';
import { migrateDocument } from '../../core/schema/migrations.ts';
import { BannedFile, HiddenFile, RetiredFile, TrustedFile } from '../../core/schema/moderation.ts';
import { UserDoc } from '../../core/schema/profile.ts';
import { Question } from '../../core/schema/question.ts';
import { SubjectDoc } from '../../core/schema/taxonomy.ts';
import { monthKey } from '../../core/util/time.ts';
import type { DataView } from '../../core/validation/contribution.ts';

/**
 * Acceso a la copia de trabajo de la rama `data`.
 *
 * Todo lo leído se valida: un documento roto o manipulado se aparta a `quarantined` y no llega
 * al resto. Así un fichero malo, aunque alguien lo cuele con un commit directo, no tumba el
 * despliegue de todos.
 */

export interface Quarantined {
  path: string;
  reason: string;
}

async function walk(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function questionPath(question: { id: string; subjectId: string }): string {
  return `questions/${question.subjectId}/${question.id}.json`;
}

export class DataStore implements DataView {
  readonly root: string;
  questions = new Map<string, Question>();
  subjectDocs = new Map<string, SubjectDoc>();
  users = new Map<string, UserDoc>();
  banned = new Set<string>();
  hidden = new Set<string>();
  trusted = new Set<string>();
  retired = new Set<string>();
  images = new Set<string>();
  quarantined: Quarantined[] = [];

  constructor(root: string) {
    this.root = root;
  }

  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  private rel(path: string): string {
    return relative(this.root, path);
  }

  private async readValidated<T>(path: string, schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } } }): Promise<T | null> {
    try {
      const parsed = schema.safeParse(migrateDocument(JSON.parse(await readFile(path, 'utf8'))));
      if (parsed.success) return parsed.data;
      this.quarantined.push({ path: this.rel(path), reason: parsed.error.message.slice(0, 300) });
    } catch (error) {
      this.quarantined.push({ path: this.rel(path), reason: (error as Error).message.slice(0, 300) });
    }
    return null;
  }

  async load(): Promise<this> {
    this.questions.clear();
    this.subjectDocs.clear();
    this.users.clear();
    this.images.clear();
    this.quarantined = [];

    for (const file of await walk(this.path('taxonomy'))) {
      if (!file.endsWith('.json')) continue;
      const doc = await this.readValidated(file, SubjectDoc);
      if (!doc) continue;
      // El nombre del fichero y el contenido deben coincidir: si no, alguien lo movió a mano.
      if (this.rel(file) !== `taxonomy/${doc.id}.json`) {
        this.quarantined.push({ path: this.rel(file), reason: 'El nombre no coincide con su id' });
        continue;
      }
      this.subjectDocs.set(doc.id, doc);
    }

    for (const file of await walk(this.path('questions'))) {
      if (!file.endsWith('.json')) continue;
      const doc = await this.readValidated(file, Question);
      if (!doc) continue;
      if (this.rel(file) !== questionPath(doc)) {
        this.quarantined.push({ path: this.rel(file), reason: 'La ruta no coincide con su asignatura e id' });
        continue;
      }
      this.questions.set(doc.id, doc);
    }

    for (const file of await walk(this.path('users'))) {
      if (!file.endsWith('.json')) continue;
      const doc = await this.readValidated(file, UserDoc);
      if (!doc) continue;
      if (this.rel(file) !== `users/${doc.login}.json`) {
        this.quarantined.push({ path: this.rel(file), reason: 'El nombre no coincide con su login' });
        continue;
      }
      this.users.set(doc.login, doc);
    }

    for (const file of await walk(this.path('images'))) this.images.add(this.rel(file).slice('images/'.length));

    const logins = async (name: string, schema: typeof BannedFile) => {
      const path = this.path('moderation', name);
      if (!existsSync(path)) return new Set<string>();
      return new Set((await this.readValidated(path, schema))?.logins ?? []);
    };
    const ids = async (name: string, schema: typeof HiddenFile) => {
      const path = this.path('moderation', name);
      if (!existsSync(path)) return new Set<string>();
      return new Set((await this.readValidated(path, schema))?.questions ?? []);
    };
    this.banned = await logins('banned.json', BannedFile);
    this.trusted = await logins('trusted.json', TrustedFile);
    this.hidden = await ids('hidden.json', HiddenFile);
    this.retired = await ids('retired.json', RetiredFile);
    return this;
  }

  // DataView
  question(id: string): Question | null {
    return this.questions.get(id) ?? null;
  }

  subject(id: string): SubjectDoc | null {
    return this.subjectDocs.get(id) ?? null;
  }

  subjects(): SubjectDoc[] {
    return [...this.subjectDocs.values()];
  }

  duplicateEntries(): DuplicateIndexEntry[] {
    return [...this.questions.values()].filter((q) => !this.hidden.has(q.id) && !this.retired.has(q.id)).map(duplicateIndexEntry);
  }

  imageExists(hash: string, ext: string): boolean {
    return this.images.has(`${hash}.${ext}`);
  }

  isRetired(id: string): boolean {
    return this.retired.has(id);
  }

  // Escritura
  async putQuestion(question: Question): Promise<void> {
    const previous = this.questions.get(question.id);
    if (previous && previous.subjectId !== question.subjectId) await rm(this.path(questionPath(previous)), { force: true });
    await writeJson(this.path(questionPath(question)), question);
    this.questions.set(question.id, question);
  }

  async putSubject(subject: SubjectDoc): Promise<void> {
    await writeJson(this.path('taxonomy', `${subject.id}.json`), subject);
    this.subjectDocs.set(subject.id, subject);
  }

  async putImage(hash: string, ext: string, bytes: Uint8Array): Promise<void> {
    const path = this.path('images', `${hash}.${ext}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    this.images.add(`${hash}.${ext}`);
  }

  async putUser(user: UserDoc): Promise<void> {
    await writeJson(this.path('users', `${user.login}.json`), user);
    this.users.set(user.login, user);
  }

  async addRetired(questionId: string): Promise<void> {
    this.retired.add(questionId);
    await writeJson(this.path('moderation', 'retired.json'), { questions: [...this.retired].sort() });
  }

  // Eventos: ficheros sólo de añadir, uno por usuario y mes de recepción.
  private eventFile(login: string, rcvMs: number): string {
    const month = monthKey(rcvMs);
    return this.path('events', month.slice(0, 4), month.slice(5), `${login}.jsonl`);
  }

  async appendAnswers(login: string, events: readonly StoredAnswerEvent[]): Promise<void> {
    const byFile = new Map<string, string[]>();
    for (const event of events) {
      const file = this.eventFile(login, event.rcv * 1000);
      const lines = byFile.get(file) ?? [];
      lines.push(JSON.stringify(event));
      byFile.set(file, lines);
    }
    for (const [file, lines] of byFile) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${lines.join('\n')}\n`);
    }
  }

  async readUserAnswers(login: string, months: readonly string[]): Promise<StoredAnswerEvent[]> {
    const out: StoredAnswerEvent[] = [];
    for (const month of months) {
      const file = this.path('events', month.slice(0, 4), month.slice(5), `${login}.jsonl`);
      if (!existsSync(file)) continue;
      out.push(...parseLines(await readFile(file, 'utf8'), StoredAnswerEvent));
    }
    return out;
  }

  /** Recorre todo el registro. Una línea inválida se salta: el resto del fichero sigue valiendo. */
  async *allAnswers(): AsyncGenerator<{ login: string; events: StoredAnswerEvent[] }> {
    for (const file of await walk(this.path('events'))) {
      if (!file.endsWith('.jsonl')) continue;
      const login = file.slice(file.lastIndexOf('/') + 1, -'.jsonl'.length);
      const text = await readFile(file, 'utf8');
      const events = parseLines(text, StoredAnswerEvent);
      const lines = text.split('\n').filter(Boolean).length;
      if (events.length !== lines) this.quarantined.push({ path: this.rel(file), reason: `${lines - events.length} líneas no válidas` });
      yield { login, events };
    }
  }

  async appendSystemEvent(event: SystemEvent): Promise<void> {
    const month = monthKey(event.at * 1000);
    const file = this.path('system-events', month.slice(0, 4), `${month.slice(5)}.jsonl`);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`);
  }

  async allSystemEvents(): Promise<SystemEvent[]> {
    const out: SystemEvent[] = [];
    for (const file of await walk(this.path('system-events'))) {
      if (file.endsWith('.jsonl')) out.push(...parseLines(await readFile(file, 'utf8'), SystemEvent));
    }
    return out;
  }

  // Competiciones
  async putCompetition(competition: Competition): Promise<void> {
    await writeJson(this.path('competitions', competition.id, 'competition.json'), competition);
  }

  async readCompetition(id: string): Promise<Competition | null> {
    const path = this.path('competitions', id, 'competition.json');
    return existsSync(path) ? this.readValidated(path, Competition) : null;
  }

  async allCompetitions(): Promise<Competition[]> {
    const root = this.path('competitions');
    if (!existsSync(root)) return [];
    const out: Competition[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const competition = await this.readCompetition(entry.name);
      if (competition?.id === entry.name) out.push(competition);
    }
    return out;
  }

  private entryFile(competitionId: string, login: string, round?: number): string {
    return this.path('competitions', competitionId, 'entries', `${login}${round === undefined ? '' : `.r${round}`}.json`);
  }

  entryExists(competitionId: string, login: string, round?: number): boolean {
    return existsSync(this.entryFile(competitionId, login, round));
  }

  async putEntry(entry: CompetitionEntry): Promise<void> {
    await writeJson(this.entryFile(entry.competitionId, entry.user.login, entry.round), entry);
  }

  async readEntries(competitionId: string): Promise<CompetitionEntry[]> {
    const out: CompetitionEntry[] = [];
    for (const file of await walk(this.path('competitions', competitionId, 'entries'))) {
      const entry = await this.readValidated(file, CompetitionEntry);
      if (entry?.competitionId === competitionId) out.push(entry);
    }
    return out;
  }

  async putRegistration(registration: CompetitionRegistration): Promise<void> {
    await writeJson(this.path('competitions', registration.competitionId, 'registrations', `${registration.user.login}.json`), registration);
  }

  async readRegistrations(competitionId: string): Promise<CompetitionRegistration[]> {
    const out: CompetitionRegistration[] = [];
    for (const file of await walk(this.path('competitions', competitionId, 'registrations'))) {
      const registration = await this.readValidated(file, CompetitionRegistration);
      if (registration?.competitionId === competitionId) out.push(registration);
    }
    return out.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.user.login.localeCompare(b.user.login));
  }

  async imagePaths(): Promise<string[]> {
    return walk(this.path('images'));
  }

  async fileSize(path: string): Promise<number> {
    return (await stat(path)).size;
  }
}

function parseLines<T>(text: string, schema: { safeParse(data: unknown): { success: true; data: T } | { success: false } }): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) out.push(parsed.data);
    } catch {
      /* Línea corrupta: se ignora, las demás siguen valiendo. */
    }
  }
  return out;
}
