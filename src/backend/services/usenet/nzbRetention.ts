import fs from 'fs/promises';
import path from 'path';

import { inArray } from 'drizzle-orm';

import { indexerConfig } from '../../config/usenetConfig.js';
import { getDb } from '../../db/client.js';
import { usenetJobs } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

import { removeNzbFile } from './nzbFiles.js';

const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export async function runRetentionSweep(): Promise<void> {
  const days = indexerConfig.nzbRetentionDays;
  if (days <= 0) return;

  const dir = indexerConfig.nzbOutputDir;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    logger.warn('NZB retention sweep: readdir failed', { dir, error: (err as Error).message });
    return;
  }

  const removed: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.nzb')) continue;
    const full = path.join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(full)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs >= cutoff) continue;
    if (await removeNzbFile(full)) removed.push(full);
  }

  if (removed.length === 0) return;

  // Null out nzbPath on any rows pointing at the files we just removed so
  // the History view stops offering a "Download NZB" button for them.
  getDb()
    .update(usenetJobs)
    .set({ nzbPath: null })
    .where(inArray(usenetJobs.nzbPath, removed))
    .run();

  logger.info('NZB retention sweep removed files', { count: removed.length, retentionDays: days });
}

export function startRetentionScheduler(): void {
  if (indexerConfig.nzbRetentionDays <= 0) return;
  if (timer) return;

  void runRetentionSweep();
  timer = setInterval(() => {
    void runRetentionSweep();
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive solely for the sweeper — lets short-lived
  // CLI scripts that import this module exit cleanly.
  timer.unref();

  logger.info('NZB retention scheduler started', {
    retentionDays: indexerConfig.nzbRetentionDays,
    sweepIntervalHours: SWEEP_INTERVAL_MS / 3600000,
  });
}
