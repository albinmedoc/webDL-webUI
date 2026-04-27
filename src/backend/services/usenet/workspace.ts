import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';

export function getWorkRoot(): string {
  return process.env.USENET_WORK_DIR ?? path.resolve(process.cwd(), 'data', 'work');
}

export function getJobWorkDir(jobId: string): string {
  return path.join(getWorkRoot(), jobId);
}

export async function createJobWorkDir(jobId: string): Promise<string> {
  const dir = getJobWorkDir(jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeJobWorkDir(jobId: string): Promise<void> {
  const dir = getJobWorkDir(jobId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err: any) {
    logger.warn('removeJobWorkDir failed', { jobId, dir, error: err?.message });
  }
}
