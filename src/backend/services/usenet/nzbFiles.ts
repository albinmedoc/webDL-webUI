import fs from 'fs/promises';

import { logger } from '../../utils/logger.js';

// Removes an NZB file from disk. Treats ENOENT as success so callers can be
// idempotent. Other errors are logged but not rethrown — losing the NZB is
// better than blocking the DB row delete or retention sweep on a stale lock.
// Returns true when the file is gone (deleted or already missing), false
// when the unlink failed for some other reason.
export async function removeNzbFile(nzbPath: string): Promise<boolean> {
  try {
    await fs.unlink(nzbPath);
    logger.info('Deleted NZB file', { nzbPath });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    logger.warn('Failed to delete NZB file', { nzbPath, error: (err as Error).message });
    return false;
  }
}
