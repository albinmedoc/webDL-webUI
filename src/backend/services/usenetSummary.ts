import type { UsenetJob } from '../db/schema.js';
import type { UsenetJobSummary } from '../types/socket.js';

function parseLogs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMediaPaths(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) return parsed;
  } catch {
    // fallthrough
  }
  return null;
}

/**
 * Project a raw UsenetJob row into the JSON-safe summary shape used by the
 * socket flow, REST endpoints, and webhook payloads. Sensitive fields
 * (rarPassword) are intentionally omitted.
 */
export function toUsenetJobSummary(job: UsenetJob): UsenetJobSummary {
  return {
    id: job.id,
    downloadId: job.downloadId,
    mediaPath: job.mediaPath,
    mediaPaths: parseMediaPaths(job.mediaPaths),
    releaseType: job.releaseType,
    episodeCount: job.episodeCount,
    mediaSizeBytes: job.mediaSizeBytes,
    state: job.state,
    failureState: job.failureState,
    progress: job.progress,
    nzbPath: job.nzbPath,
    error: job.error,
    indexerResponse: job.indexerResponse,
    category: job.category,
    logs: parseLogs(job.logs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
