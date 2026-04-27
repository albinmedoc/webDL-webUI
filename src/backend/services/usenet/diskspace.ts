import fs from 'fs/promises';

import { usenetConfig } from '../../config/usenetConfig.js';

export interface DiskCheckResult {
  ok: boolean;
  required: number;
  available: number;
  multiplier: number;
  reason?: string;
}

export async function getFreeBytes(targetPath: string): Promise<number> {
  const stat = await fs.statfs(targetPath);
  return Number(stat.bsize) * Number(stat.bavail);
}

export async function checkDiskSpace(
  targetPath: string,
  mediaSizeBytes: number,
  multiplier: number = usenetConfig.minFreeDiskMultiplier
): Promise<DiskCheckResult> {
  const required = Math.ceil(mediaSizeBytes * multiplier);
  let available: number;
  try {
    available = await getFreeBytes(targetPath);
  } catch (err: any) {
    return {
      ok: false,
      required,
      available: 0,
      multiplier,
      reason: `statfs failed for ${targetPath}: ${err?.message ?? err}`,
    };
  }

  if (available < required) {
    return {
      ok: false,
      required,
      available,
      multiplier,
      reason: `Insufficient free space at ${targetPath}: need ${required} bytes (${multiplier}× media), have ${available}`,
    };
  }

  return { ok: true, required, available, multiplier };
}
