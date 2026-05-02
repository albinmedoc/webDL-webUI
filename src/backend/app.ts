import express, { Application } from 'express';
import fs from 'fs';
import { createServer, Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';

import { config } from './config/config.js';
import { usenetConfig } from './config/usenetConfig.js';
import { runMigrations } from './db/client.js';
import { loadOverridesFromDb } from './services/settingsService.js';
import { recoverInterruptedJobs as recoverInterruptedDownloadJobs } from './services/downloadJobsService.js';
import { recoverInterruptedJobs } from './services/usenetRecoveryService.js';
import { startRetentionScheduler } from './services/usenet/nzbRetention.js';
import { detectTools } from './services/usenet/tools.js';
import { startUploadWatcher } from './services/uploadWatcher.js';
import { startupKick as kickUsenetQueue } from './services/usenetService.js';
import { setupMiddleware, setupRoutes } from './middleware/setup.js';
import { SocketController } from './controllers/socketController.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../..');

export interface AppComponents {
  app: Application;
  server: HTTPServer;
  io: SocketIOServer;
}

export function createApp(): AppComponents {
  runMigrations();
  loadOverridesFromDb();
  // svtplay-dl's `-o` flag treats the path as a filename prefix unless it's
  // an existing directory, so ensure the configured download dir exists.
  fs.mkdirSync(config.downloadOutputDir, { recursive: true });
  recoverInterruptedJobs();
  recoverInterruptedDownloadJobs();

  if (usenetConfig.enabled) {
    logger.info('Usenet upload pipeline enabled', {
      host: usenetConfig.host,
      port: usenetConfig.port,
      groups: usenetConfig.groups,
    });
    kickUsenetQueue();
    startUploadWatcher().catch((err) => {
      logger.error('Failed to start upload watcher', { error: (err as Error).message });
    });
  } else {
    logger.info('Usenet upload pipeline disabled (set USENET_ENABLED=true to enable)');
  }

  // Warm the tool-availability cache so the /api/usenet/tools endpoint is instant.
  void detectTools();

  startRetentionScheduler();

  const app = express();
  const server = createServer(app);

  // Setup Socket.IO with CORS configuration
  const io = new SocketIOServer(server, {
    cors: config.cors
  });

  // Setup Express middleware
  setupMiddleware(app, rootDir);

  // Setup Socket.IO controllers
  new SocketController(io);

  // Setup Express routes (must be last)
  setupRoutes(app, rootDir);

  return { app, server, io };
}

export function startServer(): HTTPServer {
  const { server } = createApp();
  
  server.listen(config.port, () => {
    logger.info(`Server running on http://localhost:${config.port}`);
    logger.info('WebSocket server ready for connections');
  });

  return server;
}
