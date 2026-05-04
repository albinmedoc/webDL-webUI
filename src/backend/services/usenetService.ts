import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { eq, inArray, desc, like, and, sql, type SQL } from 'drizzle-orm';

import { usenetConfig } from '../config/usenetConfig.js';
import { getDb } from '../db/client.js';
import {
  usenetJobs,
  TERMINAL_STATES,
  type NewUsenetJob,
  type ReleaseType,
  type UsenetJob,
  type UsenetJobState,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';

import {
  appendLine as appendLogLine,
  unlinkLogFile,
  usenetLogPath,
} from './jobLogService.js';
import { checkDiskSpace } from './usenet/diskspace.js';
import { removeNzbFile } from './usenet/nzbFiles.js';
import { generatePassword } from './usenet/password.js';
import { runPipeline, type PipelineEvents } from './usenet/pipeline.js';
import { detectNewznabCategory } from './usenet/releaseNamer.js';
import { getWorkRoot } from './usenet/workspace.js';

export interface EnqueueJobInput {
  downloadId?: string | null;
  /**
   * For single-file jobs: path to the file. For season packs: a *canonical*
   * path whose basename drives the RAR/NZB names — does not need to exist on
   * disk; the actual sources come from `mediaPaths`.
   */
  mediaPath: string;
  /**
   * When populated, the job is a season pack. Every entry must point at a
   * real file; the job's `mediaSizeBytes` is the sum of all of them.
   */
  mediaPaths?: string[] | null;
  releaseType?: ReleaseType;
  episodeCount?: number | null;
  category?: string | null;
}

export interface ActivePipelineMeta {
  jobId: string;
  abort: AbortController;
}

export type JobObserverEvent = 'enqueued' | 'state' | 'progress' | 'log';

export type JobObserver = (jobId: string, event: JobObserverEvent, payload: unknown) => void;

const active = new Map<string, ActivePipelineMeta>();
const observers = new Set<JobObserver>();

const LOG_LIMIT = 200;

function parseLogs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendLog(jobId: string, line: string): void {
  const db = getDb();
  const row = db
    .select({ logs: usenetJobs.logs })
    .from(usenetJobs)
    .where(eq(usenetJobs.id, jobId))
    .get();
  if (!row) return;
  const next = [...parseLogs(row.logs), line].slice(-LOG_LIMIT);
  db.update(usenetJobs)
    .set({ logs: JSON.stringify(next), updatedAt: Date.now() })
    .where(eq(usenetJobs.id, jobId))
    .run();
  appendLogLine(usenetLogPath(jobId), line);
}

function notify(jobId: string, event: JobObserverEvent, payload: unknown): void {
  if (event === 'log' && typeof payload === 'string') {
    try {
      appendLog(jobId, payload);
    } catch (err) {
      logger.warn('appendLog failed', { jobId, error: (err as Error).message });
    }
  }
  for (const cb of observers) {
    try {
      cb(jobId, event, payload);
    } catch (err) {
      logger.warn('observer threw', { error: (err as Error).message });
    }
  }
}

export function subscribe(observer: JobObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function listJobs(limit = 100): UsenetJob[] {
  return getDb().select().from(usenetJobs).orderBy(desc(usenetJobs.createdAt)).limit(limit).all();
}

export interface ListJobsQuery {
  page?: number;
  pageSize?: number;
  state?: UsenetJobState | null;
  search?: string | null;
}

export interface ListJobsResult {
  jobs: UsenetJob[];
  total: number;
  page: number;
  pageSize: number;
}

export function listJobsPaginated(query: ListJobsQuery = {}): ListJobsResult {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (query.state) conditions.push(eq(usenetJobs.state, query.state));
  if (query.search && query.search.trim().length > 0) {
    const escaped = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(like(usenetJobs.mediaPath, `%${escaped}%`));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const jobs = getDb()
    .select()
    .from(usenetJobs)
    .where(whereClause)
    .orderBy(desc(usenetJobs.createdAt))
    .limit(pageSize)
    .offset(offset)
    .all();

  const totalRow = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(usenetJobs)
    .where(whereClause)
    .get();
  const total = Number(totalRow?.count ?? 0);

  return { jobs, total, page, pageSize };
}

export function getJob(jobId: string): UsenetJob | null {
  return getDb().select().from(usenetJobs).where(eq(usenetJobs.id, jobId)).get() ?? null;
}

export function findJobsByMediaPath(mediaPath: string): UsenetJob[] {
  return getDb().select().from(usenetJobs).where(eq(usenetJobs.mediaPath, mediaPath)).all();
}

export function isActive(jobId: string): boolean {
  return active.has(jobId);
}

export function activeCount(): number {
  return active.size;
}

interface StatResult {
  size: number;
  /** null = stat succeeded; otherwise the errno code (ENOENT, EACCES, etc.) */
  errorCode: string | null;
}

async function statSize(filePath: string): Promise<StatResult> {
  try {
    const stat = await fs.stat(filePath);
    return { size: Number(stat.size), errorCode: null };
  } catch (err) {
    return { size: 0, errorCode: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' };
  }
}

function describeStatFailure(filePath: string, result: StatResult, label: string): string {
  if (result.errorCode === 'ENOENT') {
    return `${label} not found on disk: ${filePath}`;
  }
  if (result.errorCode) {
    return `${label} stat failed (${result.errorCode}): ${filePath}`;
  }
  return `${label} is empty (0 bytes): ${filePath}`;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<UsenetJob> {
  if (!usenetConfig.enabled) {
    throw new Error('Usenet feature is disabled (USENET_ENABLED=false)');
  }

  const id = randomUUID();
  const now = Date.now();

  const isPack = Array.isArray(input.mediaPaths) && input.mediaPaths.length > 0;
  let mediaSize = 0;
  if (isPack) {
    for (const p of input.mediaPaths!) {
      const result = await statSize(p);
      if (result.size <= 0) {
        throw new Error(describeStatFailure(p, result, 'pack member'));
      }
      mediaSize += result.size;
    }
  } else {
    const result = await statSize(input.mediaPath);
    if (result.size <= 0) {
      throw new Error(describeStatFailure(input.mediaPath, result, 'mediaPath'));
    }
    mediaSize = result.size;
  }

  const workRoot = getWorkRoot();
  await fs.mkdir(workRoot, { recursive: true });
  const disk = await checkDiskSpace(workRoot, mediaSize, usenetConfig.minFreeDiskMultiplier);
  if (!disk.ok) {
    throw new Error(disk.reason ?? 'disk space check failed');
  }

  const password = generatePassword(16);
  const releaseType: ReleaseType = input.releaseType ?? (isPack ? 'season' : 'single');

  const newJob: NewUsenetJob = {
    id,
    downloadId: input.downloadId ?? null,
    mediaPath: input.mediaPath,
    mediaPaths: isPack ? JSON.stringify(input.mediaPaths) : null,
    releaseType,
    episodeCount: input.episodeCount ?? (isPack ? input.mediaPaths!.length : null),
    mediaSizeBytes: mediaSize,
    state: 'queued',
    failureState: null,
    progress: 0,
    rarPassword: password,
    nzbPath: null,
    error: null,
    indexerResponse: null,
    category: input.category ?? detectNewznabCategory(path.basename(input.mediaPath)),
    createdAt: now,
    updatedAt: now,
  };

  getDb().insert(usenetJobs).values(newJob).run();
  logger.info('Usenet job enqueued', {
    id,
    mediaPath: input.mediaPath,
    mediaSizeBytes: mediaSize,
    releaseType,
    fileCount: isPack ? input.mediaPaths!.length : 1,
  });

  const enqueueLabel = isPack
    ? `Season pack enqueued: ${path.basename(input.mediaPath)} (${input.mediaPaths!.length} files, ${mediaSize} bytes)`
    : `Job enqueued: ${path.basename(input.mediaPath)} (${mediaSize} bytes)`;
  notify(id, 'log', enqueueLabel);
  notify(id, 'enqueued', null);
  scheduleNext();

  return getJob(id)!;
}

function pickNextQueued(): UsenetJob | null {
  return (
    getDb()
      .select()
      .from(usenetJobs)
      .where(eq(usenetJobs.state, 'queued'))
      .orderBy(usenetJobs.createdAt)
      .limit(1)
      .get() ?? null
  );
}

function scheduleNext(): void {
  while (active.size < usenetConfig.maxConcurrent) {
    const next = pickNextQueued();
    // pickNextQueued reads `state = 'queued'` from the DB, but startJob only
    // transitions out of 'queued' asynchronously (inside the pipeline). So the
    // same row can come back here on subsequent iterations until the pipeline
    // takes its first step. Bail out if we can't make progress on this row.
    if (!next || active.has(next.id)) return;
    startJob(next.id);
  }
}

function startJob(jobId: string): void {
  if (active.has(jobId)) return;

  const abort = new AbortController();
  active.set(jobId, { jobId, abort });

  const events: PipelineEvents = {
    onStateChanged: (state) => notify(jobId, 'state', state),
    onProgress: (progress) => notify(jobId, 'progress', progress),
    onLog: (line) => notify(jobId, 'log', line),
  };

  runPipeline({ jobId, signal: abort.signal, events })
    .catch((err) => {
      logger.error('runPipeline rejected unexpectedly', { jobId, error: (err as Error).message });
    })
    .finally(() => {
      active.delete(jobId);
      scheduleNext();
    });
}

export function cancelJob(jobId: string): { cancelled: boolean; reason?: string } {
  const job = getJob(jobId);
  if (!job) return { cancelled: false, reason: 'not found' };
  if (TERMINAL_STATES.includes(job.state)) {
    return { cancelled: false, reason: `already ${job.state}` };
  }

  const meta = active.get(jobId);
  if (meta) {
    // Pipeline is running — abort propagates into rar/parpar/nyuu and the
    // pipeline's own catch transitions the job to `cancelled`.
    meta.abort.abort();
    return { cancelled: true };
  }

  // Non-terminal but not active: queued, or stale state from a crash before
  // recovery ran. Mark cancelled directly.
  getDb()
    .update(usenetJobs)
    .set({
      state: 'cancelled',
      updatedAt: Date.now(),
      error: job.state === 'queued' ? 'cancelled before start' : 'cancelled',
    })
    .where(eq(usenetJobs.id, jobId))
    .run();
  notify(jobId, 'state', 'cancelled');
  return { cancelled: true };
}

async function waitForJobInactive(jobId: string, timeoutMs = 30_000): Promise<void> {
  if (!isActive(jobId)) return;
  const start = Date.now();
  while (isActive(jobId)) {
    if (Date.now() - start > timeoutMs) {
      logger.warn('Timed out waiting for usenet job to wind down', { jobId });
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function retryJob(jobId: string): { retried: boolean; reason?: string } {
  const job = getJob(jobId);
  if (!job) return { retried: false, reason: 'not found' };
  if (job.state !== 'failed') return { retried: false, reason: `cannot retry ${job.state}` };
  if (active.has(jobId)) return { retried: false, reason: 'already running' };

  const resumeFrom: UsenetJobState =
    job.failureState === 'indexing' && job.nzbPath ? 'indexing' : 'archiving';

  getDb()
    .update(usenetJobs)
    .set({
      state: resumeFrom,
      failureState: null,
      error: null,
      progress: 0,
      updatedAt: Date.now(),
    })
    .where(eq(usenetJobs.id, jobId))
    .run();

  // The pipeline's first setState() will emit the resumeFrom state — don't
  // double-emit here. We persist the state above so the pipeline can pick
  // the right resume point.
  startJob(jobId);
  return { retried: true };
}

export async function deleteJob(
  jobId: string,
): Promise<{ deleted: boolean; reason?: string; state?: UsenetJobState }> {
  const job = getJob(jobId);
  if (!job) return { deleted: false, reason: 'not found' };

  // Cancel in-flight before deleting so the pipeline doesn't write to a row
  // we're about to remove, and child processes (rar/parpar/nyuu) get killed.
  if (!TERMINAL_STATES.includes(job.state)) {
    const cancelResult = cancelJob(jobId);
    if (!cancelResult.cancelled) {
      return {
        deleted: false,
        reason: cancelResult.reason ?? 'cancel failed',
        state: job.state,
      };
    }
    await waitForJobInactive(jobId);
  }

  const final = getJob(jobId);
  if (final?.nzbPath) await removeNzbFile(final.nzbPath);
  await unlinkLogFile(usenetLogPath(jobId));

  getDb().delete(usenetJobs).where(eq(usenetJobs.id, jobId)).run();
  logger.info('Usenet job deleted', { id: jobId });
  return { deleted: true };
}

export interface BulkDeleteResult {
  deleted: string[];
  skipped: { id: string; reason: string; state?: UsenetJobState }[];
}

export async function deleteJobs(jobIds: string[]): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: [], skipped: [] };
  for (const id of jobIds) {
    const r = await deleteJob(id);
    if (r.deleted) {
      result.deleted.push(id);
    } else {
      result.skipped.push({ id, reason: r.reason ?? 'unknown', state: r.state });
    }
  }
  return result;
}

export function startupKick(): void {
  const queued = getDb().select().from(usenetJobs).where(inArray(usenetJobs.state, ['queued'])).all();
  if (queued.length === 0) return;
  logger.info('Startup: kicking queued Usenet jobs', { count: queued.length });
  scheduleNext();
}
