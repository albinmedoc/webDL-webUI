import { spawn } from 'child_process';

import { logger } from '../../utils/logger.js';

export type Archiver = 'rar' | '7z';

export interface ToolAvailability {
  archiver: Archiver | null;
  archiverBin: string | null;
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

  const [hasRar, has7z, hasParpar, hasNyuu] = await Promise.all([
    which('rar'),
    which('7z'),
    which('parpar'),
    which('nyuu'),
  ]);

  let archiver: Archiver | null = null;
  let archiverBin: string | null = null;
  if (hasRar) {
    archiver = 'rar';
    archiverBin = 'rar';
  } else if (has7z) {
    archiver = '7z';
    archiverBin = '7z';
  }

  cached = { archiver, archiverBin, parpar: hasParpar, nyuu: hasNyuu };

  if (archiver) {
    logger.info('Archiver detected', { tool: archiver });
  } else {
    logger.warn('No archiver found on PATH (need rar or 7z)');
  }
  if (!hasParpar) logger.warn('parpar not found on PATH — install @animetosho/parpar globally');
  if (!hasNyuu) logger.warn('nyuu not found on PATH — install nyuu globally');

  return cached;
}

export function getCachedTools(): ToolAvailability | null {
  return cached;
}

export function resetToolCache(): void {
  cached = null;
}
