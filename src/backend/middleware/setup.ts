import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import swaggerUi from 'swagger-ui-express';

import { buildOpenApiSpec } from './openapi.js';

import { config as serverConfig } from '../config/config.js';
import { getPublicConfig, usenetConfig } from '../config/usenetConfig.js';
import {
  DOWNLOAD_JOB_STATES,
  USENET_JOB_STATES,
  type DownloadJobState,
  type UsenetJobState,
} from '../db/schema.js';
import { isRegistryKey } from '../config/registry.js';
import {
  getJob as getDownloadJob,
  listJobsPaginated as listDownloadJobsPaginated,
} from '../services/downloadJobsService.js';
import {
  downloadLogPath,
  logFileExists,
  usenetLogPath,
} from '../services/jobLogService.js';
import {
  clearOverride,
  listSettings,
  updateSettings,
} from '../services/settingsService.js';
import { probeQualities } from '../services/qualityProbe.js';
import { probeNntp } from '../services/usenet/nntpProbe.js';
import { detectTools } from '../services/usenet/tools.js';
import {
  cancelJob as cancelUsenetJob,
  deleteJob,
  deleteJobs,
  getJob,
  listJobsPaginated,
  retryJob as retryUsenetJob,
} from '../services/usenetService.js';
import {
  cancelDownload as orchestratorCancel,
  removeDownload as orchestratorRemove,
  startDownload as orchestratorStart,
  DownloadValidationError,
} from '../services/downloadOrchestrator.js';
import { dropForUpload } from '../services/uploadWatcher.js';
import { requireApiKey } from './auth.js';
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  isWebhookEvent,
  listDeliveries,
  listWebhooks,
  updateWebhook,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '../services/webhooksService.js';
import { sendTestDelivery } from '../services/webhookDispatcher.js';
import { logger } from '../utils/logger.js';

function parseLogsField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setupMiddleware(app: Application, rootDir: string): void {
  // CORS middleware
  app.use(cors());

  // JSON parsing middleware
  app.use(express.json());

  // Static file serving middleware
  app.use(express.static(path.join(rootDir, 'dist')));
}

export function setupRoutes(app: Application, rootDir: string): void {
  const apiVersion =
    process.env.APP_VERSION || process.env.npm_package_version || 'dev';
  const openApiSpec = buildOpenApiSpec(apiVersion);

  // Health check endpoint for Docker
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: apiVersion,
      usenetEnabled: usenetConfig.enabled,
    });
  });

  // OpenAPI spec + Swagger UI
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'svtplay-dl-webui API',
    swaggerOptions: { persistAuthorization: true },
  }));

  app.get('/api/usenet/config', (_req: Request, res: Response) => {
    res.json(getPublicConfig());
  });

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json(listSettings());
  });

  app.put('/api/settings', (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'request body must be an object of { key: value }' });
      return;
    }
    const result = updateSettings(body as Record<string, unknown>);
    res.json({ ...result, settings: listSettings() });
  });

  app.delete('/api/settings/:key', (req: Request, res: Response) => {
    const key = req.params.key;
    if (!isRegistryKey(key)) {
      res.status(404).json({ error: 'unknown setting' });
      return;
    }
    clearOverride(key);
    res.json({ settings: listSettings() });
  });

  app.get('/api/usenet/tools', async (_req: Request, res: Response) => {
    const tools = await detectTools();
    res.json(tools);
  });

  app.get('/api/probe', async (req: Request, res: Response) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'valid url query parameter required' });
      return;
    }
    try {
      const result = await probeQualities(url);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.post('/api/usenet/test/nntp', async (_req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const result = await probeNntp(usenetConfig);
    res.json(result);
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
      jobs: result.jobs.map(({ rarPassword: _omit, logs, ...rest }) => ({
        ...rest,
        logs: parseLogsField(logs),
      })),
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
    res.json({ ...job, logs: parseLogsField(job.logs) });
  });

  app.post('/api/usenet/jobs/bulk-delete', async (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!ids || ids.length === 0 || !ids.every((id: unknown) => typeof id === 'string')) {
      res.status(400).json({ error: 'request body must be { ids: string[] }' });
      return;
    }
    const result = await deleteJobs(ids as string[]);
    res.json(result);
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

  app.get('/api/downloads/jobs/:id/files/download', (req: Request, res: Response) => {
    const job = getDownloadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    if (!requested) {
      res.status(400).json({ error: 'path query parameter required' });
      return;
    }
    const allowed = job.files.find((f) => f.path === requested);
    if (!allowed) {
      res.status(404).json({ error: 'file not associated with this job' });
      return;
    }
    const resolved = path.resolve(allowed.path);
    const downloadRoot = path.resolve(serverConfig.downloadOutputDir);
    const jobOutputDir = job.outputDir ? path.resolve(job.outputDir) : null;
    const withinAllowedRoot =
      resolved === downloadRoot ||
      resolved.startsWith(downloadRoot + path.sep) ||
      (jobOutputDir !== null &&
        (resolved === jobOutputDir || resolved.startsWith(jobOutputDir + path.sep)));
    if (!withinAllowedRoot) {
      logger.warn('Download file path escaped allowed roots', {
        jobId: job.id,
        path: resolved,
      });
      res.status(403).json({ error: 'file outside allowed download directory' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(410).json({ error: 'file no longer on disk' });
      return;
    }
    res.download(resolved, path.basename(resolved));
  });

  app.get('/api/downloads/jobs/:id/logs', async (req: Request, res: Response) => {
    const job = getDownloadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const logPath = downloadLogPath(job.id);
    if (!(await logFileExists(logPath))) {
      res.status(404).json({ error: 'no log on disk for this job' });
      return;
    }
    if (req.query.download === '1') {
      res.download(logPath, `${job.id}.log`);
      return;
    }
    res.type('text/plain; charset=utf-8');
    fs.createReadStream(logPath).pipe(res);
  });

  app.get('/api/usenet/jobs/:id/logs', async (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const logPath = usenetLogPath(job.id);
    if (!(await logFileExists(logPath))) {
      res.status(404).json({ error: 'no log on disk for this job' });
      return;
    }
    if (req.query.download === '1') {
      res.download(logPath, `${job.id}.log`);
      return;
    }
    res.type('text/plain; charset=utf-8');
    fs.createReadStream(logPath).pipe(res);
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

  // ---------------------------------------------------------------------------
  // Download REST endpoints (n8n-friendly)
  // ---------------------------------------------------------------------------

  app.post('/api/downloads', requireApiKey, async (req: Request, res: Response) => {
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'request body must be an object' });
      return;
    }
    const url = typeof body.url === 'string' ? body.url : '';
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const args = Array.isArray(body.args) && body.args.every((a: unknown) => typeof a === 'string')
      ? (body.args as string[])
      : [];
    const opts = body.options && typeof body.options === 'object' ? body.options : {};
    const options = {
      resolution: typeof opts.resolution === 'number' ? opts.resolution : null,
      allEpisodes: opts.allEpisodes === true,
      autoPostUsenet: opts.autoPostUsenet === true,
      autoPackSeason: opts.autoPackSeason === true,
    };

    try {
      const job = await orchestratorStart({ url, args, options });
      res.status(201).json({ job });
    } catch (err) {
      if (err instanceof DownloadValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error('POST /api/downloads failed', { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/downloads', (req: Request, res: Response) => {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
    const status =
      statusParam && (DOWNLOAD_JOB_STATES as readonly string[]).includes(statusParam)
        ? (statusParam as DownloadJobState)
        : null;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 25;
    const result = listDownloadJobsPaginated({ page, pageSize, status });
    res.json(result);
  });

  app.get('/api/downloads/:id', (req: Request, res: Response) => {
    const job = getDownloadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.json({ job });
  });

  app.post('/api/downloads/:id/cancel', requireApiKey, (req: Request, res: Response) => {
    const job = getDownloadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const result = orchestratorCancel(req.params.id);
    if (!result.cancelled) {
      res.status(409).json({ error: 'unable to cancel', state: job.status });
      return;
    }
    res.json({ job: getDownloadJob(req.params.id) });
  });

  app.delete('/api/downloads/:id', requireApiKey, async (req: Request, res: Response) => {
    const deleteFiles = req.query.deleteFiles === '1' || req.query.deleteFiles === 'true';
    const result = await orchestratorRemove(req.params.id, deleteFiles);
    if (!result.removed) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  // Usenet REST endpoints (n8n-friendly write operations)
  // ---------------------------------------------------------------------------

  app.post('/api/usenet/uploads', requireApiKey, async (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const body = req.body ?? {};
    const mediaPath = typeof body.mediaPath === 'string' ? body.mediaPath : '';
    if (!mediaPath) {
      res.status(400).json({ error: 'mediaPath is required' });
      return;
    }
    try {
      const linkPath = await dropForUpload(mediaPath, {
        downloadId: typeof body.downloadId === 'string' ? body.downloadId : null,
        quality: typeof body.quality === 'string' ? body.quality : null,
        applyNaming: body.applyNaming === true,
      });
      // The watcher picks the symlink up async — we don't have a job id yet.
      res.status(202).json({ accepted: true, linkPath });
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn('POST /api/usenet/uploads failed', { error: msg });
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/usenet/jobs/:id/cancel', requireApiKey, (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const result = cancelUsenetJob(req.params.id);
    if (!result.cancelled) {
      res.status(409).json({ error: result.reason ?? 'cancel failed', state: job.state });
      return;
    }
    res.json({ job: getJob(req.params.id) });
  });

  app.post('/api/usenet/jobs/:id/retry', requireApiKey, (req: Request, res: Response) => {
    if (!usenetConfig.enabled) {
      res.status(404).json({ error: 'Usenet feature is disabled' });
      return;
    }
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job not found' });
      return;
    }
    const result = retryUsenetJob(req.params.id);
    if (!result.retried) {
      res.status(409).json({ error: result.reason ?? 'retry failed', state: job.state });
      return;
    }
    res.json({ job: getJob(req.params.id) });
  });

  // ---------------------------------------------------------------------------
  // Webhook CRUD
  // ---------------------------------------------------------------------------

  function parseHookBody(body: unknown): {
    url?: string;
    secret?: string;
    events?: WebhookEvent[];
    enabled?: boolean;
    headers?: Record<string, string> | null;
    description?: string | null;
    error?: string;
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: 'request body must be an object' };
    }
    const b = body as Record<string, unknown>;
    const out: ReturnType<typeof parseHookBody> = {};
    if ('url' in b) {
      if (typeof b.url !== 'string') return { error: 'url must be a string' };
      out.url = b.url;
    }
    if ('secret' in b) {
      if (typeof b.secret !== 'string') return { error: 'secret must be a string' };
      out.secret = b.secret;
    }
    if ('events' in b) {
      if (!Array.isArray(b.events)) return { error: 'events must be an array' };
      const events: WebhookEvent[] = [];
      for (const e of b.events) {
        if (!isWebhookEvent(e)) return { error: `unknown event: ${String(e)}` };
        events.push(e);
      }
      out.events = events;
    }
    if ('enabled' in b) {
      if (typeof b.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
      out.enabled = b.enabled;
    }
    if ('headers' in b) {
      if (b.headers === null) {
        out.headers = null;
      } else if (b.headers && typeof b.headers === 'object' && !Array.isArray(b.headers)) {
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(b.headers as Record<string, unknown>)) {
          if (typeof v !== 'string') return { error: `headers.${k} must be a string` };
          h[k] = v;
        }
        out.headers = h;
      } else {
        return { error: 'headers must be an object of strings or null' };
      }
    }
    if ('description' in b) {
      if (b.description === null) {
        out.description = null;
      } else if (typeof b.description !== 'string') {
        return { error: 'description must be a string or null' };
      } else {
        out.description = b.description;
      }
    }
    return out;
  }

  app.get('/api/webhooks/events', requireApiKey, (_req: Request, res: Response) => {
    res.json({ events: WEBHOOK_EVENTS });
  });

  app.get('/api/webhooks', requireApiKey, (_req: Request, res: Response) => {
    res.json({ webhooks: listWebhooks() });
  });

  app.post('/api/webhooks', requireApiKey, (req: Request, res: Response) => {
    const parsed = parseHookBody(req.body);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!parsed.url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    try {
      const hook = createWebhook({
        url: parsed.url,
        secret: parsed.secret,
        events: parsed.events,
        enabled: parsed.enabled,
        headers: parsed.headers ?? null,
        description: parsed.description ?? null,
      });
      res.status(201).json({ webhook: hook });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/webhooks/:id', requireApiKey, (req: Request, res: Response) => {
    const hook = getWebhook(req.params.id);
    if (!hook) {
      res.status(404).json({ error: 'webhook not found' });
      return;
    }
    res.json({ webhook: hook });
  });

  app.put('/api/webhooks/:id', requireApiKey, (req: Request, res: Response) => {
    const parsed = parseHookBody(req.body);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const hook = updateWebhook(req.params.id, {
        url: parsed.url,
        secret: parsed.secret,
        events: parsed.events,
        enabled: parsed.enabled,
        headers: parsed.headers,
        description: parsed.description,
      });
      if (!hook) {
        res.status(404).json({ error: 'webhook not found' });
        return;
      }
      res.json({ webhook: hook });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/webhooks/:id', requireApiKey, (req: Request, res: Response) => {
    const removed = deleteWebhook(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'webhook not found' });
      return;
    }
    res.status(204).end();
  });

  app.post('/api/webhooks/:id/test', requireApiKey, async (req: Request, res: Response) => {
    const hook = getWebhook(req.params.id);
    if (!hook) {
      res.status(404).json({ error: 'webhook not found' });
      return;
    }
    const result = await sendTestDelivery(hook);
    res.json(result);
  });

  app.get('/api/webhooks/:id/deliveries', requireApiKey, (req: Request, res: Response) => {
    const hook = getWebhook(req.params.id);
    if (!hook) {
      res.status(404).json({ error: 'webhook not found' });
      return;
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ deliveries: listDeliveries(req.params.id, limit) });
  });

  // Serve the frontend for all routes (SPA fallback)
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}
