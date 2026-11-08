import Dexie, { type Table } from 'dexie';
import type { SubjectDoc } from '@core/schema/taxonomy';
import type {
  AttemptRow,
  CommunityQuestionRow,
  DerivedCompetitionRow,
  DerivedProfileRow,
  DraftRow,
  ExamRow,
  KvRow,
  LeaderboardRow,
  LocalImageRow,
  LocalQuestionRow,
  LocalSubjectRow,
  OutboxRow,
  ProgressRow,
  QuestionStatsRow,
  SessionRow,
  ShardRow,
  SyncLogRow,
} from './types';

/**
 * Base de datos del dispositivo. Las migraciones de IndexedDB se declaran añadiendo
 * `version(n)`; Dexie las aplica en orden y nunca hay que reescribir las anteriores.
 */
export class QuestionBankDb extends Dexie {
  // Local
  lSubjects!: Table<LocalSubjectRow, string>;
  lQuestions!: Table<LocalQuestionRow, string>;
  drafts!: Table<DraftRow, string>;
  localImages!: Table<LocalImageRow, string>;
  attempts!: Table<AttemptRow, string>;
  sessions!: Table<SessionRow, string>;
  progress!: Table<ProgressRow, string>;
  exams!: Table<ExamRow, string>;
  outbox!: Table<OutboxRow, string>;
  kv!: Table<KvRow, string>;
  // Comunitaria
  cSubjects!: Table<SubjectDoc, string>;
  cQuestions!: Table<CommunityQuestionRow, string>;
  // Derivada
  dProfiles!: Table<DerivedProfileRow, string>;
  dLeaderboards!: Table<LeaderboardRow, string>;
  dCompetitions!: Table<DerivedCompetitionRow, string>;
  dQuestionStats!: Table<QuestionStatsRow, string>;
  // Sincronización
  shards!: Table<ShardRow, string>;
  syncLog!: Table<SyncLogRow, number>;

  constructor(name = 'questionbank') {
    super(name);
    this.version(1).stores({
      lSubjects: 'id',
      lQuestions: 'id, subjectId, *topicIds, type, difficulty, updatedAt, local.syncState',
      drafts: 'id, updatedAt',
      localImages: 'hash',
      attempts: 'id, questionId, sessionId, subjectId, at, published, [questionId+at]',
      sessions: 'id, state, startedAt, competitionId',
      progress: 'questionId, due, favorite, hard, lastAt',
      outbox: 'id, status, kind, createdAt, nonce',
      kv: 'key',
      cSubjects: 'id',
      cQuestions: 'id, subjectId, *topicIds, type, difficulty, updatedAt, shardId',
      dProfiles: 'login',
      dLeaderboards: 'id',
      dCompetitions: 'id, code, type, closesAt',
      dQuestionStats: 'questionId',
      shards: 'id, kind',
      syncLog: '++seq, at',
    });
    this.version(2).stores({ exams: 'id, date, subjectId' });
  }
}

export const db = new QuestionBankDb();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function kvDelete(key: string): Promise<void> {
  await db.kv.delete(key);
}
