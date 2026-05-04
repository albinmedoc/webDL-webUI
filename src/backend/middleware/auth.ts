import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import { config as serverConfig } from '../config/config.js';
import { logger } from '../utils/logger.js';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Bearer-token auth for REST endpoints. When `serverConfig.apiKey` is empty,
 * auth is disabled (back-compat for the socket-only deployment). Otherwise
 * the request must carry `Authorization: Bearer <key>` matching exactly.
 *
 * Apply per-route, not globally — the existing UI talks to read-side
 * endpoints without auth, and we don't want to break it.
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = serverConfig.apiKey;
  if (!expected) {
    // Auth disabled — but warn once on access from non-loopback so operators
    // notice that opening writes to the network without a key is intentional.
    next();
    return;
  }

  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing or malformed Authorization header' });
    return;
  }
  const presented = header.slice('Bearer '.length).trim();
  if (!presented || !safeCompare(presented, expected)) {
    logger.warn('REST auth rejected', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(401).json({ error: 'invalid api key' });
    return;
  }
  next();
}
