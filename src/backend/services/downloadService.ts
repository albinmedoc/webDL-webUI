import { spawn, ChildProcess } from 'child_process';
import { SvtplayDlStatus } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface DownloadProcess {
  process: ChildProcess;
  command: string;
  url: string;
}

const SENSITIVE_FLAGS = new Set([
  '--token',
  '-p',
  '--password',
  '-u',
  '--username',
]);

const activeDownloads: Map<string, ChildProcess> = new Map();

export function sanitizeCommandForLogging(command: string, args: string[]): string {
  const sanitizedArgs = args.map((arg, index) => {
    const prev = args[index - 1];
    if (prev !== undefined && SENSITIVE_FLAGS.has(prev)) {
      return '***HIDDEN***';
    }
    return arg;
  });
  return `${command} ${sanitizedArgs.join(' ')}`;
}

export function startDownload(url: string, args: string[], downloadId: string): DownloadProcess {
  const command = 'svtplay-dl';
  const commandArgs = [...args, url];

  logger.debug(`Executing: ${sanitizeCommandForLogging(command, commandArgs)}`);

  const proc = spawn(command, commandArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeDownloads.set(downloadId, proc);

  return {
    process: proc,
    command: sanitizeCommandForLogging(command, commandArgs),
    url,
  };
}

export function cancelDownload(downloadId: string): boolean {
  const proc = activeDownloads.get(downloadId);
  if (!proc) return false;
  proc.kill('SIGTERM');
  activeDownloads.delete(downloadId);
  return true;
}

export function isDownloadActive(downloadId: string): boolean {
  return activeDownloads.has(downloadId);
}

export function getActiveDownloadIds(): string[] {
  return Array.from(activeDownloads.keys());
}

export function removeDownload(downloadId: string): void {
  activeDownloads.delete(downloadId);
}

export function checkSvtplayDlAvailability(): Promise<SvtplayDlStatus> {
  return new Promise((resolve) => {
    const proc = spawn('svtplay-dl', ['--version'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({
          available: true,
          version: output.trim(),
        });
      } else {
        resolve({
          available: false,
          error: errorOutput || 'svtplay-dl not found',
        });
      }
    });

    proc.on('error', (error: Error) => {
      resolve({
        available: false,
        error: `svtplay-dl not found: ${error.message}`,
      });
    });
  });
}
