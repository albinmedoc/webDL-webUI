#!/usr/bin/env node
/**
 * Alternative entry point for the svtplay-dl web UI backend
 * This can be used if you prefer to run the server via index.ts
 */

import { startServer } from './app.js';
import { Server as HTTPServer } from 'http';

// Start the server
const server: HTTPServer = startServer();

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
