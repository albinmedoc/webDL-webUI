import { randomUUID } from 'crypto';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  WEBHOOK_EVENTS,
  webhookDeliveries,
  webhooks,
  type WebhookDeliveryRow,
  type WebhookDeliveryState,
  type WebhookEvent,
  type WebhookRow,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';

export { WEBHOOK_EVENTS };
export type { WebhookEvent, WebhookDeliveryState };

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  /**
   * Subscribed events. Empty array = subscribe to *all* events (wildcard).
   */
  events: WebhookEvent[];
  enabled: boolean;
  headers: Record<string, string> | null;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  state: WebhookDeliveryState;
  attempt: number;
  statusCode: number | null;
  responseSnippet: string | null;
  error: string | null;
  nextRetryAt: number | null;
  deliveredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWebhookInput {
  url: string;
  secret?: string;
  events?: WebhookEvent[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
  description?: string | null;
}

export interface UpdateWebhookInput {
  url?: string;
  secret?: string;
  events?: WebhookEvent[];
  enabled?: boolean;
  headers?: Record<string, string> | null;
  description?: string | null;
}

function parseEvents(raw: string | null | undefined): WebhookEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is WebhookEvent => typeof e === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
  } catch {
    return [];
  }
}

function parseHeaders(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // fallthrough
  }
  return null;
}

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: parseEvents(row.events),
    enabled: row.enabled,
    headers: parseHeaders(row.headers),
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToDelivery(row: WebhookDeliveryRow): WebhookDelivery {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    payload,
    state: row.state,
    attempt: row.attempt,
    statusCode: row.statusCode,
    responseSnippet: row.responseSnippet,
    error: row.error,
    nextRetryAt: row.nextRetryAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

function validateUrl(url: string): { ok: true } | { ok: false; reason: string } {
  if (!url) return { ok: false, reason: 'url is required' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'url must use http or https' };
    }
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
  return { ok: true };
}

function validateEvents(events: unknown): { ok: true; value: WebhookEvent[] } | { ok: false; reason: string } {
  if (events === undefined) return { ok: true, value: [] };
  if (!Array.isArray(events)) return { ok: false, reason: 'events must be an array' };
  for (const e of events) {
    if (!isWebhookEvent(e)) return { ok: false, reason: `unknown event: ${String(e)}` };
  }
  return { ok: true, value: events as WebhookEvent[] };
}

export function listWebhooks(): Webhook[] {
  return getDb()
    .select()
    .from(webhooks)
    .orderBy(desc(webhooks.createdAt))
    .all()
    .map(rowToWebhook);
}

export function getWebhook(id: string): Webhook | null {
  const row = getDb().select().from(webhooks).where(eq(webhooks.id, id)).get();
  return row ? rowToWebhook(row) : null;
}

export function createWebhook(input: CreateWebhookInput): Webhook {
  const validation = validateUrl(input.url);
  if (!validation.ok) throw new Error(validation.reason);
  const eventsCheck = validateEvents(input.events);
  if (!eventsCheck.ok) throw new Error(eventsCheck.reason);

  const now = Date.now();
  const row = {
    id: randomUUID(),
    url: input.url,
    secret: input.secret ?? '',
    events: JSON.stringify(eventsCheck.value),
    enabled: input.enabled !== false,
    headers: input.headers ? JSON.stringify(input.headers) : null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  };
  getDb().insert(webhooks).values(row).run();
  logger.info('Webhook created', { id: row.id, url: row.url });
  return rowToWebhook(row as WebhookRow);
}

export function updateWebhook(id: string, input: UpdateWebhookInput): Webhook | null {
  const existing = getWebhook(id);
  if (!existing) return null;

  const patch: Partial<WebhookRow> = { updatedAt: Date.now() };
  if (input.url !== undefined) {
    const v = validateUrl(input.url);
    if (!v.ok) throw new Error(v.reason);
    patch.url = input.url;
  }
  if (input.secret !== undefined) patch.secret = input.secret;
  if (input.events !== undefined) {
    const v = validateEvents(input.events);
    if (!v.ok) throw new Error(v.reason);
    patch.events = JSON.stringify(v.value);
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.headers !== undefined) {
    patch.headers = input.headers ? JSON.stringify(input.headers) : null;
  }
  if (input.description !== undefined) patch.description = input.description;

  getDb().update(webhooks).set(patch).where(eq(webhooks.id, id)).run();
  return getWebhook(id);
}

export function deleteWebhook(id: string): boolean {
  const existing = getWebhook(id);
  if (!existing) return false;
  // Also drop pending/retrying deliveries — no point firing for a removed hook.
  getDb()
    .delete(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.webhookId, id),
        inArray(webhookDeliveries.state, ['pending', 'retrying']),
      ),
    )
    .run();
  getDb().delete(webhooks).where(eq(webhooks.id, id)).run();
  logger.info('Webhook deleted', { id });
  return true;
}

// ---------- delivery persistence ----------

export interface CreateDeliveryInput {
  webhookId: string;
  event: WebhookEvent | string;
  payload: unknown;
}

export function createDelivery(input: CreateDeliveryInput): WebhookDelivery {
  const now = Date.now();
  const row = {
    id: randomUUID(),
    webhookId: input.webhookId,
    event: input.event,
    payload: JSON.stringify(input.payload),
    state: 'pending' as WebhookDeliveryState,
    attempt: 0,
    statusCode: null,
    responseSnippet: null,
    error: null,
    nextRetryAt: now,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb().insert(webhookDeliveries).values(row).run();
  return rowToDelivery(row as WebhookDeliveryRow);
}

export interface DeliveryUpdate {
  state?: WebhookDeliveryState;
  attempt?: number;
  statusCode?: number | null;
  responseSnippet?: string | null;
  error?: string | null;
  nextRetryAt?: number | null;
  deliveredAt?: number | null;
}

export function updateDelivery(id: string, fields: DeliveryUpdate): void {
  getDb()
    .update(webhookDeliveries)
    .set({ ...fields, updatedAt: Date.now() })
    .where(eq(webhookDeliveries.id, id))
    .run();
}

export function getDelivery(id: string): WebhookDelivery | null {
  const row = getDb()
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id))
    .get();
  return row ? rowToDelivery(row) : null;
}

export function listDeliveries(
  webhookId: string,
  limit = 50,
): WebhookDelivery[] {
  return getDb()
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .all()
    .map(rowToDelivery);
}

export function listDueDeliveries(now: number, limit = 25): WebhookDelivery[] {
  return getDb()
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.state, ['pending', 'retrying']),
        sql`${webhookDeliveries.nextRetryAt} <= ${now}`,
      ),
    )
    .orderBy(webhookDeliveries.nextRetryAt)
    .limit(limit)
    .all()
    .map(rowToDelivery);
}

/**
 * Recover deliveries that were marked 'pending' but never advanced (server
 * crashed mid-flight). Reset them to 'retrying' so the dispatcher picks them
 * up. Idempotent.
 */
export function recoverPendingDeliveries(): number {
  const stuck = getDb()
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.state, ['pending', 'retrying']),
      ),
    )
    .all();
  if (stuck.length === 0) return 0;

  const now = Date.now();
  for (const row of stuck) {
    getDb()
      .update(webhookDeliveries)
      .set({ state: 'retrying', nextRetryAt: now, updatedAt: now })
      .where(eq(webhookDeliveries.id, row.id))
      .run();
  }
  logger.info('Recovered pending webhook deliveries', { count: stuck.length });
  return stuck.length;
}
