import { inArray, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { usenetJobs, NON_TERMINAL_STATES } from '../db/schema.js';
import { logger } from '../utils/logger.js';

const RESTART_ERROR = 'Server restart during job';

export function recoverInterruptedJobs(): number {
  const db = getDb();

  const stuck = db
    .select({ id: usenetJobs.id, state: usenetJobs.state })
    .from(usenetJobs)
    .where(inArray(usenetJobs.state, NON_TERMINAL_STATES))
    .all();

  if (stuck.length === 0) {
    logger.info('No interrupted Usenet jobs to recover');
    return 0;
  }

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
  return stuck.length;
}
