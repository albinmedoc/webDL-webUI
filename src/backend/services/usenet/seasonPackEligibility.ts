import path from 'path';

import { config as serverConfig } from '../../config/config.js';
import type { DownloadFile, DownloadJob } from '../downloadJobsService.js';

import { parseSvtplayDlFilename } from './releaseNamer.js';

export interface SeasonGroup {
  show: string;
  season: string;
  /** Numeric season number — used to identify the "latest" season. */
  seasonNumber: number;
  files: DownloadFile[];
  episodeNumbers: number[];
}

export interface SeasonEligibility {
  group: SeasonGroup;
  eligible: boolean;
  /** Populated when eligible=false. Surfaced in the download-job log. */
  reason?: string;
}

export interface EligibilityOptions {
  /** Manual pack action — skips the `allEpisodes` and skip-latest gates. */
  manual?: boolean;
}

interface ParsedFile {
  file: DownloadFile;
  show: string;
  season: string;
  seasonNumber: number;
  episodeNumber: number;
}

function parseEpisodeNumber(season: string): number | null {
  const n = parseInt(season, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bucket downloaded files by (show, season). Files with unparseable filenames
 * or no season info (date-based shows, specials) are dropped silently — they
 * can never be packed and there's no useful diagnostic to surface.
 */
export function groupBySeason(files: DownloadFile[]): SeasonGroup[] {
  const buckets = new Map<string, ParsedFile[]>();

  for (const file of files) {
    const base = path.basename(file.path);
    const parsed = parseSvtplayDlFilename(base);
    if (!parsed?.season || !parsed.episode) continue;
    const seasonNum = parseEpisodeNumber(parsed.season);
    const epNum = parseEpisodeNumber(parsed.episode);
    if (seasonNum === null || epNum === null) continue;
    const key = `${parsed.show}::${parsed.season}`;
    const entry: ParsedFile = {
      file,
      show: parsed.show,
      season: parsed.season,
      seasonNumber: seasonNum,
      episodeNumber: epNum,
    };
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const groups: SeasonGroup[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0];
    bucket.sort((a, b) => a.episodeNumber - b.episodeNumber);
    groups.push({
      show: first.show,
      season: first.season,
      seasonNumber: first.seasonNumber,
      files: bucket.map((b) => b.file),
      episodeNumbers: bucket.map((b) => b.episodeNumber),
    });
  }
  return groups;
}

/**
 * A season is "complete on disk" when its episode numbers form a contiguous
 * run starting at 1 (1..N with no gaps). We can't ask the source what the
 * true total is without a network round-trip, so we treat the highest local
 * episode as the cap and enforce that every lower number is present.
 *
 * This is paired with the `allEpisodes` intent flag at the call-site — when
 * the user asked for the whole series and download status is `completed`,
 * a contiguous run is a strong signal that we got everything available.
 */
function isContiguousFromOne(episodes: number[]): boolean {
  if (episodes.length === 0) return false;
  const sorted = [...new Set(episodes)].sort((a, b) => a - b);
  if (sorted[0] !== 1) return false;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return false;
  }
  return true;
}

/**
 * Decide which (show, season) groups in a completed download are eligible to
 * be packed. Returns one entry per group with an `eligible` flag and a
 * human-readable reason when ineligible.
 *
 * Gates (auto path):
 *   1. `allEpisodes === true` on the source job — skipped in manual mode.
 *   2. `status === 'completed'` — always enforced.
 *   3. Contiguous E01..ENMax — always enforced.
 *   4. Not the highest season in the set — skipped in manual mode and
 *      controlled by `seasonPackSkipLatest` setting.
 */
export function checkSeasonPackEligibility(
  job: DownloadJob,
  options: EligibilityOptions = {},
): SeasonEligibility[] {
  const groups = groupBySeason(job.files);
  if (groups.length === 0) return [];

  const isManual = options.manual === true;

  if (!isManual && !job.allEpisodes) {
    return groups.map((group) => ({
      group,
      eligible: false,
      reason: 'download was not started with --all-episodes',
    }));
  }

  if (job.status !== 'completed') {
    return groups.map((group) => ({
      group,
      eligible: false,
      reason: `download status is ${job.status}, expected completed`,
    }));
  }

  // "Latest" is the highest season number among the groups *in this download*.
  // For multi-season downloads this excludes only the top one; for a
  // single-season download the only group is the "latest" and gets skipped
  // (auto mode).
  let latestSeasonNumber = -Infinity;
  for (const g of groups) {
    if (g.seasonNumber > latestSeasonNumber) latestSeasonNumber = g.seasonNumber;
  }

  return groups.map((group): SeasonEligibility => {
    if (!isContiguousFromOne(group.episodeNumbers)) {
      const list = group.episodeNumbers.join(', ');
      return {
        group,
        eligible: false,
        reason: `season ${group.season} not contiguous from 1 (have: ${list})`,
      };
    }

    if (!isManual && serverConfig.seasonPackSkipLatest && group.seasonNumber === latestSeasonNumber) {
      return {
        group,
        eligible: false,
        reason: `season ${group.season} is the latest and seasonPackSkipLatest is enabled`,
      };
    }

    // S00 / specials: never auto-pack. Manual is allowed.
    if (!isManual && group.seasonNumber === 0) {
      return {
        group,
        eligible: false,
        reason: 'season 0 / specials are not auto-packed',
      };
    }

    return { group, eligible: true };
  });
}

/**
 * Convenience: log the outcome of `checkSeasonPackEligibility` against a
 * download job so users can see why a pack was (or wasn't) created. Caller
 * is responsible for actually pushing the lines into the job log.
 */
export function summarizeEligibility(results: SeasonEligibility[]): string[] {
  return results.map((r) =>
    r.eligible
      ? `Season pack eligible: ${r.group.show} S${r.group.season} (${r.group.episodeNumbers.length} episodes)`
      : `Season pack skipped: ${r.group.show} S${r.group.season} — ${r.reason}`,
  );
}
