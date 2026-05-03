import fs from 'fs/promises';
import path from 'path';

import { config as serverConfig } from '../config/config.js';
import { indexerConfig } from '../config/usenetConfig.js';
import { logger } from '../utils/logger.js';

export function downloadLogPath(jobId: string): string {
  return path.join(serverConfig.downloadOutputDir, '.logs', `${jobId}.log`);
}

export function usenetLogPath(jobId: string): string {
  return path.join(indexerConfig.nzbOutputDir, '.logs', `${jobId}.log`);
}

// Per-file write queue. Multiple appendLine calls for the same path serialise,
// so we never interleave inside a single job's log. The map self-cleans once
// the chain settles with no follow-up enqueue.
const queues = new Map<string, Promise<void>>();

export function appendLine(filePath: string, line: string): void {
  const text = line.endsWith('\n') ? line : `${line}\n`;
  const prev = queues.get(filePath) ?? Promise.resolve();
  const next: Promise<void> = prev
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, text);
    })
    .catch((err) => {
      logger.debug('jobLog appendLine failed', {
        filePath,
        error: (err as Error).message,
      });
    })
    .finally(() => {
      if (queues.get(filePath) === next) queues.delete(filePath);
    });
  queues.set(filePath, next);
}

export async function unlinkLogFile(filePath: string): Promise<void> {
  // Drain pending writes so we don't unlink mid-append.
  const pending = queues.get(filePath);
  if (pending) await pending;
  queues.delete(filePath);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('jobLog unlink failed', {
        filePath,
        error: (err as Error).message,
      });
    }
  }
}

export async function logFileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
