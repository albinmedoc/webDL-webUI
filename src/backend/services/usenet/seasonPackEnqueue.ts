import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';
import { snapshotDir } from '../../utils/dirSnapshot.js';
import type { DownloadJob } from '../downloadJobsService.js';
import { enqueueJob } from '../usenetService.js';

import { parseSvtplayDlFilename, renderSeasonReleaseName } from './releaseNamer.js';
import {
  checkSeasonPackEligibility,
  summarizeEligibility,
  type SeasonGroup,
} from './seasonPackEligibility.js';

// Newznab category ID for foreign TV — see releaseNamer's NEWZNAB_TV_FOREIGN.
// Season packs from svtplay-dl are always Foreign TV; the parser can't infer
// this from a pack name (no SxxExx tokens), so we set it explicitly.
const NEWZNAB_TV_FOREIGN = '5020';

export interface RunSeasonPackOptions {
  /** Manual mode skips the `allEpisodes` and skip-latest gates. */
  manual: boolean;
  /** Caller-supplied logger so eligibility lines surface in the right job log. */
  appendDownloadLog: (line: string) => void;
}

export interface RunSeasonPackResult {
  jobIds: string[];
  skipped: { show: string; season: string; reason: string }[];
}

/**
 * Group a completed download's files by (show, season), check pack
 * eligibility, and enqueue one Usenet job per eligible group. Logs every
 * decision into the supplied download log so users can see which seasons
 * packed and which were skipped (and why).
 *
 * Used by both the manual "pack as season" socket handler and the auto-pack
 * flow that runs at download completion.
 */
export async function runSeasonPackForDownload(
  downloadJob: DownloadJob,
  opts: RunSeasonPackOptions,
): Promise<RunSeasonPackResult> {
  const eligibility = checkSeasonPackEligibility(downloadJob, { manual: opts.manual });
  const result: RunSeasonPackResult = { jobIds: [], skipped: [] };

  if (eligibility.length === 0) {
    opts.appendDownloadLog('Season pack: no parseable (show, season) groups in this download');
    return result;
  }

  for (const line of summarizeEligibility(eligibility)) {
    opts.appendDownloadLog(line);
  }

  for (const entry of eligibility) {
    if (!entry.eligible) {
      result.skipped.push({
        show: entry.group.show,
        season: entry.group.season,
        reason: entry.reason ?? 'ineligible',
      });
      continue;
    }
    try {
      const jobId = await enqueuePackForGroup(
        downloadJob.id,
        entry.group,
        downloadJob.resolution,
        downloadJob.outputDir,
        opts.appendDownloadLog,
      );
      if (jobId) result.jobIds.push(jobId);
    } catch (err) {
      const error = (err as Error).message;
      logger.warn('runSeasonPackForDownload enqueue failed', {
        downloadId: downloadJob.id,
        season: entry.group.season,
        error,
      });
      opts.appendDownloadLog(
        `Season pack enqueue failed for S${entry.group.season}: ${error}`,
      );
      result.skipped.push({
        show: entry.group.show,
        season: entry.group.season,
        reason: error,
      });
    }
  }

  return result;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve each group member to a path that currently exists on disk. Tries
 * the stored path first; if missing, rescans the job's outputDir and matches
 * by parsed (season, episode). Lets the user rename files post-download (a
 * common workflow with external renamers) without breaking the pack.
 *
 * Throws when any member can't be located after the rescan.
 */
async function resolveExistingPackPaths(
  group: SeasonGroup,
  jobOutputDir: string | null,
  appendDownloadLog: (line: string) => void,
): Promise<string[]> {
  const stored = group.files.map((f) => f.path);

  const existence = await Promise.all(stored.map((p) => pathExists(p)));
  if (existence.every(Boolean)) return stored;

  const missingCount = existence.filter((e) => !e).length;
  if (!jobOutputDir) {
    throw new Error(
      `${missingCount} pack member(s) missing on disk and job has no outputDir to rescan`,
    );
  }

  appendDownloadLog(
    `Season pack: ${missingCount} of ${stored.length} stored path(s) missing for S${group.season}; rescanning ${jobOutputDir}`,
  );

  const snapshot = await snapshotDir(jobOutputDir);
  const onDiskByEp = new Map<string, string>();
  for (const diskPath of snapshot.keys()) {
    const parsed = parseSvtplayDlFilename(path.basename(diskPath));
    if (!parsed?.season || !parsed.episode) continue;
    const key = `${parsed.season}::${parsed.episode}`;
    if (!onDiskByEp.has(key)) onDiskByEp.set(key, diskPath);
  }

  const resolved: string[] = [];
  const stillMissing: string[] = [];
  for (let i = 0; i < stored.length; i++) {
    if (existence[i]) {
      resolved.push(stored[i]);
      continue;
    }
    const parsed = parseSvtplayDlFilename(path.basename(stored[i]));
    const key = parsed?.season && parsed.episode ? `${parsed.season}::${parsed.episode}` : null;
    const replacement = key ? onDiskByEp.get(key) : undefined;
    if (replacement) {
      resolved.push(replacement);
      appendDownloadLog(
        `Season pack: matched renamed file ${path.basename(stored[i])} → ${path.basename(replacement)}`,
      );
    } else {
      stillMissing.push(stored[i]);
    }
  }

  if (stillMissing.length > 0) {
    throw new Error(
      `${stillMissing.length} pack member(s) could not be located after rescan: ${stillMissing
        .map((p) => path.basename(p))
        .join(', ')}`,
    );
  }

  return resolved;
}

async function enqueuePackForGroup(
  downloadId: string,
  group: SeasonGroup,
  resolution: number | null,
  jobOutputDir: string | null,
  appendDownloadLog: (line: string) => void,
): Promise<string | null> {
  const mediaPaths = await resolveExistingPackPaths(group, jobOutputDir, appendDownloadLog);
  const named = await renderSeasonReleaseName(mediaPaths, {
    quality: resolution ? String(resolution) : null,
  });
  if (!named) {
    throw new Error('could not render season release name (parser/probe failed)');
  }

  // Synthesize a primary mediaPath whose basename is the canonical pack
  // name. Pipeline uses path.basename(mediaPath, ext) as the RAR base name
  // and the NZB filename. The path itself is never read from disk for
  // packs — sources come from `mediaPaths`.
  const ext = path.extname(mediaPaths[0]) || '.mkv';
  const synthesizedPrimary = path.join(
    path.dirname(mediaPaths[0]),
    `${named.releaseName}${ext}`,
  );

  const job = await enqueueJob({
    downloadId,
    mediaPath: synthesizedPrimary,
    mediaPaths,
    releaseType: 'season',
    episodeCount: group.episodeNumbers.length,
    category: NEWZNAB_TV_FOREIGN,
  });
  appendDownloadLog(
    `Enqueued season pack: ${named.releaseName} (job ${job.id}, ${group.episodeNumbers.length} episodes)`,
  );
  return job.id;
}
