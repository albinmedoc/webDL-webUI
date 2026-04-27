import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';

import { getCachedTools } from './tools.js';

export interface CreateArchiveOptions {
  mediaPath: string;
  workDir: string;
  password: string;
  baseName: string;
  volumeSizeMb: number;
  nfoPath?: string | null;
  onProgress?: (line: string) => void;
}

export interface CreateArchiveResult {
  baseName: string;
  partFiles: string[];
}

function ensureRarAvailable(): void {
  const tools = getCachedTools();
  if (!tools) {
    throw new Error('Tool detection has not run yet — call detectTools() before createArchive()');
  }
  if (!tools.rar) {
    throw new Error(
      'rar binary not found on PATH. Install rar (RARLAB) or mount it via volume; see docs for INSTALL_RAR build arg.'
    );
  }
}

function quoteForLog(value: string): string {
  if (/[\s'"$]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

export async function createArchive(opts: CreateArchiveOptions): Promise<CreateArchiveResult> {
  const { mediaPath, workDir, password, baseName, volumeSizeMb, nfoPath, onProgress } = opts;

  ensureRarAvailable();

  if (!Number.isFinite(volumeSizeMb) || volumeSizeMb <= 0) {
    throw new Error(`volumeSizeMb must be a positive number, got ${volumeSizeMb}`);
  }
  if (!password) {
    throw new Error('password is required for archive creation');
  }
  if (!baseName) {
    throw new Error('baseName is required for archive creation');
  }

  await fs.mkdir(workDir, { recursive: true });

  const archiveName = `${baseName}.rar`;
  const inputs = [mediaPath];
  if (nfoPath) inputs.push(nfoPath);

  const args = [
    'a',
    '-m0',
    `-v${volumeSizeMb}m`,
    `-hp${password}`,
    '-ep',
    '-y',
    '-idq',
    archiveName,
    ...inputs,
  ];

  const safeArgs = args.map((a, i) => (i === 3 ? '-hp***' : a)).map(quoteForLog);
  logger.info(`rar ${safeArgs.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('rar', args, { cwd: workDir });

    let stderrBuf = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgress) {
        for (const line of text.split(/\r?\n/)) {
          if (line) onProgress(line);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rar exited with code ${code}: ${stderrBuf.trim()}`));
      }
    });
  });

  const entries = await fs.readdir(workDir);
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const multiVolume = new RegExp(`^${escaped}\\.part\\d+\\.rar$`);
  const single = new RegExp(`^${escaped}\\.rar$`);
  const partFiles = entries
    .filter((name) => multiVolume.test(name) || single.test(name))
    .sort()
    .map((name) => path.join(workDir, name));

  if (partFiles.length === 0) {
    throw new Error(`rar reported success but no part files found in ${workDir}`);
  }

  return { baseName, partFiles };
}
