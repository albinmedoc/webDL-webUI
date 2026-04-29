import fs from 'fs/promises';
import path from 'path';

import { usenetConfig } from '../../config/usenetConfig.js';
import { logger } from '../../utils/logger.js';

export interface ReleaseNamingInput {
  quality?: string | null;
}

interface ParsedName {
  show: string;
  season?: string;
  episode?: string;
  title?: string;
  year?: string;
  date?: string;
}

// Common svtplay-dl id+service trailers like "-abc123-svtplay" that we don't
// want to surface as the {title} token. Conservative: requires both halves to
// be ≥4 chars and the service half to be all letters, so legit suffixes like
// "-Part-2" survive.
const ID_SERVICE_SUFFIX = /-[a-z0-9]{4,}-[a-z]{4,15}$/i;

function titleCase(segment: string): string {
  return segment
    .split('.')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('.');
}

function normaliseName(raw: string): string {
  const compact = raw
    .replace(/[\s_]+/g, '.')
    .replace(/-+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  return titleCase(compact);
}

function stripIdServiceSuffix(s: string): string {
  return s.replace(ID_SERVICE_SUFFIX, '');
}

export function parseSvtplayDlFilename(filename: string): ParsedName | null {
  const noExt = filename.replace(/\.[^.]+$/, '');
  if (!noExt) return null;

  // Pattern 1: SxxExx with optional title trailer.
  //   programname.s01e02.episode_name-abc123-svtplay
  //   programname-s01e02
  const seasonEp = noExt.match(/^(.+?)[\-.\s]+s(\d{1,2})e(\d{1,3})(?:[\-.\s]+(.+?))?$/i);
  if (seasonEp) {
    const showRaw = seasonEp[1];
    const trailer = seasonEp[4] ? stripIdServiceSuffix(seasonEp[4]) : '';
    const titleClean = trailer ? normaliseName(trailer) : '';
    return {
      show: normaliseName(showRaw),
      season: seasonEp[2].padStart(2, '0'),
      episode: seasonEp[3].padStart(2, '0'),
      title: titleClean || undefined,
    };
  }

  // Pattern 2: dotted/dashed daily date.
  //   programname-2024-04-05
  //   programname.2024.04.05.episode_name
  const dated = noExt.match(/^(.+?)[\-.\s]+(\d{4})[\-.](\d{2})[\-.](\d{2})(?:[\-.\s]+(.+?))?$/);
  if (dated) {
    const trailer = dated[5] ? stripIdServiceSuffix(dated[5]) : '';
    const titleClean = trailer ? normaliseName(trailer) : '';
    return {
      show: normaliseName(dated[1]),
      year: dated[2],
      date: `${dated[2]}.${dated[3]}.${dated[4]}`,
      title: titleClean || undefined,
    };
  }

  // Pattern 3: no structured episode info — treat the whole stem as the show.
  const showOnly = normaliseName(stripIdServiceSuffix(noExt));
  if (!showOnly) return null;
  return { show: showOnly };
}

export function renderReleaseName(template: string, tokens: Record<string, string>): string {
  const substituted = template.replace(/\{(\w+)\}/g, (_, name) => tokens[name] ?? '');

  // Drop dot-segments that are empty or only carry the literal scaffolding of
  // an unfilled token (e.g. "SE" when both season+episode are missing,
  // "()" when {year} was inside parens, a lone dash, etc.).
  const segments = substituted.split('.').map((seg) =>
    seg.replace(/^[\-_]+|[\-_]+$/g, ''),
  );
  const kept = segments.filter((seg) => {
    if (seg === '') return false;
    if (/^(SE|S|E|\(\))$/i.test(seg)) return false;
    if (/^-+$/.test(seg)) return false;
    return true;
  });

  return kept.join('.').replace(/\.{2,}/g, '.').replace(/^[.\-]+|[.\-]+$/g, '');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function applyReleaseNaming(
  mediaPath: string,
  input: ReleaseNamingInput,
): Promise<string> {
  const dir = path.dirname(mediaPath);
  const base = path.basename(mediaPath);
  const ext = path.extname(base);

  const parsed = parseSvtplayDlFilename(base);
  if (!parsed) {
    logger.warn('releaseNamer could not parse filename; keeping original', { mediaPath });
    return mediaPath;
  }

  const tokens: Record<string, string> = {
    show: parsed.show,
    season: parsed.season ?? '',
    episode: parsed.episode ?? '',
    title: parsed.title ?? '',
    year: parsed.year ?? '',
    date: parsed.date ?? '',
    quality: input.quality ? `${input.quality}p` : '',
    group: usenetConfig.releaseGroup,
  };

  const stem = renderReleaseName(usenetConfig.releaseNameTemplate, tokens);
  if (!stem) {
    logger.warn('releaseNamer template produced empty name; keeping original', {
      mediaPath,
      template: usenetConfig.releaseNameTemplate,
    });
    return mediaPath;
  }

  const newBase = `${stem}${ext}`;
  if (newBase === base) return mediaPath;

  const newPath = path.join(dir, newBase);
  if (await pathExists(newPath)) {
    logger.warn('releaseNamer target exists; keeping original', { mediaPath, newPath });
    return mediaPath;
  }

  try {
    await fs.rename(mediaPath, newPath);
    logger.info('Renamed media for release naming', { from: mediaPath, to: newPath });
    return newPath;
  } catch (err) {
    logger.warn('releaseNamer rename failed; keeping original', {
      mediaPath,
      newPath,
      error: (err as Error).message,
    });
    return mediaPath;
  }
}
