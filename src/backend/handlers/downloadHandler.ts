import { Socket } from 'socket.io';
import { config } from '../config/config.js';
import { usenetConfig } from '../config/usenetConfig.js';
import * as downloadService from '../services/downloadService.js';
import * as outputTracker from '../services/outputTracker.js';
import { applyReleaseNaming } from '../services/usenet/releaseNamer.js';
import { ProgressParser, ValidationUtils } from '../utils/progressUtils.js';
import { DownloadRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';
import { UsenetHandler } from './usenetHandler.js';

function extractQualityFromArgs(args: string[]): string | null {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-q') return args[i + 1] ?? null;
  }
  return null;
}

function hasOutputFlag(args: string[]): boolean {
  return args.some(arg => arg === '-o' || arg === '--output');
}

export interface DownloadStartData extends DownloadRequest {
  args: string[];
}

export interface DownloadCancelData {
  downloadId: string;
}

export interface DownloadSyncData {
  downloadIds: string[];
}

export interface DownloadHandler {
  handleStartDownload(data: DownloadStartData): Promise<void>;
  handleCancelDownload(data: DownloadCancelData): void;
  handleSyncDownloads(data: DownloadSyncData): void;
  handleHealthCheck(): void;
  handleCheckSvtplayDl(): Promise<void>;
}

export function createDownloadHandler(socket: Socket, usenetHandler: UsenetHandler): DownloadHandler {
  function handleProgressData(chunk: string, downloadId: string, output: string): void {
    const { progress, eta, status } = ProgressParser.parseProgress(chunk);

    if (ProgressParser.isSignificantChunk(chunk, progress)) {
      socket.emit('download-progress', {
        downloadId,
        chunk: chunk.trim(),
        output: output.trim(),
        progress,
        eta,
        status,
      });
    }
  }

  async function handleStartDownload(data: DownloadStartData): Promise<void> {
    try {
      const validation = ValidationUtils.validateDownloadRequest(data);
      if (!validation.valid) {
        logger.warn('Download validation failed', { downloadId: data.downloadId, error: validation.error });
        socket.emit('download-error', {
          downloadId: data.downloadId,
          error: validation.error,
        });
        return;
      }

      const { url, downloadId } = data;
      const args = hasOutputFlag(data.args)
        ? data.args
        : [...data.args, '-o', config.downloadOutputDir];
      logger.info('Starting download', { downloadId, url });

      await outputTracker.beforeStart(downloadId, args);

      const downloadInfo = downloadService.startDownload(url, args, downloadId);
      const { process: proc, command } = downloadInfo;

      socket.emit('download-started', {
        downloadId,
        command,
        url,
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        handleProgressData(chunk, downloadId, output);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();

        if (ProgressParser.isProgressData(chunk)) {
          output += chunk;
          handleProgressData(chunk, downloadId, output);
        } else {
          errorOutput += chunk;
          socket.emit('download-progress', {
            downloadId,
            chunk: chunk.trim(),
            error: true,
          });
        }
      });

      proc.on('close', async (code: number | null) => {
        downloadService.removeDownload(downloadId);

        if (code === 0) {
          const tracked = await outputTracker.afterComplete(downloadId);
          if (tracked && tracked.files.length > 0) {
            socket.emit('download-files', {
              downloadId,
              outputDir: tracked.outputDir,
              files: tracked.files,
            });
          }
          socket.emit('download-completed', {
            downloadId,
            success: true,
            output: output.trim(),
            command,
            outputDir: tracked?.outputDir,
            files: tracked?.files ?? [],
          });

          if (data.autoPostUsenet && usenetConfig.enabled && tracked && tracked.files.length > 0) {
            const quality = extractQualityFromArgs(data.args);
            for (const file of tracked.files) {
              const mediaPath = await applyReleaseNaming(file.path, { quality });
              await usenetHandler.handleStartUpload({
                mediaPath,
                downloadId,
                category: data.usenetCategory ?? null,
              });
            }
          } else if (data.autoPostUsenet && !usenetConfig.enabled) {
            logger.warn('autoPostUsenet requested but USENET_ENABLED=false', { downloadId });
          }
        } else {
          outputTracker.discard(downloadId);
          socket.emit('download-completed', {
            downloadId,
            success: false,
            error: errorOutput || `Process exited with code ${code}`,
            output: output.trim(),
          });
        }
      });

      proc.on('error', (error: Error) => {
        logger.error('Process error', { downloadId, error: error.message });
        downloadService.removeDownload(downloadId);
        outputTracker.discard(downloadId);
        socket.emit('download-error', {
          downloadId,
          error: `Failed to start svtplay-dl: ${error.message}`,
        });
      });

    } catch (error) {
      logger.error('Download error', { downloadId: data.downloadId, error });
      outputTracker.discard(data.downloadId);
      const errorInfo = handleError(error instanceof Error ? error : new Error('Unknown error'));
      socket.emit('download-error', {
        downloadId: data.downloadId,
        error: errorInfo.message,
      });
    }
  }

  function handleCancelDownload(data: DownloadCancelData): void {
    const { downloadId } = data;
    const cancelled = downloadService.cancelDownload(downloadId);

    if (cancelled) {
      socket.emit('download-cancelled', { downloadId });
    }
  }

  function handleSyncDownloads(data: DownloadSyncData): void {
    const { downloadIds } = data;

    downloadIds.forEach(downloadId => {
      if (downloadService.isDownloadActive(downloadId)) {
        socket.emit('download-sync', {
          downloadId,
          status: 'downloading',
          progress: null,
        });
      } else {
        socket.emit('download-not-found', { downloadId });
      }
    });
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

  return {
    handleStartDownload,
    handleCancelDownload,
    handleSyncDownloads,
    handleHealthCheck,
    handleCheckSvtplayDl,
  };
}
