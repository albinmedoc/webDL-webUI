import fsp from 'fs/promises';
import path from 'path';

import { config as serverConfig } from '../config/config.js';
import { usenetConfig } from '../config/usenetConfig.js';
import * as downloadService from './downloadService.js';
import * as downloadJobs from './downloadJobsService.js';
import * as outputTracker from './outputTracker.js';
import { dropForUpload } from './uploadWatcher.js';
import {
  isAllowedExtension,
  normalizeExtensions,
} from './usenet/extensionFilter.js';
import { runSeasonPackForDownload } from './usenet/seasonPackEnqueue.js';
import { ProgressParser, ValidationUtils } from '../utils/progressUtils.js';
import { logger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';
import type { DownloadJob } from './downloadJobsService.js';

export interface StartDownloadOptions {
  resolution?: number | null;
  allEpisodes?: boolean;
  autoPostUsenet?: boolean;
  autoPackSeason?: boolean;
}

export interface StartDownloadInput {
  url: string;
  args?: string[];
  options?: StartDownloadOptions;
}

export class DownloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadValidationError';
  }
}

function userSuppliedOutputDir(args: string[]): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-o' || args[i] === '--output') return true;
  }
  return false;
}

/**
 * Kick off a download. Validates synchronously (throws DownloadValidationError),
 * persists the job row, then spawns svtplay-dl in the background. Lifecycle
 * updates flow through downloadJobsService observers — callers that need to
 * react to progress/completion should subscribe there.
 */
export async function startDownload(input: StartDownloadInput): Promise<DownloadJob> {
  const args = input.args ?? [];
  const validation = ValidationUtils.validateDownloadRequest({ url: input.url, args });
  if (!validation.valid) {
    throw new DownloadValidationError(validation.error ?? 'invalid request');
  }

  const opts = input.options ?? {};
  const job = downloadJobs.createJob({
    url: input.url,
    resolution: opts.resolution ?? null,
    allEpisodes: opts.allEpisodes ?? false,
    autoPostUsenet: opts.autoPostUsenet ?? false,
    autoPackSeason: opts.autoPackSeason ?? false,
  });

  logger.info('Starting download', { downloadId: job.id, url: input.url });

  // Run async — caller gets the job row immediately, lifecycle flows via subscribe.
  void runDownload(job.id, input.url, args, opts).catch((err) => {
    logger.error('Download orchestrator failed unexpectedly', {
      downloadId: job.id,
      error: (err as Error).message,
    });
  });

  return job;
}

async function runDownload(
  id: string,
  url: string,
  args: string[],
  opts: StartDownloadOptions,
): Promise<void> {
  try {
    let effectiveArgs = args;
    if (!userSuppliedOutputDir(args)) {
      const perJobDir = path.join(serverConfig.downloadOutputDir, id);
      await fsp.mkdir(perJobDir, { recursive: true });
      effectiveArgs = [...args, '-o', perJobDir];
      downloadJobs.updateJob(id, { outputDir: perJobDir });
    }

    await outputTracker.beforeStart(id, effectiveArgs);

    const downloadInfo = downloadService.startDownload(url, effectiveArgs, id);
    const { process: proc, command } = downloadInfo;

    downloadJobs.updateJob(id, {
      status: 'downloading',
      startTime: Date.now(),
    });
    downloadJobs.appendLog(id, `Started: ${command}`);

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      const { progress } = ProgressParser.parseProgress(chunk);
      if (progress !== null && progress !== undefined) {
        downloadJobs.updateJob(id, {
          progress: Math.min(100, Math.max(0, progress)),
        });
      }
      if (ProgressParser.isSignificantChunk(chunk, progress)) {
        appendLogForChunk(id, chunk);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();

      if (ProgressParser.isProgressData(chunk)) {
        output += chunk;
        const { progress } = ProgressParser.parseProgress(chunk);
        if (progress !== null && progress !== undefined) {
          downloadJobs.updateJob(id, {
            progress: Math.min(100, Math.max(0, progress)),
          });
        }
        if (ProgressParser.isSignificantChunk(chunk, progress)) {
          appendLogForChunk(id, chunk);
        }
      } else {
        errorOutput += chunk;
        appendLogForChunk(id, chunk);
      }
    });

    proc.on('close', async (code: number | null) => {
      downloadService.removeDownload(id);
      const now = Date.now();

      if (code === 0) {
        const tracked = await outputTracker.afterComplete(id);
        downloadJobs.updateJob(id, {
          status: 'completed',
          progress: 100,
          output: output.trim(),
          outputDir: tracked?.outputDir ?? null,
          files: tracked?.files ?? [],
          endTime: now,
        });
        downloadJobs.appendLog(id, 'Download completed successfully');

        const wantPostEpisodes = !!opts.autoPostUsenet;
        const wantPackSeason = !!opts.autoPackSeason;

        if ((wantPostEpisodes || wantPackSeason) && !usenetConfig.enabled) {
          logger.warn('auto-post requested but USENET_ENABLED=false', {
            downloadId: id,
            autoPostUsenet: wantPostEpisodes,
            autoPackSeason: wantPackSeason,
          });
        }

        if (wantPostEpisodes && usenetConfig.enabled && tracked && tracked.files.length > 0) {
          const quality = opts.resolution ?? null;
          const allowed = normalizeExtensions(usenetConfig.allowedExtensions);
          for (const file of tracked.files) {
            if (!isAllowedExtension(file.path, allowed)) {
              logger.info('Skipping auto-post: extension not in allowlist', {
                downloadId: id,
                path: file.path,
                allowed,
              });
              continue;
            }
            try {
              await dropForUpload(file.path, {
                downloadId: id,
                quality: quality !== null ? String(quality) : null,
                applyNaming: true,
              });
            } catch (err) {
              logger.warn('auto-post dropForUpload failed', {
                downloadId: id,
                path: file.path,
                error: (err as Error).message,
              });
            }
          }
        }

        if (wantPackSeason && usenetConfig.enabled && tracked && tracked.files.length > 0) {
          const refreshed = downloadJobs.getJob(id);
          if (refreshed) {
            try {
              await runSeasonPackForDownload(refreshed, {
                manual: false,
                appendDownloadLog: (line) => downloadJobs.appendLog(id, line),
              });
            } catch (err) {
              logger.warn('runSeasonPackForDownload failed', {
                downloadId: id,
                error: (err as Error).message,
              });
            }
          }
        }
      } else {
        outputTracker.discard(id);
        const errMsg = errorOutput || `Process exited with code ${code}`;
        downloadJobs.updateJob(id, {
          status: 'error',
          output: output.trim(),
          error: errMsg,
          endTime: now,
        });
        downloadJobs.appendLog(id, `Error: ${errMsg}`);
      }
    });

    proc.on('error', (error: Error) => {
      logger.error('Process error', { downloadId: id, error: error.message });
      downloadService.removeDownload(id);
      outputTracker.discard(id);
      const errMsg = `Failed to start svtplay-dl: ${error.message}`;
      downloadJobs.updateJob(id, {
        status: 'error',
        error: errMsg,
        endTime: Date.now(),
      });
      downloadJobs.appendLog(id, errMsg);
    });
  } catch (error) {
    logger.error('Download orchestrator error', { downloadId: id, error });
    const errorInfo = handleError(error instanceof Error ? error : new Error('Unknown error'));
    outputTracker.discard(id);
    downloadJobs.updateJob(id, {
      status: 'error',
      error: errorInfo.message,
      endTime: Date.now(),
    });
  }
}

function appendLogForChunk(downloadId: string, chunk: string): void {
  const trimmed = chunk.trim();
  if (!trimmed) return;
  const isProgressLine = /\[\d+\/\d+\]/.test(trimmed);
  if (isProgressLine) {
    downloadJobs.replaceLastProgressLog(downloadId, trimmed);
  } else {
    downloadJobs.appendLog(downloadId, trimmed);
  }
}

export function cancelDownload(downloadId: string): { cancelled: boolean } {
  const cancelled = downloadService.cancelDownload(downloadId);
  if (downloadJobs.getJob(downloadId)) {
    downloadJobs.updateJob(downloadId, {
      status: 'cancelled',
      endTime: Date.now(),
    });
    downloadJobs.appendLog(
      downloadId,
      cancelled ? 'Download cancelled' : 'Cancelled (no active process)',
    );
    return { cancelled: true };
  }
  return { cancelled: false };
}

export async function removeDownload(
  downloadId: string,
  deleteFiles: boolean,
): Promise<{ removed: boolean }> {
  if (downloadService.isDownloadActive(downloadId)) {
    downloadService.cancelDownload(downloadId);
  }
  const removed = downloadJobs.deleteJob(downloadId);
  if (!removed) return { removed: false };
  // jobLogService unlink + safeRemoveJobOutputDir live in the handler today;
  // delegate back to it via the imports below.
  await safeCleanup(removed.outputDir, downloadId, deleteFiles);
  return { removed: true };
}

// Lazy-import to avoid circular deps with jobLogService (handler uses both).
async function safeCleanup(
  outputDir: string | null | undefined,
  jobId: string,
  deleteFiles: boolean,
): Promise<void> {
  const { unlinkLogFile, downloadLogPath } = await import('./jobLogService.js');
  await unlinkLogFile(downloadLogPath(jobId));
  if (!deleteFiles || !outputDir) return;

  const resolvedJob = path.resolve(outputDir);
  const resolvedRoot = path.resolve(serverConfig.downloadOutputDir);
  if (resolvedJob === resolvedRoot) {
    logger.warn('Refusing to delete shared download root', { jobId, path: resolvedJob });
    return;
  }
  if (!resolvedJob.startsWith(resolvedRoot + path.sep)) {
    logger.warn('Refusing to delete output dir outside download root', {
      jobId,
      path: resolvedJob,
    });
    return;
  }
  try {
    await fsp.rm(resolvedJob, { recursive: true, force: true });
    logger.info('Removed job output dir', { jobId, path: resolvedJob });
  } catch (err) {
    logger.warn('Failed to remove job output dir', {
      jobId,
      path: resolvedJob,
      error: (err as Error).message,
    });
  }
}
