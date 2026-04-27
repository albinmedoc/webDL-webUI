import { spawn } from 'child_process';

import { logger } from '../../utils/logger.js';

export interface ToolAvailability {
  rar: boolean;
  parpar: boolean;
  nyuu: boolean;
}

let cached: ToolAvailability | null = null;

function which(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] });
    let found = false;
    p.stdout.on('data', () => {
      found = true;
    });
    p.on('close', (code) => resolve(code === 0 && found));
    p.on('error', () => resolve(false));
  });
}

export async function detectTools(): Promise<ToolAvailability> {
  if (cached) return cached;

  const [rar, parpar, nyuu] = await Promise.all([
    which('rar'),
    which('parpar'),
    which('nyuu'),
  ]);

  cached = { rar, parpar, nyuu };

  if (rar) {
    logger.info('rar detected on PATH');
  } else {
    logger.warn('rar not found on PATH — Usenet uploads will fail until rar is installed');
  }
  if (!parpar) logger.warn('parpar not found on PATH — install @animetosho/parpar globally');
  if (!nyuu) logger.warn('nyuu not found on PATH — install nyuu globally');

  return cached;
}

export function getCachedTools(): ToolAvailability | null {
  return cached;
}

export function resetToolCache(): void {
  cached = null;
}
