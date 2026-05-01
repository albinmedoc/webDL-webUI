import fs from 'fs/promises';
import path from 'path';

import { snapshotDir, diffSnapshots, type DirSnapshot, type SnapshotDiff } from '../utils/dirSnapshot.js';
import { logger } from '../utils/logger.js';

// svtplay-dl is invoked with `-M --output-format mkv`, which embeds
// subtitles as a soft track in the MKV. The standalone subtitle file is
// left behind on disk; treat it as redundant and remove it.
const SUBTITLE_EXTS = new Set(['.srt', '.vtt', '.smi', '.tt', '.ass', '.ttml']);

function siblingKey(p: string): string {
  return path.join(path.dirname(p), path.basename(p, path.extname(p)));
}

async function dropRedundantSubtitles(files: SnapshotDiff[]): Promise<SnapshotDiff[]> {
  const mkvKeys = new Set<string>();
  for (const f of files) {
    if (path.extname(f.path).toLowerCase() === '.mkv') mkvKeys.add(siblingKey(f.path));
  }
  if (mkvKeys.size === 0) return files;

  const kept: SnapshotDiff[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    if (SUBTITLE_EXTS.has(ext) && mkvKeys.has(siblingKey(f.path))) {
      try {
        await fs.unlink(f.path);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn('Failed to remove redundant subtitle', { file: f.path, error: err.message });
        }
      }
      continue;
    }
    kept.push(f);
  }
  return kept;
}

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
  const rawFiles = diffSnapshots(entry.before, after);
  const files = await dropRedundantSubtitles(rawFiles);
  tracked.delete(downloadId);

  logger.debug('Output tracker diff', {
    downloadId,
    outputDir: entry.outputDir,
    newFiles: files.length,
    droppedSubtitles: rawFiles.length - files.length,
  });
  return { outputDir: entry.outputDir, files };
}

export function discard(downloadId: string): void {
  tracked.delete(downloadId);
}
