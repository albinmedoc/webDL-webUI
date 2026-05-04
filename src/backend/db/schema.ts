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

export const RELEASE_TYPES = ['single', 'season'] as const;
export type ReleaseType = (typeof RELEASE_TYPES)[number];

export const usenetJobs = sqliteTable('usenet_jobs', {
  id: text('id').primaryKey(),
  downloadId: text('download_id'),
  mediaPath: text('media_path').notNull(),
  // JSON-encoded array of paths for season packs. null/empty for single-file
  // jobs, in which case `mediaPath` is the source of truth. When populated,
  // `mediaPath` is the *primary* file used for naming/baseName/category.
  mediaPaths: text('media_paths'),
  releaseType: text('release_type', { enum: RELEASE_TYPES }).notNull().default('single'),
  episodeCount: integer('episode_count'),
  mediaSizeBytes: integer('media_size_bytes').notNull(),
  state: text('state', { enum: USENET_JOB_STATES }).notNull().default('queued'),
  failureState: text('failure_state', { enum: USENET_JOB_STATES }),
  progress: integer('progress').notNull().default(0),
  rarPassword: text('rar_password').notNull(),
  nzbPath: text('nzb_path'),
  error: text('error'),
  indexerResponse: text('indexer_response'),
  category: text('category'),
  logs: text('logs'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type UsenetJob = typeof usenetJobs.$inferSelect;
export type NewUsenetJob = typeof usenetJobs.$inferInsert;

export const DOWNLOAD_JOB_STATES = [
  'pending',
  'downloading',
  'completed',
  'error',
  'cancelled',
] as const;

export type DownloadJobState = (typeof DOWNLOAD_JOB_STATES)[number];

export const DOWNLOAD_NON_TERMINAL_STATES: DownloadJobState[] = ['pending', 'downloading'];

export const downloadJobs = sqliteTable('download_jobs', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  status: text('status', { enum: DOWNLOAD_JOB_STATES }).notNull().default('pending'),
  progress: integer('progress').notNull().default(0),
  resolution: integer('resolution'),
  allEpisodes: integer('all_episodes', { mode: 'boolean' }).notNull().default(false),
  autoPostUsenet: integer('auto_post_usenet', { mode: 'boolean' }).notNull().default(false),
  autoPackSeason: integer('auto_pack_season', { mode: 'boolean' }).notNull().default(false),
  output: text('output'),
  error: text('error'),
  outputDir: text('output_dir'),
  files: text('files'),
  logs: text('logs'),
  startTime: integer('start_time'),
  endTime: integer('end_time'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type DownloadJobRow = typeof downloadJobs.$inferSelect;
export type NewDownloadJobRow = typeof downloadJobs.$inferInsert;

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const WEBHOOK_EVENTS = [
  'download.queued',
  'download.started',
  'download.completed',
  'download.failed',
  'download.cancelled',
  'usenet.queued',
  'usenet.posted',
  'usenet.done',
  'usenet.failed',
  'usenet.cancelled',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  // HMAC-SHA256 secret. Empty string = no signature header sent.
  secret: text('secret').notNull().default(''),
  // JSON-encoded array of WebhookEvent strings. Empty array = subscribe to all.
  events: text('events').notNull().default('[]'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // Optional extra headers, JSON-encoded { name: value } map.
  headers: text('headers'),
  description: text('description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type WebhookRow = typeof webhooks.$inferSelect;
export type NewWebhookRow = typeof webhooks.$inferInsert;

export const WEBHOOK_DELIVERY_STATES = [
  'pending',
  'delivered',
  'retrying',
  'failed',
] as const;

export type WebhookDeliveryState = (typeof WEBHOOK_DELIVERY_STATES)[number];

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  event: text('event').notNull(),
  payload: text('payload').notNull(),
  state: text('state', { enum: WEBHOOK_DELIVERY_STATES }).notNull().default('pending'),
  attempt: integer('attempt').notNull().default(0),
  statusCode: integer('status_code'),
  responseSnippet: text('response_snippet'),
  error: text('error'),
  // Wall-clock ms timestamp the next retry should fire at. NULL once delivered/failed.
  nextRetryAt: integer('next_retry_at'),
  deliveredAt: integer('delivered_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
