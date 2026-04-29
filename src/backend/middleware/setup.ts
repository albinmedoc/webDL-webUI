import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { getPublicConfig, usenetConfig, indexerConfig } from '../config/usenetConfig.js';
import { USENET_JOB_STATES, type UsenetJobState } from '../db/schema.js';
import { runHookCheck } from '../services/usenet/indexer.js';
import { probeNntp } from '../services/usenet/nntpProbe.js';
import { detectTools } from '../services/usenet/tools.js';
import { deleteJob, getJob, listJobsPaginated } from '../services/usenetService.js';
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

  app.get('/api/usenet/config', (_req: Request, res: Response) => {
    res.json(getPublicConfig());
  });

  app.get('/api/usenet/tools', async (_req: Request, res: Response) => {
    const tools = await detectTools();
    res.json(tools);
  });

  app.post('/api/usenet/test/nntp', async (_req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const result = await probeNntp(usenetConfig);
    res.json(result);
  });

  app.post('/api/usenet/test/indexer', async (_req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    if (!indexerConfig.hookScript) {
      res.json({ ok: false, error: 'INDEXER_HOOK_SCRIPT is not configured' });
      return;
    }
    try {
      const result = await runHookCheck();
      res.json({
        ok: result.ok,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
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

  app.delete('/api/usenet/jobs/:id', async (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const result = await deleteJob(req.params.id);
    if (result.deleted) {
      res.status(204).end();
      return;
    }
    if (result.reason === 'not found') {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    if (result.reason === 'active') {
      res.status(409).json({ error: 'job is currently active', state: result.state });
      return;
    }
    res.status(500).json({ error: result.reason ?? 'unknown error' });
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
