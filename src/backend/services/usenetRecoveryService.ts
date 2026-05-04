import fs from 'fs/promises';
import path from 'path';

import { inArray, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { usenetJobs, NON_TERMINAL_STATES } from '../db/schema.js';
import { getWorkRoot } from './usenet/workspace.js';
import { logger } from '../utils/logger.js';

const RESTART_ERROR = 'Server restart during job';

export function recoverInterruptedJobs(): number {
  const db = getDb();

  const stuck = db
    .select({ id: usenetJobs.id, state: usenetJobs.state })
    .from(usenetJobs)
    .where(inArray(usenetJobs.state, NON_TERMINAL_STATES))
    .all();

  if (stuck.length > 0) {
    const now = Date.now();
    for (const row of stuck) {
      db.update(usenetJobs)
        .set({
          state: 'failed',
          failureState: row.state,
          error: RESTART_ERROR,
          updatedAt: now,
        })
        .where(eq(usenetJobs.id, row.id))
        .run();
    }
    logger.warn('Recovered interrupted Usenet jobs', {
      count: stuck.length,
      error: RESTART_ERROR,
    });
  } else {
    logger.info('No interrupted Usenet jobs to recover');
  }

  // After recovery every job is terminal, so anything still on disk in the
  // work root is orphaned (crash before pipeline cleanup, or leftover from a
  // previous version). Pipelines only start after the server is up, so we
  // can safely nuke every subdir here.
  void pruneOrphanedWorkDirs();

  return stuck.length;
}

async function pruneOrphanedWorkDirs(): Promise<void> {
  const root = getWorkRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    logger.warn('Could not scan work root for orphans', {
      root,
      error: err?.message,
    });
    return;
  }

  let removed = 0;
  for (const entry of entries) {
    const full = path.join(root, entry);
    try {
      const stat = await fs.lstat(full);
      if (!stat.isDirectory()) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed += 1;
    } catch (err: any) {
      logger.warn('Failed to remove orphan work dir', {
        path: full,
        error: err?.message,
      });
    }
  }

  if (removed > 0) {
    logger.info('Pruned orphaned work dirs', { root, count: removed });
  }
}
