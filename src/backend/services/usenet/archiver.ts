import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';

import { AbortError, attachAbort } from './spawnUtil.js';
import { getCachedTools } from './tools.js';

export interface CreateArchiveOptions {
  // One or more files to pack into the same RAR set. Single-file uploads pass
  // a one-element array; season packs pass every episode.
  mediaPaths: string[];
  workDir: string;
  password: string;
  baseName: string;
  volumeSizeMb: number;
  nfoPath?: string | null;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
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
      'rar binary not found on PATH. Install rar (RARLAB) or bind-mount it into the container at /usr/local/bin/rar.'
    );
  }
}

function quoteForLog(value: string): string {
  if (/[\s'"$]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

export async function createArchive(opts: CreateArchiveOptions): Promise<CreateArchiveResult> {
  const { mediaPaths, workDir, password, baseName, volumeSizeMb, nfoPath, onProgress, signal } = opts;

  ensureRarAvailable();
  if (signal?.aborted) throw new AbortError();

  if (!Number.isFinite(volumeSizeMb) || volumeSizeMb <= 0) {
    throw new Error(`volumeSizeMb must be a positive number, got ${volumeSizeMb}`);
  }
  if (!password) {
    throw new Error('password is required for archive creation');
  }
  if (!baseName) {
    throw new Error('baseName is required for archive creation');
  }
  if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) {
    throw new Error('mediaPaths must be a non-empty array');
  }

  await fs.mkdir(workDir, { recursive: true });

  const archiveName = `${baseName}.rar`;
  const inputs = [...mediaPaths];
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
    const detach = attachAbort(proc, signal);

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

    proc.on('error', (err) => {
      detach();
      reject(err);
    });
    proc.on('close', (code, sig) => {
      detach();
      if (signal?.aborted) {
        reject(new AbortError(`rar aborted (signal=${sig})`));
      } else if (code === 0) {
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
