import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import { config as serverConfig } from '../config/config.js';
import { usenetConfig } from '../config/usenetConfig.js';
import { logger } from '../utils/logger.js';
import { applyReleaseNaming, detectNewznabCategory } from './usenet/releaseNamer.js';
import { enqueueJob, getJob, subscribe } from './usenetService.js';

export interface DropOptions {
  downloadId?: string | null;
  quality?: string | null;
  applyNaming?: boolean;
}

// Per-link metadata captured at drop time and consumed when the watcher fires.
// We keep it in memory because the watcher's only signal is the path; details
// like downloadId would otherwise be lost between drop and enqueue.
interface PendingDrop {
  downloadId: string | null;
  category: string;
}

const pending = new Map<string, PendingDrop>();
const inflight = new Set<string>();
// Paths we've already pushed into the queue this run. Cleared when the symlink
// goes away (either after a successful post or external removal) so the same
// path can be reposted.
const enqueued = new Set<string>();
let watcher: fs.FSWatcher | null = null;

function uploadDir(): string {
  return serverConfig.uploadWatchDir;
}

/**
 * Symlink a downloaded file into the upload watch dir. The watcher picks the
 * symlink up and enqueues a usenet job. When `applyNaming` is set the source
 * file is renamed in-place first so the symlink (and the eventual NZB) carry
 * the proper release name.
 */
export async function dropForUpload(
  sourcePath: string,
  opts: DropOptions = {},
): Promise<string> {
  if (!usenetConfig.enabled) {
    throw new Error('Usenet feature is disabled (USENET_ENABLED=false)');
  }

  // Detect category before rename so dated daily shows still resolve to TV
  // (the rename strips the {date} token from the basename).
  const originalBase = path.basename(sourcePath);
  const category = detectNewznabCategory(originalBase);

  let resolvedSource = sourcePath;
  if (opts.applyNaming) {
    resolvedSource = await applyReleaseNaming(sourcePath, {
      quality: opts.quality ?? null,
    });
  }

  await fsp.mkdir(uploadDir(), { recursive: true });
  const linkPath = path.join(uploadDir(), path.basename(resolvedSource));

  if (await pathExists(linkPath)) {
    // Already dropped (re-post or duplicate). Refresh metadata so a subsequent
    // watcher event can still attribute it correctly.
    pending.set(linkPath, { downloadId: opts.downloadId ?? null, category });
    logger.info('Upload symlink already present, skipping', { linkPath });
    return linkPath;
  }

  pending.set(linkPath, { downloadId: opts.downloadId ?? null, category });
  await fsp.symlink(resolvedSource, linkPath);
  logger.info('Dropped file into upload watch dir', { linkPath, target: resolvedSource });
  return linkPath;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function statTargetExists(linkPath: string): Promise<boolean> {
  try {
    // stat() follows symlinks. If the target is gone, this throws.
    await fsp.stat(linkPath);
    return true;
  } catch {
    return false;
  }
}

async function handleAdd(linkPath: string): Promise<void> {
  if (inflight.has(linkPath) || enqueued.has(linkPath)) return;
  if (!(await statTargetExists(linkPath))) {
    logger.warn('Upload entry has no resolvable target, ignoring', { linkPath });
    return;
  }
  inflight.add(linkPath);
  try {
    const meta = pending.get(linkPath);
    const category =
      meta?.category ?? detectNewznabCategory(path.basename(linkPath));
    await enqueueJob({
      mediaPath: linkPath,
      downloadId: meta?.downloadId ?? null,
      category,
    });
    enqueued.add(linkPath);
    pending.delete(linkPath);
  } catch (err) {
    logger.warn('Upload watcher enqueue failed', {
      linkPath,
      error: (err as Error).message,
    });
  } finally {
    inflight.delete(linkPath);
  }
}

async function rescan(): Promise<void> {
  const dir = uploadDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    logger.warn('Upload watcher rescan failed', {
      dir,
      error: (err as Error).message,
    });
    return;
  }
  for (const entry of entries) {
    void handleAdd(path.join(dir, entry));
  }
}

export async function startUploadWatcher(): Promise<void> {
  if (!usenetConfig.enabled) {
    logger.info('Upload watcher disabled (USENET_ENABLED=false)');
    return;
  }

  const dir = uploadDir();
  await fsp.mkdir(dir, { recursive: true });

  // Pick up anything left over from a previous run (e.g. crashed mid-post).
  // The DB-side enqueue is idempotent in practice because mediaPath collisions
  // are rare; if a duplicate sneaks through, the second job posts the same
  // file and the user can delete one.
  await rescan();

  // Subscribe once for the whole process — when a job hits `done`, remove the
  // symlink so we don't reprocess it on next startup.
  subscribe((jobId, event, payload) => {
    if (event !== 'state' || payload !== 'done') return;
    const job = getJob(jobId);
    if (!job) return;
    if (path.dirname(job.mediaPath) !== dir) return;
    fsp.unlink(job.mediaPath).then(
      () => {
        enqueued.delete(job.mediaPath);
        logger.info('Removed upload symlink after successful post', { path: job.mediaPath });
      },
      (err) => logger.debug('Failed to remove upload symlink', {
        path: job.mediaPath,
        error: (err as Error).message,
      }),
    );
  });

  watcher = fs.watch(dir, { persistent: false }, (event, filename) => {
    if (!filename) return;
    const full = path.join(dir, filename.toString());
    // fs.watch emits 'rename' for both create and delete; check existence to
    // disambiguate. We only enqueue on creation; deletion is our own cleanup.
    if (event === 'rename') {
      fs.access(full, (err) => {
        if (err) {
          pending.delete(full);
          enqueued.delete(full);
          return;
        }
        void handleAdd(full);
      });
    }
  });

  watcher.on('error', (err) => {
    logger.error('Upload watcher error', { error: err.message });
  });

  logger.info('Upload watcher started', { dir });
}

export function stopUploadWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
