import path from 'path';

import { logger } from '../../utils/logger.js';
import type { DownloadJob } from '../downloadJobsService.js';
import { enqueueJob } from '../usenetService.js';

import { renderSeasonReleaseName } from './releaseNamer.js';
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

async function enqueuePackForGroup(
  downloadId: string,
  group: SeasonGroup,
  resolution: number | null,
  appendDownloadLog: (line: string) => void,
): Promise<string | null> {
  const mediaPaths = group.files.map((f) => f.path);
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
