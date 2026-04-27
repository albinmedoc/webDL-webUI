import path from 'path';

import { snapshotDir, diffSnapshots, type DirSnapshot, type SnapshotDiff } from '../utils/dirSnapshot.js';
import { logger } from '../utils/logger.js';

interface TrackedDownload {
  outputDir: string;
  before: DirSnapshot;
}

const tracked: Map<string, TrackedDownload> = new Map();

function resolveOutputDir(args: string[]): string {
  for (let i = args.length - 1; i >= 0; i--) {
    if (args[i] === '-o' || args[i] === '--output') {
      const next = args[i + 1];
      if (next) return path.resolve(process.cwd(), next);
    }
  }
  return process.cwd();
}

export async function beforeStart(downloadId: string, args: string[]): Promise<void> {
  const outputDir = resolveOutputDir(args);
  const before = await snapshotDir(outputDir);
  tracked.set(downloadId, { outputDir, before });
  logger.debug('Output tracker pre-snapshot', {
    downloadId,
    outputDir,
    fileCount: before.size,
  });
}

export interface AfterCompleteResult {
  outputDir: string;
  files: SnapshotDiff[];
}

export async function afterComplete(downloadId: string): Promise<AfterCompleteResult | null> {
  const entry = tracked.get(downloadId);
  if (!entry) return null;

  const after = await snapshotDir(entry.outputDir);
  const files = diffSnapshots(entry.before, after);
  tracked.delete(downloadId);

  logger.debug('Output tracker diff', {
    downloadId,
    outputDir: entry.outputDir,
    newFiles: files.length,
  });
  return { outputDir: entry.outputDir, files };
}

export function discard(downloadId: string): void {
  tracked.delete(downloadId);
}
