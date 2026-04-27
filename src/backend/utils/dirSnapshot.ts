import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

import { logger } from './logger.js';

export type DirSnapshot = Map<string, number>;

export interface SnapshotDiff {
  path: string;
  size: number;
}

export async function snapshotDir(dir: string): Promise<DirSnapshot> {
  const snapshot: DirSnapshot = new Map();
  await walk(dir, snapshot);
  return snapshot;
}

async function walk(dir: string, snapshot: DirSnapshot): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'EACCES') return;
    logger.warn('snapshotDir read failed', { dir, error: err.message });
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, snapshot);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        snapshot.set(full, stat.size);
      } catch {
        // file vanished between readdir and stat — ignore
      }
    }
  }
}

export function diffSnapshots(before: DirSnapshot, after: DirSnapshot): SnapshotDiff[] {
  const diff: SnapshotDiff[] = [];
  for (const [filePath, size] of after) {
    const prev = before.get(filePath);
    if (prev === undefined || prev !== size) {
      diff.push({ path: filePath, size });
    }
  }
  return diff;
}
