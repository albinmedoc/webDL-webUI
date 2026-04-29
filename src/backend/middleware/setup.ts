import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { usenetConfig } from '../config/usenetConfig.js';
import { USENET_JOB_STATES, type UsenetJobState } from '../db/schema.js';
import { getJob, listJobsPaginated } from '../services/usenetService.js';
import { logger } from '../utils/logger.js';

export function setupMiddleware(app: Application, rootDir: string): void {
  // CORS middleware
  app.use(cors());

  // JSON parsing middleware
  app.use(express.json());

  // Static file serving middleware
  app.use(express.static(path.join(rootDir, 'dist')));
}

export function setupRoutes(app: Application, rootDir: string): void {
  // Health check endpoint for Docker
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.0.0',
      usenetEnabled: usenetConfig.enabled,
    });
  });

  app.get('/api/usenet/history', (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const state =
      stateParam && (USENET_JOB_STATES as readonly string[]).includes(stateParam)
        ? (stateParam as UsenetJobState)
        : null;
    const search = typeof req.query.search === 'string' ? req.query.search : null;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 25;

    const result = listJobsPaginated({ page, pageSize, state, search });
    res.json({
      jobs: result.jobs.map(({ rarPassword: _omit, ...rest }) => rest),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  });

  app.get('/api/usenet/jobs/:id', (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json(job);
  });

  app.get('/api/usenet/jobs/:id/nzb', (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    if (!job.nzbPath) {
      res.status(404).json({ error: 'nzb not yet generated' });
      return;
    }
    if (!fs.existsSync(job.nzbPath)) {
      logger.warn('NZB file missing on disk', { jobId: job.id, nzbPath: job.nzbPath });
      res.status(410).json({ error: 'nzb file no longer on disk' });
      return;
    }
    res.download(job.nzbPath, path.basename(job.nzbPath));
  });

  // Serve the frontend for all routes (SPA fallback)
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}
