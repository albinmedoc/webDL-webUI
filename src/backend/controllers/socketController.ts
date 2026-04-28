import { Server as SocketIOServer, Socket } from 'socket.io';
import { DownloadHandler, DownloadStartData, DownloadCancelData, DownloadSyncData } from '../handlers/downloadHandler.js';
import { UsenetHandler } from '../handlers/usenetHandler.js';
import type {
  UsenetUploadStart,
  UsenetUploadCancel,
  UsenetUploadRetry,
} from '../types/socket.js';
import { logger } from '../utils/logger.js';

export class SocketController {
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info('Client connected', { socketId: socket.id });

      const downloadHandler = new DownloadHandler(socket);
      const usenetHandler = new UsenetHandler(socket);

      // Register all socket event handlers
      socket.on('start-download', (data: DownloadStartData) => {
        downloadHandler.handleStartDownload(data);
      });

      socket.on('cancel-download', (data: DownloadCancelData) => {
        downloadHandler.handleCancelDownload(data);
      });

      socket.on('sync-downloads', (data: DownloadSyncData) => {
        downloadHandler.handleSyncDownloads(data);
      });

      socket.on('health-check', () => {
        downloadHandler.handleHealthCheck();
      });

      socket.on('check-svtplay-dl', () => {
        downloadHandler.handleCheckSvtplayDl();
      });

      socket.on('start-usenet-upload', (data: UsenetUploadStart) => {
        usenetHandler.handleStartUpload(data);
      });

      socket.on('cancel-usenet-upload', (data: UsenetUploadCancel) => {
        usenetHandler.handleCancelUpload(data);
      });

      socket.on('retry-usenet-upload', (data: UsenetUploadRetry) => {
        usenetHandler.handleRetryUpload(data);
      });

      socket.on('sync-usenet-uploads', () => {
        usenetHandler.handleSyncUploads();
      });

      socket.on('disconnect', () => {
        usenetHandler.dispose();
        logger.info('Client disconnected', { socketId: socket.id });
      });
    });
  }
}
