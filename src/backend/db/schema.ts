import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const USENET_JOB_STATES = [
  'queued',
  'archiving',
  'par2',
  'posting',
  'posted',
  'indexing',
  'done',
  'failed',
  'cancelled',
] as const;

export type UsenetJobState = (typeof USENET_JOB_STATES)[number];

export const TERMINAL_STATES: UsenetJobState[] = ['done', 'failed', 'cancelled'];
export const NON_TERMINAL_STATES: UsenetJobState[] = [
  'queued',
  'archiving',
  'par2',
  'posting',
  'posted',
  'indexing',
];

export const usenetJobs = sqliteTable('usenet_jobs', {
  id: text('id').primaryKey(),
  downloadId: text('download_id'),
  mediaPath: text('media_path').notNull(),
  mediaSizeBytes: integer('media_size_bytes').notNull(),
  state: text('state', { enum: USENET_JOB_STATES }).notNull().default('queued'),
  failureState: text('failure_state', { enum: USENET_JOB_STATES }),
  progress: integer('progress').notNull().default(0),
  rarPassword: text('rar_password').notNull(),
  nzbPath: text('nzb_path'),
  error: text('error'),
  indexerResponse: text('indexer_response'),
  category: text('category'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type UsenetJob = typeof usenetJobs.$inferSelect;
export type NewUsenetJob = typeof usenetJobs.$inferInsert;
