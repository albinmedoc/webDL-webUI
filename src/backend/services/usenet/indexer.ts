import { spawn } from 'child_process';
import fs from 'fs/promises';

import { indexerConfig } from '../../config/usenetConfig.js';
import { logger } from '../../utils/logger.js';

import { AbortError, attachAbort } from './spawnUtil.js';

export interface IndexerHookEnv {
  nzbPath: string;
  title: string;
  category: string;
  password: string;
  group: string;
  mediaPath?: string;
}

export interface IndexerHookResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  response?: string;
}

const STDIO_TAIL_LIMIT = 100;

async function ensureExecutable(scriptPath: string): Promise<void> {
  try {
    await fs.access(scriptPath, fs.constants.F_OK);
  } catch {
    throw new Error(`INDEXER_HOOK_SCRIPT not found: ${scriptPath}`);
  }
}

function maskEnv(env: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = { ...env };
  if (masked.INDEXER_PASSWORD) masked.INDEXER_PASSWORD = '***';
  return masked;
}

function tail(buf: string, lines: number): string {
  const split = buf.split(/\r?\n/);
  return split.slice(-lines).join('\n');
}

function buildEnv(hookEnv: IndexerHookEnv): Record<string, string> {
  const env: Record<string, string> = {
    INDEXER_NZB_PATH: hookEnv.nzbPath,
    INDEXER_TITLE: hookEnv.title,
    INDEXER_CATEGORY: hookEnv.category,
    INDEXER_PASSWORD: hookEnv.password,
    INDEXER_GROUP: hookEnv.group,
  };
  if (hookEnv.mediaPath) env.INDEXER_MEDIA_PATH = hookEnv.mediaPath;
  return env;
}

async function spawnHook(
  args: string[],
  extraEnv: Record<string, string>,
  signal?: AbortSignal
): Promise<IndexerHookResult> {
  const scriptPath = indexerConfig.hookScript;
  if (!scriptPath) {
    throw new Error('INDEXER_HOOK_SCRIPT is not configured');
  }
  await ensureExecutable(scriptPath);
  if (signal?.aborted) throw new AbortError();

  return await new Promise<IndexerHookResult>((resolve, reject) => {
    const proc = spawn(scriptPath, args, {
      env: { ...process.env, ...extraEnv },
    });
    const detach = attachAbort(proc, signal);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      detach();
      reject(err);
    });
    proc.on('close', (code, sig) => {
      detach();
      if (signal?.aborted) {
        reject(new AbortError(`indexer hook aborted (signal=${sig})`));
        return;
      }
      const tailOut = tail(stdout, STDIO_TAIL_LIMIT);
      const tailErr = tail(stderr, STDIO_TAIL_LIMIT);
      resolve({
        ok: code === 0,
        exitCode: code,
        signal: sig,
        stdout: tailOut,
        stderr: tailErr,
        response: tailOut.trim() || undefined,
      });
    });
  });
}

export async function runHook(hookEnv: IndexerHookEnv, signal?: AbortSignal): Promise<IndexerHookResult> {
  const env = buildEnv(hookEnv);
  logger.info('Running indexer hook', {
    script: indexerConfig.hookScript,
    env: maskEnv(env),
  });
  return await spawnHook([], env, signal);
}

export async function runHookCheck(signal?: AbortSignal): Promise<IndexerHookResult> {
  if (!indexerConfig.hookScript) {
    throw new Error('INDEXER_HOOK_SCRIPT is not configured');
  }
  logger.info('Running indexer hook --check', { script: indexerConfig.hookScript });
  return await spawnHook(['--check'], {}, signal);
}
