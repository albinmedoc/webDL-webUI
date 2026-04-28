import type { ChildProcess } from 'child_process';

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export function attachAbort(proc: ChildProcess, signal?: AbortSignal): () => void {
  if (!signal) return () => {};

  if (signal.aborted) {
    proc.kill('SIGTERM');
    return () => {};
  }

  const onAbort = () => {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 5000).unref();
  };
  signal.addEventListener('abort', onAbort);
  return () => signal.removeEventListener('abort', onAbort);
}

export function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}
