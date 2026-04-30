import { spawn } from 'child_process';

const PROBE_TIMEOUT_MS = 30_000;

export interface ProbeResult {
  heights: number[];
}

export async function probeQualities(url: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('svtplay-dl', ['--list-quality', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Probe timed out'));
    }, PROBE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const heights = parseListQuality(`${stdout}\n${stderr}`);
      if (heights.length > 0) {
        resolve({ heights });
        return;
      }
      const lastErr = stderr.trim().split('\n').pop()
        || stdout.trim().split('\n').pop()
        || `svtplay-dl exited with code ${code}`;
      reject(new Error(lastErr));
    });
  });
}

function parseListQuality(text: string): number[] {
  const heights = new Set<number>();
  for (const line of text.split('\n')) {
    const stripped = line.replace(/^INFO:\s*/, '').trim();
    if (stripped.startsWith('Quality:')) continue;
    const match = stripped.match(/^\d+\s+\S+\s+\S+\s+\d+x(\d+)\b/);
    if (match) {
      heights.add(parseInt(match[1], 10));
    }
  }
  return [...heights].sort((a, b) => b - a);
}
