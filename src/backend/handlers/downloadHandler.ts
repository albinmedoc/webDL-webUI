import fsp from 'fs/promises';
import path from 'path';

import { Socket } from 'socket.io';
import { config as serverConfig } from '../config/config.js';
import * as downloadService from '../services/downloadService.js';
import * as downloadJobs from '../services/downloadJobsService.js';
import {
  cancelDownload as orchestratorCancel,
  startDownload as orchestratorStart,
  DownloadValidationError,
} from '../services/downloadOrchestrator.js';
import { downloadLogPath, unlinkLogFile } from '../services/jobLogService.js';
import { DownloadRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { UsenetHandler } from './usenetHandler.js';

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

// usenetHandler is no longer needed by the download handler — auto-post-usenet
// runs inside the orchestrator via dropForUpload. We keep the parameter so
// SocketController doesn't need to change shape (and so future hooks can wire
// in here if needed).
export function createDownloadHandler(
  socket: Socket,
  _usenetHandler: UsenetHandler,
): DownloadHandler {
  const unsubscribe = downloadJobs.subscribe((event) => {
    if (event.type === 'upserted') {
      socket.emit('download-job-upserted', { job: event.job });
    } else if (event.type === 'deleted') {
      socket.emit('download-job-deleted', { id: event.id });
    } else if (event.type === 'reset') {
      socket.emit('download-jobs-sync', { jobs: downloadJobs.listJobs() });
    }
  });

  async function handleStartDownload(data: DownloadStartData): Promise<void> {
    try {
      const opts = data.options ?? {
        autoPostUsenet: data.autoPostUsenet,
        autoPackSeason: data.autoPackSeason,
      };
      await orchestratorStart({ url: data.url, args: data.args, options: opts });
    } catch (err) {
      if (err instanceof DownloadValidationError) {
        logger.warn('Download validation failed', { error: err.message });
        socket.emit('download-error', { error: err.message });
        return;
      }
      logger.error('Download start failed', { error: (err as Error).message });
      socket.emit('download-error', { error: (err as Error).message });
    }
  }

  function handleCancelDownload(data: DownloadCancelData): void {
    orchestratorCancel(data.downloadId);
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
