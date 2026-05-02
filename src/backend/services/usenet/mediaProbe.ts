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
  /**
   * Scene-style language token derived from audio stream tags:
   * - one distinct ISO 639 code → mapped token (`SWEDISH`, `ENGLISH`, …)
   * - two or more distinct codes → `MULTi`
   * - zero tagged streams (or all `und`/missing) → null; callers should
   *   fall back to a sensible default.
   */
  language: string | null;
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

// ISO 639-1 (2-letter) and 639-2 (3-letter) → scene-style language token.
// Covers the languages we realistically see on Nordic streaming services and
// the most common dub/subtitle source languages. Unknown codes fall through
// to null so we don't manufacture nonsense tokens.
const LANGUAGE_MAP: Record<string, string> = {
  swe: 'SWEDISH', sv: 'SWEDISH',
  eng: 'ENGLISH', en: 'ENGLISH',
  nor: 'NORWEGIAN', no: 'NORWEGIAN', nob: 'NORWEGIAN', nno: 'NORWEGIAN',
  dan: 'DANISH', da: 'DANISH',
  fin: 'FINNISH', fi: 'FINNISH',
  isl: 'ICELANDIC', is: 'ICELANDIC', ice: 'ICELANDIC',
  ger: 'GERMAN', de: 'GERMAN', deu: 'GERMAN',
  fre: 'FRENCH', fr: 'FRENCH', fra: 'FRENCH',
  spa: 'SPANISH', es: 'SPANISH',
  ita: 'ITALIAN', it: 'ITALIAN',
  por: 'PORTUGUESE', pt: 'PORTUGUESE',
  rus: 'RUSSIAN', ru: 'RUSSIAN',
  jpn: 'JAPANESE', ja: 'JAPANESE',
  chi: 'CHINESE', zh: 'CHINESE', zho: 'CHINESE',
  kor: 'KOREAN', ko: 'KOREAN',
  ara: 'ARABIC', ar: 'ARABIC',
  hin: 'HINDI', hi: 'HINDI',
  nld: 'DUTCH', nl: 'DUTCH', dut: 'DUTCH',
  pol: 'POLISH', pl: 'POLISH',
};

function normaliseCodec(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return CODEC_MAP[lower] ?? lower;
}

function normaliseLanguageCode(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (!lower || lower === 'und' || lower === 'undetermined') return null;
  return LANGUAGE_MAP[lower] ?? null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  height?: number;
  tags?: { language?: string };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
}

function deriveLanguage(streams: FfprobeStream[]): string | null {
  const tokens = new Set<string>();
  for (const s of streams) {
    if (s.codec_type !== 'audio') continue;
    const raw = s.tags?.language;
    if (!raw) continue;
    const token = normaliseLanguageCode(raw);
    if (token) tokens.add(token);
  }
  if (tokens.size === 0) return null;
  if (tokens.size === 1) return tokens.values().next().value ?? null;
  return 'MULTi';
}

/**
 * Run ffprobe against the given media file and return video codec/height plus
 * a derived audio-language token. Returns null when ffprobe is missing, the
 * file is unreadable, or the output can't be parsed — callers should treat
 * that as "no info" and fall through to defaults.
 */
export function probeMedia(mediaPath: string): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,height:stream_tags=language',
      '-of', 'json',
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

      let parsed: FfprobeOutput;
      try {
        parsed = JSON.parse(stdout) as FfprobeOutput;
      } catch (err) {
        logger.debug('ffprobe JSON parse failed', { mediaPath, error: (err as Error).message });
        resolve(null);
        return;
      }

      const streams = parsed.streams ?? [];
      const video = streams.find((s) => s.codec_type === 'video');
      const codec = video?.codec_name?.trim();
      const height = typeof video?.height === 'number' && video.height > 0 ? video.height : undefined;

      if (!codec || !height) {
        logger.debug('ffprobe output missing video fields', { mediaPath });
        resolve(null);
        return;
      }

      resolve({
        codec: normaliseCodec(codec),
        height,
        language: deriveLanguage(streams),
      });
    });
  });
}
