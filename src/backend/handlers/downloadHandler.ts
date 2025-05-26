import { Socket } from 'socket.io';
import downloadService from '../services/downloadService.js';
import { ProgressParser, ValidationUtils } from '../utils/progressUtils.js';
import { DownloadRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { handleError } from '../utils/errors.js';

export interface DownloadStartData extends DownloadRequest {
  args: string[];
}

export interface DownloadCancelData {
  downloadId: string;
}

export interface DownloadSyncData {
  downloadIds: string[];
}

export class DownloadHandler {
  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  async handleStartDownload(data: DownloadStartData): Promise<void> {
    try {
      const validation = ValidationUtils.validateDownloadRequest(data);
      if (!validation.valid) {
        logger.warn('Download validation failed', { downloadId: data.downloadId, error: validation.error });
        this.socket.emit('download-error', { 
          downloadId: data.downloadId, 
          error: validation.error 
        });
        return;
      }

      const { url, args, downloadId } = data;
      logger.info('Starting download', { downloadId, url });

      const downloadInfo = downloadService.startDownload(url, args, downloadId);
      const { process, command } = downloadInfo;

      // Emit download started
      this.socket.emit('download-started', {
        downloadId,
        command,
        url
      });

      let output = '';
      let errorOutput = '';

      // Handle stdout data
      process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.handleProgressData(chunk, downloadId, output);
      });

      // Handle stderr data
      process.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        
        if (ProgressParser.isProgressData(chunk)) {
          // Treat stderr progress data the same as stdout progress data
          output += chunk;
          this.handleProgressData(chunk, downloadId, output);
        } else {
          // This is an actual error message
          errorOutput += chunk;
          this.socket.emit('download-progress', {
            downloadId,
            chunk: chunk.trim(),
            error: true
          });
        }
      });

      // Handle process completion
      process.on('close', (code: number | null) => {
        downloadService.removeDownload(downloadId);
        
        if (code === 0) {
          this.socket.emit('download-completed', {
            downloadId,
            success: true,
            output: output.trim(),
            command
          });
        } else {
          this.socket.emit('download-completed', {
            downloadId,
            success: false,
            error: errorOutput || `Process exited with code ${code}`,
            output: output.trim()
          });
        }
      });

      // Handle process errors
      process.on('error', (error: Error) => {
        logger.error('Process error', { downloadId, error: error.message });
        downloadService.removeDownload(downloadId);
        this.socket.emit('download-error', {
          downloadId,
          error: `Failed to start svtplay-dl: ${error.message}`
        });
      });

    } catch (error) {
      logger.error('Download error', { downloadId: data.downloadId, error });
      const errorInfo = handleError(error instanceof Error ? error : new Error('Unknown error'));
      this.socket.emit('download-error', {
        downloadId: data.downloadId,
        error: errorInfo.message
      });
    }
  }

  private handleProgressData(chunk: string, downloadId: string, output: string): void {
    const { progress, eta, status } = ProgressParser.parseProgress(chunk);
    
    if (ProgressParser.isSignificantChunk(chunk, progress)) {
      this.socket.emit('download-progress', {
        downloadId,
        chunk: chunk.trim(),
        output: output.trim(),
        progress,
        eta,
        status
      });
    }
  }

  handleCancelDownload(data: DownloadCancelData): void {
    const { downloadId } = data;
    const cancelled = downloadService.cancelDownload(downloadId);
    
    if (cancelled) {
      this.socket.emit('download-cancelled', { downloadId });
    }
  }

  handleSyncDownloads(data: DownloadSyncData): void {
    const { downloadIds } = data;
    
    downloadIds.forEach(downloadId => {
      if (downloadService.isDownloadActive(downloadId)) {
        // Download is still active on server
        this.socket.emit('download-sync', {
          downloadId,
          status: 'downloading',
          progress: null // Will be updated by next progress event
        });
      } else {
        // Download not found on server
        this.socket.emit('download-not-found', { downloadId });
      }
    });
  }

  handleHealthCheck(): void {
    this.socket.emit('health-status', { 
      status: 'ok', 
      timestamp: new Date().toISOString() 
    });
  }

  async handleCheckSvtplayDl(): Promise<void> {
    const status = await downloadService.checkSvtplayDlAvailability();
    this.socket.emit('svtplay-dl-status', status);
  }
}
