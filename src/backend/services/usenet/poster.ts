import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import type { UsenetConfig } from '../../config/usenetConfig.js';
import { logger } from '../../utils/logger.js';

import { getCachedTools } from './tools.js';

export interface PostToUsenetOptions {
  files: string[];
  workDir: string;
  nzbOutPath: string;
  config: UsenetConfig;
  subjectTemplate?: string;
  onProgress?: (line: string) => void;
  dryRun?: boolean;
}

export interface PostToUsenetResult {
  nzbPath: string;
  args: string[];
  skipped: boolean;
}

function ensureNyuuAvailable(): void {
  const tools = getCachedTools();
  if (!tools) {
    throw new Error('Tool detection has not run yet — call detectTools() before postToUsenet()');
  }
  if (!tools.nyuu) {
    throw new Error('nyuu binary not found on PATH. Install with: npm install -g nyuu');
  }
}

export function substituteRandomToken(template: string): string {
  return template.replace(/\{random\}/g, () => randomBytes(4).toString('hex'));
}

function maskCredentialArg(args: string[]): string[] {
  return args.map((a, i) => {
    if (i === 0) return a;
    const prev = args[i - 1];
    if (prev === '-p' || prev === '--password') return '***';
    return a;
  });
}

export function buildNyuuArgs(opts: {
  config: UsenetConfig;
  files: string[];
  nzbOutPath: string;
  subjectTemplate?: string;
}): string[] {
  const { config, files, nzbOutPath, subjectTemplate } = opts;

  if (!config.host) throw new Error('USENET_HOST is not set');
  if (!config.user) throw new Error('USENET_USER is not set');
  if (!config.pass) throw new Error('USENET_PASS is not set');
  if (config.groups.length === 0) throw new Error('USENET_GROUPS is empty');

  const subject = subjectTemplate ?? config.subjectTemplate;
  const finalSubject = substituteRandomToken(subject);

  const args = [
    '-h', config.host,
    '-P', String(config.port),
    '-u', config.user,
    '-p', config.pass,
    '-n', String(config.connections),
    '-g', config.groups.join(','),
    '-s', finalSubject,
    '-o', nzbOutPath,
  ];

  if (config.ssl) args.push('-S');

  if (config.nyuuExtraArgs.length > 0) {
    args.push(...config.nyuuExtraArgs);
  }

  args.push('--');
  args.push(...files);

  return args;
}

export async function postToUsenet(opts: PostToUsenetOptions): Promise<PostToUsenetResult> {
  const { files, workDir, nzbOutPath, config, subjectTemplate, onProgress, dryRun } = opts;

  if (files.length === 0) throw new Error('postToUsenet requires at least one file');

  const args = buildNyuuArgs({ config, files, nzbOutPath, subjectTemplate });

  logger.info(`nyuu ${maskCredentialArg(args).join(' ')}`);

  if (dryRun) {
    logger.info('postToUsenet dry-run: skipping nyuu invocation');
    return { nzbPath: nzbOutPath, args, skipped: true };
  }

  ensureNyuuAvailable();
  await fs.mkdir(path.dirname(nzbOutPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('nyuu', args, { cwd: workDir });

    let stderrBuf = '';
    let stderrTail: string[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
      if (!onProgress) return;
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line) onProgress(line);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
        if (onProgress) onProgress(line);
      }
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const summary = stderrTail.length ? stderrTail.slice(-10).join('\n') : stderrBuf.trim();
        reject(new Error(`nyuu exited with code=${code} signal=${signal}: ${summary}`));
      }
    });
  });

  try {
    await fs.access(nzbOutPath);
  } catch {
    throw new Error(`nyuu reported success but no NZB at ${nzbOutPath}`);
  }

  return { nzbPath: nzbOutPath, args, skipped: false };
}
