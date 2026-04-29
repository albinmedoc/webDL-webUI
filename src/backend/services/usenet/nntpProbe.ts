import net from 'net';
import tls from 'tls';

import type { UsenetConfig } from '../../config/usenetConfig.js';

export interface NntpProbeResult {
  ok: boolean;
  banner?: string;
  authResponse?: string;
  groupResponse?: string;
  error?: string;
  durationMs: number;
}

const PROBE_TIMEOUT_MS = 10_000;

interface Conversation {
  readLine: () => Promise<string>;
  send: (line: string) => void;
  close: () => void;
}

function openConnection(config: UsenetConfig, signal?: AbortSignal): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    const socket = config.ssl
      ? tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
          rejectUnauthorized: false,
        })
      : net.connect({ host: config.host, port: config.port });

    socket.setTimeout(PROBE_TIMEOUT_MS);

    socket.once('error', onError);
    socket.once('timeout', () => onError(new Error('connection timed out')));

    if (signal) {
      const onAbort = () => onError(new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('close', () => signal.removeEventListener('abort', onAbort));
    }

    const onReady = () => {
      let buf = '';
      const queue: string[] = [];
      const waiters: ((line: string) => void)[] = [];

      socket.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx: number;
        while ((idx = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const waiter = waiters.shift();
          if (waiter) waiter(line);
          else queue.push(line);
        }
      });

      const readLine = (): Promise<string> =>
        new Promise((resolveLine) => {
          const queued = queue.shift();
          if (queued !== undefined) {
            resolveLine(queued);
            return;
          }
          waiters.push(resolveLine);
        });

      const send = (line: string): void => {
        socket.write(`${line}\r\n`);
      };

      const close = (): void => {
        try {
          socket.write('QUIT\r\n');
        } catch {
          // ignore
        }
        socket.end();
        socket.destroy();
      };

      resolve({ readLine, send, close });
    };

    if (config.ssl) socket.once('secureConnect', onReady);
    else socket.once('connect', onReady);
  });
}

export async function probeNntp(
  config: UsenetConfig,
  signal?: AbortSignal,
): Promise<NntpProbeResult> {
  const start = Date.now();
  const result: NntpProbeResult = { ok: false, durationMs: 0 };

  if (!config.host) {
    return { ok: false, error: 'USENET_HOST is not set', durationMs: 0 };
  }
  if (!config.user || !config.pass) {
    return { ok: false, error: 'USENET_USER / USENET_PASS not set', durationMs: 0 };
  }
  if (config.groups.length === 0) {
    return { ok: false, error: 'USENET_GROUPS is empty', durationMs: 0 };
  }

  let convo: Conversation | null = null;

  try {
    convo = await openConnection(config, signal);

    const banner = await convo.readLine();
    result.banner = banner;
    if (!banner.startsWith('200') && !banner.startsWith('201')) {
      throw new Error(`unexpected greeting: ${banner}`);
    }

    convo.send(`AUTHINFO USER ${config.user}`);
    const userResp = await convo.readLine();
    if (!userResp.startsWith('381')) {
      throw new Error(`AUTHINFO USER rejected: ${userResp}`);
    }

    convo.send(`AUTHINFO PASS ${config.pass}`);
    const passResp = await convo.readLine();
    result.authResponse = passResp;
    if (!passResp.startsWith('281')) {
      throw new Error(`AUTHINFO PASS rejected: ${passResp}`);
    }

    convo.send(`GROUP ${config.groups[0]}`);
    const groupResp = await convo.readLine();
    result.groupResponse = groupResp;
    if (!groupResp.startsWith('211')) {
      throw new Error(`GROUP ${config.groups[0]} rejected: ${groupResp}`);
    }

    result.ok = true;
  } catch (err) {
    result.error = (err as Error).message;
  } finally {
    if (convo) convo.close();
    result.durationMs = Date.now() - start;
  }

  return result;
}
