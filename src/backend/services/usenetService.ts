import { randomUUID } from 'crypto';
import fs from 'fs/promises';

import { eq, inArray, desc } from 'drizzle-orm';

import { usenetConfig } from '../config/usenetConfig.js';
import { getDb } from '../db/client.js';
import {
  usenetJobs,
  TERMINAL_STATES,
  type NewUsenetJob,
  type UsenetJob,
  type UsenetJobState,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';

import { generatePassword } from './usenet/password.js';
import { runPipeline, type PipelineEvents } from './usenet/pipeline.js';

export interface EnqueueJobInput {
  downloadId?: string | null;
  mediaPath: string;
  category?: string | null;
}

export interface ActivePipelineMeta {
  jobId: string;
  abort: AbortController;
}

export type JobObserver = (jobId: string, event: 'state' | 'progress' | 'log', payload: unknown) => void;

const active = new Map<string, ActivePipelineMeta>();
const observers = new Set<JobObserver>();

function notify(jobId: string, event: 'state' | 'progress' | 'log', payload: unknown): void {
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

export function getJob(jobId: string): UsenetJob | null {
  return getDb().select().from(usenetJobs).where(eq(usenetJobs.id, jobId)).get() ?? null;
}

export function isActive(jobId: string): boolean {
  return active.has(jobId);
}

export function activeCount(): number {
  return active.size;
}

async function statSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return Number(stat.size);
  } catch {
    return 0;
  }
}

export async function enqueueJob(input: EnqueueJobInput): Promise<UsenetJob> {
  if (!usenetConfig.enabled) {
    throw new Error('Usenet feature is disabled (USENET_ENABLED=false)');
  }

  const id = randomUUID();
  const now = Date.now();
  const mediaSize = await statSize(input.mediaPath);
  const password = generatePassword(16);

  const newJob: NewUsenetJob = {
    id,
    downloadId: input.downloadId ?? null,
    mediaPath: input.mediaPath,
    mediaSizeBytes: mediaSize,
    state: 'queued',
    failureState: null,
    progress: 0,
    rarPassword: password,
    nzbPath: null,
    error: null,
    indexerResponse: null,
    category: input.category ?? null,
    createdAt: now,
    updatedAt: now,
  };

  getDb().insert(usenetJobs).values(newJob).run();
  logger.info('Usenet job enqueued', { id, mediaPath: input.mediaPath, mediaSizeBytes: mediaSize });

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
  if (active.size >= usenetConfig.maxConcurrent) return;
  const next = pickNextQueued();
  if (!next) return;
  startJob(next.id);
  if (active.size < usenetConfig.maxConcurrent) {
    scheduleNext();
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
  const meta = active.get(jobId);
  if (meta) {
    meta.abort.abort();
    return { cancelled: true };
  }

  const job = getJob(jobId);
  if (!job) return { cancelled: false, reason: 'not found' };

  if (TERMINAL_STATES.includes(job.state)) {
    return { cancelled: false, reason: `already ${job.state}` };
  }

  if (job.state === 'queued') {
    getDb()
      .update(usenetJobs)
      .set({ state: 'cancelled', updatedAt: Date.now(), error: 'cancelled before start' })
      .where(eq(usenetJobs.id, jobId))
      .run();
    notify(jobId, 'state', 'cancelled');
    return { cancelled: true };
  }

  return { cancelled: false, reason: `unsupported state ${job.state}` };
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

export function startupKick(): void {
  const queued = getDb().select().from(usenetJobs).where(inArray(usenetJobs.state, ['queued'])).all();
  if (queued.length === 0) return;
  logger.info('Startup: kicking queued Usenet jobs', { count: queued.length });
  scheduleNext();
}
