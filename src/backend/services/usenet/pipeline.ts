import fs from 'fs/promises';
import path from 'path';

import { eq } from 'drizzle-orm';

import { indexerConfig, usenetConfig } from '../../config/usenetConfig.js';
import { getDb } from '../../db/client.js';
import { usenetJobs, type UsenetJob, type UsenetJobState } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

import { createArchive } from './archiver.js';
import { checkDiskSpace } from './diskspace.js';
import { runHook } from './indexer.js';
import { generatePar2 } from './par2.js';
import { postToUsenet } from './poster.js';
import { AbortError } from './spawnUtil.js';
import { detectTools } from './tools.js';
import { createJobWorkDir, getJobWorkDir, removeJobWorkDir } from './workspace.js';

export interface PipelineEvents {
  onStateChanged?: (state: UsenetJobState) => void;
  onProgress?: (progress: number) => void;
  onLog?: (line: string) => void;
}

export interface RunPipelineOptions {
  jobId: string;
  signal?: AbortSignal;
  events?: PipelineEvents;
}

export interface PipelineResult {
  finalState: UsenetJobState;
  nzbPath?: string;
}

const PIPELINE_ORDER: UsenetJobState[] = [
  'queued',
  'archiving',
  'par2',
  'posting',
  'posted',
  'indexing',
  'done',
];

class StageError extends Error {
  constructor(message: string, public stage: UsenetJobState) {
    super(message);
    this.name = 'StageError';
  }
}

function ordinal(state: UsenetJobState): number {
  const idx = PIPELINE_ORDER.indexOf(state);
  return idx === -1 ? -1 : idx;
}

function shouldRun(stage: UsenetJobState, currentState: UsenetJobState): boolean {
  return ordinal(currentState) <= ordinal(stage);
}

function deriveBaseName(mediaPath: string): string {
  const ext = path.extname(mediaPath);
  return path.basename(mediaPath, ext);
}

function loadJob(jobId: string): UsenetJob {
  const db = getDb();
  const job = db.select().from(usenetJobs).where(eq(usenetJobs.id, jobId)).get();
  if (!job) throw new Error(`Usenet job ${jobId} not found`);
  return job;
}

function transition(jobId: string, patch: Partial<UsenetJob>): void {
  const db = getDb();
  db.update(usenetJobs)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(usenetJobs.id, jobId))
    .run();
}

async function findExistingFiles(workDir: string, baseName: string): Promise<{ partFiles: string[]; par2Files: string[] }> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(workDir);
  } catch {
    return { partFiles: [], par2Files: [] };
  }
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rarRe = new RegExp(`^${escaped}\\.(rar|part\\d+\\.rar)$`);
  const par2Re = new RegExp(`^${escaped}\\.(par2|vol\\d+\\+\\d+\\.par2)$`);
  return {
    partFiles: entries.filter((n) => rarRe.test(n)).sort().map((n) => path.join(workDir, n)),
    par2Files: entries.filter((n) => par2Re.test(n)).sort().map((n) => path.join(workDir, n)),
  };
}

export async function runPipeline(opts: RunPipelineOptions): Promise<PipelineResult> {
  const { jobId, signal, events } = opts;
  const job = loadJob(jobId);
  const startState = job.state;

  if (startState === 'done' || startState === 'cancelled') {
    return { finalState: startState, nzbPath: job.nzbPath ?? undefined };
  }

  await detectTools();

  const workDir = getJobWorkDir(jobId);
  const baseName = deriveBaseName(job.mediaPath);
  const nzbPath = job.nzbPath ?? path.join(indexerConfig.nzbOutputDir, `${baseName}.nzb`);
  let partFiles: string[] = [];
  let par2Files: string[] = [];
  let postingProgress = 0;

  const setState = (state: UsenetJobState, extra?: Partial<UsenetJob>) => {
    transition(jobId, { state, ...extra });
    events?.onStateChanged?.(state);
  };

  const setProgress = (progress: number) => {
    postingProgress = progress;
    transition(jobId, { progress });
    events?.onProgress?.(progress);
  };

  const log = (line: string) => events?.onLog?.(line);

  try {
    if (shouldRun('archiving', startState)) {
      const workRoot = path.dirname(workDir);
      await fs.mkdir(workRoot, { recursive: true });
      const disk = await checkDiskSpace(
        workRoot,
        job.mediaSizeBytes,
        usenetConfig.minFreeDiskMultiplier
      );
      if (!disk.ok) throw new StageError(disk.reason ?? 'disk space check failed', 'archiving');
      if (signal?.aborted) throw new AbortError();

      setState('archiving');
      await createJobWorkDir(jobId);
      try {
        const result = await createArchive({
          mediaPath: job.mediaPath,
          workDir,
          password: job.rarPassword,
          baseName,
          volumeSizeMb: usenetConfig.rarSizeMb,
          nfoPath: usenetConfig.nfoPath,
          onProgress: log,
          signal,
        });
        partFiles = result.partFiles;
      } catch (err) {
        if (err instanceof AbortError) throw err;
        throw new StageError(`archive failed: ${(err as Error).message}`, 'archiving');
      }
    } else {
      const existing = await findExistingFiles(workDir, baseName);
      partFiles = existing.partFiles;
    }

    if (shouldRun('par2', startState)) {
      setState('par2');
      try {
        const result = await generatePar2({
          inputFiles: partFiles,
          workDir,
          baseName,
          percent: usenetConfig.par2Percent,
          onProgress: log,
          signal,
        });
        par2Files = result.par2Files;
      } catch (err) {
        if (err instanceof AbortError) throw err;
        throw new StageError(`par2 failed: ${(err as Error).message}`, 'par2');
      }
    } else {
      const existing = await findExistingFiles(workDir, baseName);
      par2Files = existing.par2Files;
    }

    if (shouldRun('posting', startState)) {
      setState('posting');
      setProgress(0);
      try {
        await postToUsenet({
          files: [...partFiles, ...par2Files],
          workDir,
          nzbOutPath: nzbPath,
          config: usenetConfig,
          rarPassword: job.rarPassword,
          onProgress: (line) => {
            log(line);
            const m = /(\d+(?:\.\d+)?)\s*%/.exec(line);
            if (m) {
              const pct = Math.min(99, Math.floor(parseFloat(m[1])));
              if (pct !== postingProgress) setProgress(pct);
            }
          },
          signal,
        });
      } catch (err) {
        if (err instanceof AbortError) throw err;
        throw new StageError(`nyuu post failed: ${(err as Error).message}`, 'posting');
      }
      setState('posted', { nzbPath });
    }

    if (shouldRun('indexing', startState)) {
      if (!indexerConfig.hookScript) {
        log('No INDEXER_HOOK_SCRIPT configured — skipping indexing stage');
        logger.info('Skipping indexer stage — no hook configured', { jobId });
      } else {
        setState('indexing');
        try {
          const result = await runHook(
            {
              nzbPath,
              title: baseName,
              category: job.category ?? '',
              password: job.rarPassword,
              group: usenetConfig.groups[0] ?? '',
              mediaPath: job.mediaPath,
            },
            signal,
            (line) => log(`[indexer] ${line}`)
          );
          if (!result.ok) {
            throw new StageError(
              `indexer hook exited ${result.exitCode}: ${result.stderr || result.stdout}`,
              'indexing'
            );
          }
          transition(jobId, { indexerResponse: result.response ?? null });
        } catch (err) {
          if (err instanceof StageError || err instanceof AbortError) throw err;
          throw new StageError(`indexer hook failed: ${(err as Error).message}`, 'indexing');
        }
      }
    }

    setState('done', { progress: 100 });
    await removeJobWorkDir(jobId);
    return { finalState: 'done', nzbPath };
  } catch (err) {
    if (err instanceof AbortError || signal?.aborted) {
      const current = loadJob(jobId).state;
      transition(jobId, { state: 'cancelled', error: 'cancelled by user' });
      events?.onStateChanged?.('cancelled');
      if (current === 'posting') {
        logger.warn(
          `Partial post abandoned on Usenet, ~${postingProgress}% uploaded — articles are orphaned without NZB`,
          { jobId }
        );
      }
      if (current !== 'indexing') {
        await removeJobWorkDir(jobId);
      }
      return { finalState: 'cancelled' };
    }

    const stage: UsenetJobState =
      err instanceof StageError ? err.stage : (loadJob(jobId).state as UsenetJobState);
    const message = (err as Error).message ?? String(err);
    logger.error('Usenet pipeline failed', { jobId, stage, error: message });
    transition(jobId, { state: 'failed', failureState: stage, error: message });
    events?.onStateChanged?.('failed');
    if (stage !== 'indexing') {
      await removeJobWorkDir(jobId);
    }
    return { finalState: 'failed' };
  }
}
