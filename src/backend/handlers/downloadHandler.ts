import { Socket } from 'socket.io';
import { config } from '../config/config.js';
import { usenetConfig } from '../config/usenetConfig.js';
import * as downloadService from '../services/downloadService.js';
import * as downloadJobs from '../services/downloadJobsService.js';
import * as outputTracker from '../services/outputTracker.js';
import { ProgressParser, ValidationUtils } from '../utils/progressUtils.js';
import { DownloadRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';
import { UsenetHandler } from './usenetHandler.js';

function hasOutputFlag(args: string[]): boolean {
  return args.some(arg => arg === '-o' || arg === '--output');
}

export interface DownloadJobOptions {
  resolution?: number | null;
  allEpisodes?: boolean;
  autoPostUsenet?: boolean;
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
}

export interface DownloadClearOldData {
  daysOld?: number;
}

export interface DownloadHandler {
  handleStartDownload(data: DownloadStartData): Promise<void>;
  handleCancelDownload(data: DownloadCancelData): void;
  handleRemoveJob(data: DownloadRemoveData): void;
  handleClearCompleted(): void;
  handleClearOld(data: DownloadClearOldData): void;
  handleClearAll(): void;
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
      const args = hasOutputFlag(data.args)
        ? data.args
        : [...data.args, '-o', config.downloadOutputDir];

      // Persist before spawning so the job is visible in the DB even if the
      // process fails to start. Credentials are intentionally NOT stored.
      const opts = data.options ?? {};
      const job = downloadJobs.createJob({
        url,
        resolution: opts.resolution ?? null,
        allEpisodes: opts.allEpisodes ?? false,
        autoPostUsenet: opts.autoPostUsenet ?? !!data.autoPostUsenet,
      });
      downloadId = job.id;
      const id = downloadId;
      logger.info('Starting download', { downloadId: id, url });

      await outputTracker.beforeStart(id, args);

      const downloadInfo = downloadService.startDownload(url, args, id);
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

          if (data.autoPostUsenet && usenetConfig.enabled && tracked && tracked.files.length > 0) {
            const quality = opts.resolution ?? null;
            for (const file of tracked.files) {
              await usenetHandler.handleStartUpload({
                mediaPath: file.path,
                downloadId: id,
                quality: quality !== null ? String(quality) : null,
                applyNaming: true,
              });
            }
          } else if (data.autoPostUsenet && !usenetConfig.enabled) {
            logger.warn('autoPostUsenet requested but USENET_ENABLED=false', { downloadId: id });
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

  function handleRemoveJob(data: DownloadRemoveData): void {
    const { downloadId } = data;
    if (downloadService.isDownloadActive(downloadId)) {
      downloadService.cancelDownload(downloadId);
    }
    downloadJobs.deleteJob(downloadId);
  }

  function handleClearCompleted(): void {
    downloadJobs.clearCompleted();
  }

  function handleClearOld(data: DownloadClearOldData): void {
    const days = typeof data?.daysOld === 'number' && data.daysOld > 0 ? data.daysOld : 7;
    downloadJobs.clearOlderThan(days);
  }

  function handleClearAll(): void {
    for (const id of downloadService.getActiveDownloadIds()) {
      downloadService.cancelDownload(id);
    }
    downloadJobs.clearAll();
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
