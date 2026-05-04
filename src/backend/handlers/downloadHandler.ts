import fsp from 'fs/promises';
import path from 'path';

import { Socket } from 'socket.io';
import { config as serverConfig } from '../config/config.js';
import { usenetConfig } from '../config/usenetConfig.js';
import * as downloadService from '../services/downloadService.js';
import * as downloadJobs from '../services/downloadJobsService.js';
import * as outputTracker from '../services/outputTracker.js';
import { downloadLogPath, unlinkLogFile } from '../services/jobLogService.js';
import {
  isAllowedExtension,
  normalizeExtensions,
} from '../services/usenet/extensionFilter.js';
import { runSeasonPackForDownload } from '../services/usenet/seasonPackEnqueue.js';
import { ProgressParser, ValidationUtils } from '../utils/progressUtils.js';
import { DownloadRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';
import { UsenetHandler } from './usenetHandler.js';

function userSuppliedOutputDir(args: string[]): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-o' || args[i] === '--output') return true;
  }
  return false;
}

async function safeRemoveJobOutputDir(
  jobOutputDir: string | null | undefined,
  jobId: string,
): Promise<void> {
  if (!jobOutputDir) return;
  const resolvedJob = path.resolve(jobOutputDir);
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

export interface DownloadJobOptions {
  resolution?: number | null;
  allEpisodes?: boolean;
  autoPostUsenet?: boolean;
  autoPackSeason?: boolean;
}

export interface DownloadStartData extends DownloadRequest {
  args: string[];
  options?: DownloadJobOptions;
}

export interface DownloadCancelData {
  downloadId: string;
}

export interface DownloadRemoveData {
  downloadId: string;
  deleteFiles?: boolean;
}

export interface DownloadClearCompletedData {
  deleteFiles?: boolean;
}

export interface DownloadClearOldData {
  daysOld?: number;
  deleteFiles?: boolean;
}

export interface DownloadClearAllData {
  deleteFiles?: boolean;
}

export interface DownloadHandler {
  handleStartDownload(data: DownloadStartData): Promise<void>;
  handleCancelDownload(data: DownloadCancelData): void;
  handleRemoveJob(data: DownloadRemoveData): Promise<void>;
  handleClearCompleted(data: DownloadClearCompletedData): Promise<void>;
  handleClearOld(data: DownloadClearOldData): Promise<void>;
  handleClearAll(data: DownloadClearAllData): Promise<void>;
  handleSyncDownloads(): void;
  handleHealthCheck(): void;
  handleCheckSvtplayDl(): Promise<void>;
  dispose(): void;
}

export function createDownloadHandler(socket: Socket, usenetHandler: UsenetHandler): DownloadHandler {
  const unsubscribe = downloadJobs.subscribe((event) => {
    if (event.type === 'upserted') {
      socket.emit('download-job-upserted', { job: event.job });
    } else if (event.type === 'deleted') {
      socket.emit('download-job-deleted', { id: event.id });
    } else if (event.type === 'reset') {
      socket.emit('download-jobs-sync', { jobs: downloadJobs.listJobs() });
    }
  });

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

  async function handleStartDownload(data: DownloadStartData): Promise<void> {
    let downloadId: string | null = null;
    try {
      const validation = ValidationUtils.validateDownloadRequest(data);
      if (!validation.valid) {
        logger.warn('Download validation failed', { error: validation.error });
        socket.emit('download-error', { error: validation.error });
        return;
      }

      const { url } = data;

      // Persist before spawning so the job is visible in the DB even if the
      // process fails to start. Credentials are intentionally NOT stored.
      const opts = data.options ?? {};
      const job = downloadJobs.createJob({
        url,
        resolution: opts.resolution ?? null,
        allEpisodes: opts.allEpisodes ?? false,
        autoPostUsenet: opts.autoPostUsenet ?? !!data.autoPostUsenet,
        autoPackSeason: opts.autoPackSeason ?? !!data.autoPackSeason,
      });
      downloadId = job.id;
      const id = downloadId;
      logger.info('Starting download', { downloadId: id, url });

      // Isolate each job in its own subdirectory so concurrent downloads can't
      // pollute each other's tracked file lists. User-supplied -o still wins.
      let effectiveArgs = data.args;
      if (!userSuppliedOutputDir(data.args)) {
        const perJobDir = path.join(serverConfig.downloadOutputDir, id);
        await fsp.mkdir(perJobDir, { recursive: true });
        effectiveArgs = [...data.args, '-o', perJobDir];
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

          const wantPostEpisodes = !!data.autoPostUsenet;
          const wantPackSeason = !!data.autoPackSeason;

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
              await usenetHandler.handleStartUpload({
                mediaPath: file.path,
                downloadId: id,
                quality: quality !== null ? String(quality) : null,
                applyNaming: true,
              });
            }
          }

          // Season pack auto-trigger runs *additively* after per-episode
          // posts: enabling pack-on-complete does not suppress per-episode
          // posts (and vice versa). The eligibility helper enforces
          // allEpisodes + completeness + skip-latest in non-manual mode.
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
      logger.error('Download error', { downloadId, error });
      const errorInfo = handleError(error instanceof Error ? error : new Error('Unknown error'));
      if (downloadId) {
        outputTracker.discard(downloadId);
        downloadJobs.updateJob(downloadId, {
          status: 'error',
          error: errorInfo.message,
          endTime: Date.now(),
        });
      } else {
        socket.emit('download-error', { error: errorInfo.message });
      }
    }
  }

  function handleCancelDownload(data: DownloadCancelData): void {
    const { downloadId } = data;
    const cancelled = downloadService.cancelDownload(downloadId);
    if (downloadJobs.getJob(downloadId)) {
      downloadJobs.updateJob(downloadId, {
        status: 'cancelled',
        endTime: Date.now(),
      });
      downloadJobs.appendLog(downloadId, cancelled ? 'Download cancelled' : 'Cancelled (no active process)');
    }
  }

  async function handleRemoveJob(data: DownloadRemoveData): Promise<void> {
    const { downloadId, deleteFiles } = data;
    if (downloadService.isDownloadActive(downloadId)) {
      downloadService.cancelDownload(downloadId);
    }
    const removed = downloadJobs.deleteJob(downloadId);
    if (!removed) return;
    await unlinkLogFile(downloadLogPath(downloadId));
    if (deleteFiles) {
      await safeRemoveJobOutputDir(removed.outputDir, downloadId);
    }
  }

  async function handleClearCompleted(data: DownloadClearCompletedData): Promise<void> {
    const removed = downloadJobs.clearCompleted();
    await Promise.all(removed.map((j) => unlinkLogFile(downloadLogPath(j.id))));
    if (data?.deleteFiles) {
      await Promise.all(removed.map((j) => safeRemoveJobOutputDir(j.outputDir, j.id)));
    }
  }

  async function handleClearOld(data: DownloadClearOldData): Promise<void> {
    const days = typeof data?.daysOld === 'number' && data.daysOld > 0 ? data.daysOld : 7;
    const removed = downloadJobs.clearOlderThan(days);
    await Promise.all(removed.map((j) => unlinkLogFile(downloadLogPath(j.id))));
    if (data?.deleteFiles) {
      await Promise.all(removed.map((j) => safeRemoveJobOutputDir(j.outputDir, j.id)));
    }
  }

  async function handleClearAll(data: DownloadClearAllData): Promise<void> {
    for (const id of downloadService.getActiveDownloadIds()) {
      downloadService.cancelDownload(id);
    }
    const removed = downloadJobs.clearAll();
    await Promise.all(removed.map((j) => unlinkLogFile(downloadLogPath(j.id))));
    if (data?.deleteFiles) {
      await Promise.all(removed.map((j) => safeRemoveJobOutputDir(j.outputDir, j.id)));
    }
  }

  function handleSyncDownloads(): void {
    socket.emit('download-jobs-sync', { jobs: downloadJobs.listJobs() });
  }

  function handleHealthCheck(): void {
    socket.emit('health-status', {
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  async function handleCheckSvtplayDl(): Promise<void> {
    const status = await downloadService.checkSvtplayDlAvailability();
    socket.emit('svtplay-dl-status', status);
  }

  function dispose(): void {
    unsubscribe();
  }

  return {
    handleStartDownload,
    handleCancelDownload,
    handleRemoveJob,
    handleClearCompleted,
    handleClearOld,
    handleClearAll,
    handleSyncDownloads,
    handleHealthCheck,
    handleCheckSvtplayDl,
    dispose,
  };
}
