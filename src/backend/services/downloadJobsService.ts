import { randomUUID } from 'crypto';

import { eq, inArray, desc, lt, and, ne, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  downloadJobs,
  DOWNLOAD_NON_TERMINAL_STATES,
  type DownloadJobRow,
  type DownloadJobState,
  type NewDownloadJobRow,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { appendLine as appendLogLine, downloadLogPath } from './jobLogService.js';

// DB stores only the most recent slice for live tail / sync payload size.
// Full history lives on disk via jobLogService.
const LOG_LIMIT = 50;

export type DownloadJobEvent =
  | { type: 'upserted'; job: DownloadJob }
  | { type: 'deleted'; id: string }
  | { type: 'reset' };

export type DownloadJobObserver = (event: DownloadJobEvent) => void;

const observers = new Set<DownloadJobObserver>();

export function subscribe(observer: DownloadJobObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

function notify(event: DownloadJobEvent): void {
  for (const cb of observers) {
    try {
      cb(event);
    } catch (err) {
      logger.warn('download-jobs observer threw', { error: (err as Error).message });
    }
  }
}

function notifyUpserted(id: string): void {
  const job = getJob(id);
  if (job) notify({ type: 'upserted', job });
}

export interface DownloadFile {
  path: string;
  size: number;
}

export interface DownloadJob {
  id: string;
  url: string;
  status: DownloadJobState;
  progress: number;
  resolution: number | null;
  allEpisodes: boolean;
  autoPostUsenet: boolean;
  autoPackSeason: boolean;
  output: string | null;
  error: string | null;
  outputDir: string | null;
  files: DownloadFile[];
  logs: string[];
  startTime: number | null;
  endTime: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDownloadJobInput {
  url: string;
  resolution?: number | null;
  allEpisodes?: boolean;
  autoPostUsenet?: boolean;
  autoPackSeason?: boolean;
}

export interface UpdateDownloadJobFields {
  status?: DownloadJobState;
  progress?: number;
  output?: string | null;
  error?: string | null;
  outputDir?: string | null;
  files?: DownloadFile[];
  startTime?: number | null;
  endTime?: number | null;
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToJob(row: DownloadJobRow): DownloadJob {
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    progress: row.progress,
    resolution: row.resolution,
    allEpisodes: row.allEpisodes,
    autoPostUsenet: row.autoPostUsenet,
    autoPackSeason: row.autoPackSeason,
    output: row.output,
    error: row.error,
    outputDir: row.outputDir,
    files: parseJsonArray<DownloadFile>(row.files),
    logs: parseJsonArray<string>(row.logs),
    startTime: row.startTime,
    endTime: row.endTime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listJobs(limit = 200): DownloadJob[] {
  return getDb()
    .select()
    .from(downloadJobs)
    .orderBy(desc(downloadJobs.createdAt))
    .limit(limit)
    .all()
    .map(rowToJob);
}

export interface ListDownloadJobsQuery {
  page?: number;
  pageSize?: number;
  status?: DownloadJobState | null;
}

export interface ListDownloadJobsResult {
  jobs: DownloadJob[];
  total: number;
  page: number;
  pageSize: number;
}

export function listJobsPaginated(
  query: ListDownloadJobsQuery = {},
): ListDownloadJobsResult {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(downloadJobs.status, query.status));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = getDb()
    .select()
    .from(downloadJobs)
    .where(whereClause)
    .orderBy(desc(downloadJobs.createdAt))
    .limit(pageSize)
    .offset(offset)
    .all();

  const totalRow = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(downloadJobs)
    .where(whereClause)
    .get();
  const total = Number(totalRow?.count ?? 0);

  return { jobs: rows.map(rowToJob), total, page, pageSize };
}

export function getJob(id: string): DownloadJob | null {
  const row = getDb().select().from(downloadJobs).where(eq(downloadJobs.id, id)).get();
  return row ? rowToJob(row) : null;
}

export function createJob(input: CreateDownloadJobInput): DownloadJob {
  const now = Date.now();
  const row: NewDownloadJobRow = {
    id: randomUUID(),
    url: input.url,
    status: 'pending',
    progress: 0,
    resolution: input.resolution ?? null,
    allEpisodes: input.allEpisodes ?? false,
    autoPostUsenet: input.autoPostUsenet ?? false,
    autoPackSeason: input.autoPackSeason ?? false,
    output: null,
    error: null,
    outputDir: null,
    files: '[]',
    logs: '[]',
    startTime: null,
    endTime: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb().insert(downloadJobs).values(row).run();
  const job = rowToJob(row as DownloadJobRow);
  notify({ type: 'upserted', job });
  return job;
}

export function updateJob(id: string, fields: UpdateDownloadJobFields): DownloadJob | null {
  const patch: Partial<NewDownloadJobRow> = { updatedAt: Date.now() };
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.progress !== undefined) patch.progress = fields.progress;
  if (fields.output !== undefined) patch.output = fields.output;
  if (fields.error !== undefined) patch.error = fields.error;
  if (fields.outputDir !== undefined) patch.outputDir = fields.outputDir;
  if (fields.files !== undefined) patch.files = JSON.stringify(fields.files);
  if (fields.startTime !== undefined) patch.startTime = fields.startTime;
  if (fields.endTime !== undefined) patch.endTime = fields.endTime;

  getDb().update(downloadJobs).set(patch).where(eq(downloadJobs.id, id)).run();
  const updated = getJob(id);
  if (updated) notify({ type: 'upserted', job: updated });
  return updated;
}

export function appendLog(id: string, line: string): string[] {
  const row = getDb()
    .select({ logs: downloadJobs.logs })
    .from(downloadJobs)
    .where(eq(downloadJobs.id, id))
    .get();
  if (!row) return [];

  const existing = parseJsonArray<string>(row.logs);
  const next = [...existing, line].slice(-LOG_LIMIT);
  getDb()
    .update(downloadJobs)
    .set({ logs: JSON.stringify(next), updatedAt: Date.now() })
    .where(eq(downloadJobs.id, id))
    .run();
  appendLogLine(downloadLogPath(id), line);
  notifyUpserted(id);
  return next;
}

export function replaceLastProgressLog(id: string, line: string): string[] {
  const row = getDb()
    .select({ logs: downloadJobs.logs })
    .from(downloadJobs)
    .where(eq(downloadJobs.id, id))
    .get();
  if (!row) return [];

  const existing = parseJsonArray<string>(row.logs);
  const progressPattern = /\[\d+\/\d+\]/;
  let replaced = false;
  const next = [...existing];
  for (let i = next.length - 1; i >= 0; i--) {
    if (progressPattern.test(next[i])) {
      next[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) next.push(line);
  const trimmed = next.slice(-LOG_LIMIT);

  getDb()
    .update(downloadJobs)
    .set({ logs: JSON.stringify(trimmed), updatedAt: Date.now() })
    .where(eq(downloadJobs.id, id))
    .run();
  // On-disk log keeps every progress line, no replacement — the file is the
  // full record, the DB is just the live tail.
  appendLogLine(downloadLogPath(id), line);
  notifyUpserted(id);
  return trimmed;
}

export function deleteJob(id: string): DownloadJob | null {
  const existing = getJob(id);
  if (!existing) return null;
  getDb().delete(downloadJobs).where(eq(downloadJobs.id, id)).run();
  notify({ type: 'deleted', id });
  return existing;
}

export function clearCompleted(): DownloadJob[] {
  const db = getDb();
  const targets = db
    .select()
    .from(downloadJobs)
    .where(eq(downloadJobs.status, 'completed'))
    .all()
    .map(rowToJob);
  if (targets.length === 0) return [];
  db.delete(downloadJobs).where(eq(downloadJobs.status, 'completed')).run();
  notify({ type: 'reset' });
  return targets;
}

export function clearOlderThan(daysOld: number): DownloadJob[] {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  // Don't drop active jobs regardless of age.
  const condition = and(
    lt(downloadJobs.createdAt, cutoff),
    ne(downloadJobs.status, 'pending'),
    ne(downloadJobs.status, 'downloading'),
  );
  const db = getDb();
  const targets = db.select().from(downloadJobs).where(condition).all().map(rowToJob);
  if (targets.length === 0) return [];
  db.delete(downloadJobs).where(condition).run();
  notify({ type: 'reset' });
  return targets;
}

export function clearAll(): DownloadJob[] {
  const db = getDb();
  const targets = db.select().from(downloadJobs).all().map(rowToJob);
  if (targets.length === 0) return [];
  db.delete(downloadJobs).run();
  notify({ type: 'reset' });
  return targets;
}

export function recoverInterruptedJobs(): number {
  const db = getDb();

  const stuck = db
    .select({ id: downloadJobs.id, status: downloadJobs.status })
    .from(downloadJobs)
    .where(inArray(downloadJobs.status, DOWNLOAD_NON_TERMINAL_STATES))
    .all();

  if (stuck.length === 0) return 0;

  const now = Date.now();
  for (const row of stuck) {
    db.update(downloadJobs)
      .set({
        status: 'error',
        error: 'Server restart during download',
        endTime: now,
        updatedAt: now,
      })
      .where(eq(downloadJobs.id, row.id))
      .run();
  }

  logger.warn('Recovered interrupted download jobs', { count: stuck.length });
  return stuck.length;
}
