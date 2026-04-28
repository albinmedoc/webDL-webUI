import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';

import { AbortError, attachAbort } from './spawnUtil.js';
import { getCachedTools } from './tools.js';

export interface GeneratePar2Options {
  inputFiles: string[];
  workDir: string;
  baseName: string;
  percent: number;
  sliceSize?: string;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export interface GeneratePar2Result {
  par2Files: string[];
}

function ensureParparAvailable(): void {
  const tools = getCachedTools();
  if (!tools) {
    throw new Error('Tool detection has not run yet — call detectTools() before generatePar2()');
  }
  if (!tools.parpar) {
    throw new Error(
      'parpar binary not found on PATH. Install with: npm install -g @animetosho/parpar'
    );
  }
}

export async function generatePar2(opts: GeneratePar2Options): Promise<GeneratePar2Result> {
  const { inputFiles, workDir, baseName, percent, sliceSize = '1M', onProgress, signal } = opts;

  ensureParparAvailable();
  if (signal?.aborted) throw new AbortError();

  if (inputFiles.length === 0) {
    throw new Error('generatePar2 requires at least one input file');
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new Error(`par2 percent must be in (0, 100], got ${percent}`);
  }
  if (!baseName) {
    throw new Error('baseName is required for par2 generation');
  }

  await fs.mkdir(workDir, { recursive: true });

  const outputBase = `${baseName}.par2`;

  const args = [
    '-s', sliceSize,
    '-r', `${percent}%`,
    '-o', outputBase,
    '-O',
    '--',
    ...inputFiles,
  ];

  logger.info(`parpar ${args.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('parpar', args, { cwd: workDir });
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
        reject(new AbortError(`parpar aborted (signal=${sig})`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`parpar exited with code=${code} signal=${sig}: ${stderrBuf.trim()}`));
      }
    });
  });

  const entries = await fs.readdir(workDir);
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const par2Re = new RegExp(`^${escaped}\\.par2$|^${escaped}\\.vol\\d+\\+\\d+\\.par2$`);
  const par2Files = entries
    .filter((name) => par2Re.test(name))
    .sort()
    .map((name) => path.join(workDir, name));

  if (par2Files.length === 0) {
    throw new Error(`parpar reported success but no .par2 files found in ${workDir}`);
  }

  return { par2Files };
}
