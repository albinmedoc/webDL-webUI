import { createHmac } from 'crypto';

import {
  listJobs as listDownloadJobs,
  subscribe as subscribeDownloads,
  type DownloadJob,
} from './downloadJobsService.js';
import {
  getJob as getUsenetJob,
  subscribe as subscribeUsenet,
} from './usenetService.js';
import { toUsenetJobSummary } from './usenetSummary.js';
import {
  createDelivery,
  getDelivery,
  getWebhook,
  listDueDeliveries,
  listWebhooks,
  recoverPendingDeliveries,
  updateDelivery,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from './webhooksService.js';
import { logger } from '../utils/logger.js';
import type { DownloadJobState, UsenetJobState } from '../db/schema.js';

const VERSION = process.env.APP_VERSION || process.env.npm_package_version || 'dev';

// Wall-clock delay for retries (ms). Index = next attempt number after failure.
// attempt 1 fails → schedule for +1m → attempt 2 fails → +5m → ... → after
// attempt 5 fails the delivery is marked 'failed' and not retried.
const RETRY_BACKOFF_MS = [
  60_000,         // 1 min
  5 * 60_000,     // 5 min
  30 * 60_000,    // 30 min
  2 * 3_600_000,  // 2 h
  12 * 3_600_000, // 12 h
];
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

const WORKER_TICK_MS = 5_000;
const HTTP_TIMEOUT_MS = 15_000;

let workerTimer: NodeJS.Timeout | null = null;
let unsubscribeDownloads: (() => void) | null = null;
let unsubscribeUsenet: (() => void) | null = null;

// Per-job last-seen status (for download). Initialized at startup with the
// current DB state so subscriptions don't re-fire historical transitions.
const lastDownloadStatus = new Map<string, DownloadJobState>();

function mapDownloadEvent(
  curr: DownloadJobState,
  prev: DownloadJobState | undefined,
): WebhookEvent | null {
  if (curr === 'completed') return 'download.completed';
  if (curr === 'error') return 'download.failed';
  if (curr === 'cancelled') return 'download.cancelled';
  if (curr === 'downloading' && prev !== 'downloading') return 'download.started';
  if (curr === 'pending' && prev === undefined) return 'download.queued';
  return null;
}

function mapUsenetEvent(state: UsenetJobState): WebhookEvent | null {
  switch (state) {
    case 'queued':
      return 'usenet.queued';
    case 'posted':
      return 'usenet.posted';
    case 'done':
      return 'usenet.done';
    case 'failed':
      return 'usenet.failed';
    case 'cancelled':
      return 'usenet.cancelled';
    default:
      return null;
  }
}

function fanout(event: WebhookEvent, payload: unknown): void {
  const hooks = listWebhooks().filter(
    (w) => w.enabled && (w.events.length === 0 || w.events.includes(event)),
  );
  if (hooks.length === 0) return;

  const envelope = {
    event,
    timestamp: Date.now(),
    data: payload,
  };

  for (const hook of hooks) {
    try {
      createDelivery({ webhookId: hook.id, event, payload: envelope });
    } catch (err) {
      logger.warn('failed to enqueue webhook delivery', {
        hookId: hook.id,
        event,
        error: (err as Error).message,
      });
    }
  }
  // Wake the worker — don't wait for the next tick if we just got new work.
  void tick();
}

function buildHeaders(hook: Webhook, deliveryId: string, event: string, body: string): Record<string, string> {
  const out: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `svtplay-dl-webui/${VERSION}`,
    'X-Webhook-Event': event,
    'X-Webhook-Delivery': deliveryId,
  };
  if (hook.secret) {
    const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
    out['X-Webhook-Signature'] = `sha256=${sig}`;
  }
  if (hook.headers) {
    for (const [k, v] of Object.entries(hook.headers)) {
      // Don't let user-supplied headers clobber the standard ones we set above.
      if (out[k] !== undefined) continue;
      out[k] = v;
    }
  }
  return out;
}

async function attemptDelivery(delivery: WebhookDelivery): Promise<void> {
  const hook = getWebhook(delivery.webhookId);
  if (!hook) {
    // Webhook was deleted between enqueue and dispatch.
    updateDelivery(delivery.id, {
      state: 'failed',
      error: 'webhook removed',
      nextRetryAt: null,
    });
    return;
  }
  if (!hook.enabled) {
    // Don't burn attempts on a disabled hook — leave it pending; if the user
    // re-enables it the worker will pick it up.
    return;
  }

  const attempt = delivery.attempt + 1;
  const body = JSON.stringify(delivery.payload);
  const headers = buildHeaders(hook, delivery.id, delivery.event, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    let snippet: string | null = null;
    try {
      const text = await res.text();
      snippet = text.slice(0, 1024);
    } catch {
      // body read failed — non-fatal
    }

    if (res.status >= 200 && res.status < 300) {
      updateDelivery(delivery.id, {
        state: 'delivered',
        attempt,
        statusCode: res.status,
        responseSnippet: snippet,
        error: null,
        nextRetryAt: null,
        deliveredAt: Date.now(),
      });
      return;
    }

    handleFailure(delivery.id, attempt, `HTTP ${res.status}`, res.status, snippet);
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message || 'request failed';
    handleFailure(delivery.id, attempt, msg, null, null);
  }
}

function handleFailure(
  deliveryId: string,
  attempt: number,
  errMsg: string,
  statusCode: number | null,
  snippet: string | null,
): void {
  if (attempt >= MAX_ATTEMPTS) {
    updateDelivery(deliveryId, {
      state: 'failed',
      attempt,
      statusCode,
      responseSnippet: snippet,
      error: errMsg,
      nextRetryAt: null,
    });
    logger.warn('webhook delivery failed permanently', { deliveryId, attempt, error: errMsg });
    return;
  }
  const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  const nextRetryAt = Date.now() + backoff;
  updateDelivery(deliveryId, {
    state: 'retrying',
    attempt,
    statusCode,
    responseSnippet: snippet,
    error: errMsg,
    nextRetryAt,
  });
  logger.info('webhook delivery scheduled for retry', {
    deliveryId,
    attempt,
    nextRetryAt,
    error: errMsg,
  });
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const due = listDueDeliveries(now, 25);
    if (due.length === 0) return;
    // Run sequentially to keep memory + outbound conn count predictable. n8n
    // and other consumers happily accept fast back-to-back posts.
    for (const d of due) {
      await attemptDelivery(d);
    }
  } finally {
    ticking = false;
  }
}

function subscribeDownloadEvents(): void {
  // Seed the lastStatus map with current state so a subsequent upsert for an
  // existing job doesn't fire (e.g. completed→completed).
  for (const job of listDownloadJobs(1000)) {
    lastDownloadStatus.set(job.id, job.status);
  }

  unsubscribeDownloads = subscribeDownloads((event) => {
    if (event.type === 'reset') {
      lastDownloadStatus.clear();
      return;
    }
    if (event.type === 'deleted') {
      lastDownloadStatus.delete(event.id);
      return;
    }
    const job: DownloadJob = event.job;
    const prev = lastDownloadStatus.get(job.id);
    if (prev === job.status) return;
    lastDownloadStatus.set(job.id, job.status);
    const eventName = mapDownloadEvent(job.status, prev);
    if (!eventName) return;
    fanout(eventName, { job });
  });
}

function subscribeUsenetEvents(): void {
  unsubscribeUsenet = subscribeUsenet((jobId, evt, payload) => {
    if (evt === 'enqueued') {
      const job = getUsenetJob(jobId);
      if (job) fanout('usenet.queued', { job: toUsenetJobSummary(job) });
      return;
    }
    if (evt === 'state') {
      const state = payload as UsenetJobState;
      const eventName = mapUsenetEvent(state);
      if (!eventName) return;
      // 'queued' is also delivered via the 'enqueued' branch above; skip the
      // duplicate firing from the state observer.
      if (eventName === 'usenet.queued') return;
      const job = getUsenetJob(jobId);
      if (job) fanout(eventName, { job: toUsenetJobSummary(job) });
    }
  });
}

export function startWebhookDispatcher(): void {
  if (workerTimer) return;
  recoverPendingDeliveries();
  subscribeDownloadEvents();
  subscribeUsenetEvents();

  workerTimer = setInterval(() => {
    void tick();
  }, WORKER_TICK_MS);
  // Don't keep the event loop alive solely for the dispatcher.
  workerTimer.unref?.();

  logger.info('Webhook dispatcher started', { tickMs: WORKER_TICK_MS });
  // Kick once at startup so any deliveries due now (recovered ones) fire fast.
  void tick();
}

export function stopWebhookDispatcher(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  if (unsubscribeDownloads) {
    unsubscribeDownloads();
    unsubscribeDownloads = null;
  }
  if (unsubscribeUsenet) {
    unsubscribeUsenet();
    unsubscribeUsenet = null;
  }
  lastDownloadStatus.clear();
}

/**
 * Send a single test payload to a webhook. Used by POST /api/webhooks/:id/test.
 * Bypasses the persistent-delivery queue — fire-and-forget, single attempt.
 */
export async function sendTestDelivery(hook: Webhook): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  responseSnippet?: string;
}> {
  const body = JSON.stringify({
    event: 'test',
    timestamp: Date.now(),
    data: { message: 'webhook test from svtplay-dl-webui' },
  });
  const headers = buildHeaders(hook, 'test', 'test', body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    let snippet: string | undefined;
    try {
      const text = await res.text();
      snippet = text.slice(0, 1024);
    } catch {
      // ignore
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      responseSnippet: snippet,
    };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: (err as Error).message };
  }
}

// Suppress unused-import warning for getDelivery (re-exported for symmetry
// with REST handlers; not used inside this module).
export { getDelivery };
