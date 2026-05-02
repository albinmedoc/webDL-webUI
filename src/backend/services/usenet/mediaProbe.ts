import { spawn } from 'child_process';

import { logger } from '../../utils/logger.js';

export interface MediaInfo {
  /**
   * Scene-style codec token: 'h264', 'h265', 'av1', 'xvid', 'vp9'.
   * Falls back to the raw ffprobe codec_name when the value isn't in the
   * known map, so unusual codecs still surface in release names rather than
   * being silently dropped.
   */
  codec: string;
  /** Vertical pixel count, e.g. 1080 for 1080p. */
  height: number;
}

// ffprobe reports codec_name in libav's vocabulary; release-name conventions
// use the scene-tag form. Map the few that differ.
const CODEC_MAP: Record<string, string> = {
  h264: 'h264',
  hevc: 'h265',
  av1: 'av1',
  vp9: 'vp9',
  vp8: 'vp8',
  mpeg4: 'xvid',
};

function normaliseCodec(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return CODEC_MAP[lower] ?? lower;
}

/**
 * Run ffprobe against the given media file and return the first video
 * stream's codec + height. Returns null when ffprobe is missing, the file is
 * unreadable, or the output can't be parsed — callers should treat that as
 * "no info" and fall through to defaults.
 */
export function probeMedia(mediaPath: string): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,height',
      '-of', 'default=noprint_wrappers=1:nokey=0',
      mediaPath,
    ];

    let stdout = '';
    let stderr = '';

    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      logger.debug('ffprobe spawn failed', { mediaPath, error: err.message });
      resolve(null);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.debug('ffprobe non-zero exit', { mediaPath, code, stderr: stderr.trim() });
        resolve(null);
        return;
      }

      let codec: string | undefined;
      let height: number | undefined;
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^(codec_name|height)=(.+)$/);
        if (!m) continue;
        if (m[1] === 'codec_name') codec = m[2].trim();
        else if (m[1] === 'height') {
          const n = parseInt(m[2], 10);
          if (Number.isFinite(n) && n > 0) height = n;
        }
      }

      if (!codec || !height) {
        logger.debug('ffprobe output missing fields', { mediaPath, stdout: stdout.trim() });
        resolve(null);
        return;
      }

      resolve({ codec: normaliseCodec(codec), height });
    });
  });
}
