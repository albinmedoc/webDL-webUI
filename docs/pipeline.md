# Pipeline: from svtplay-dl to *arr-stack

End-to-end reference for what happens between clicking **Add Download**
and Sonarr/Radarr finding the release. Every numbered step is a real
stage in the code; pointers to the source files are inline so this stays
trustworthy as the code evolves.

## High-level flow

```
   ┌────────────────┐
   │  DownloadForm  │  user submits URL + options
   └───────┬────────┘
           │ socket: start-download
           ▼
   ┌────────────────┐
   │  svtplay-dl    │  child process writes media to DOWNLOAD_OUTPUT_DIR
   └───────┬────────┘
           │ on close (exit 0) + autoPostUsenet, OR manual "Post to Usenet"
           ▼
   ┌────────────────┐
   │ release naming │  rename to scene-style file (Show.S01E02.WEB-DL...)
   └───────┬────────┘
           │
           ▼
   ┌────────────────┐
   │  /upload drop  │  symlink in UPLOAD_WATCH_DIR (the upload trigger)
   └───────┬────────┘
           │ fs.watch fires → enqueueJob (auto-detected category)
           ▼
   ┌────────────────┐
   │   enqueueJob   │  insert row in usenet_jobs (state=queued)
   └───────┬────────┘
           │ scheduler picks it up (max USENET_MAX_CONCURRENT)
           ▼
  archiving → par2 → posting → posted → indexing → done
           │                                     │ (symlink in /upload removed)
           └─── on cancel/error → cancelled / failed
```

## 1. Download (svtplay-dl)

**Trigger.** `DownloadForm.vue` emits a `start-download` socket event with
the URL and CLI args derived from form options (resolutions, all-episodes,
optional credentials, optional auto-post flag). Output is always MKV with
subtitles merged and dropped into a per-show subfolder
(`--subfolder -S -M --output-format mkv`). Multi-resolution selections fan
out into one socket event per resolution. Available resolutions are
populated by `GET /api/probe?url=…` (svtplay-dl `--list-quality`) on URL
blur — no job is created for the probe.

**What runs.** `downloadHandler.ts` → `downloadService.ts:38` spawns
`svtplay-dl` as a child process. stdout is parsed by
`progressUtils.ProgressParser` to extract the percent-complete number
shown in the UI. stderr is forwarded as job logs.

**Where it lands.** `DOWNLOAD_OUTPUT_DIR` (default `/data/downloads`).
`outputTracker` snapshots the directory before/after the process so we
know exactly which files svtplay-dl produced — that file list is what
the auto-post pipeline iterates over.

**Cancel.** `cancel-download` sends SIGTERM to the child. Partial files
are left on disk; the job is marked `cancelled` and not enqueued.

## 2. Release naming

Runs when the user either ticked **Auto-post to Usenet** at submit time
or pressed the per-file **Post to Usenet** button on a completed
download. Both paths funnel through `dropForUpload`
(`src/backend/services/uploadWatcher.ts`), which in turn calls
`applyReleaseNaming` from
`src/backend/services/usenet/releaseNamer.ts`.

**Why we rename.** Sonarr and Radarr identify shows/movies by parsing
the *filename* with a regex parser. svtplay-dl produces names like
`skavlan.s24e08.something-abc123-svtplay.mp4` that the *arr parser
cannot recognize. nzbDAV likewise relies on the filename — it has no
indexer search step, only directory imports. So both arr-stack paths
require scene-style naming.

**How it works.** `parseSvtplayDlFilename` recognises three patterns:

| Pattern | Example input | Captured tokens |
|---------|---------------|-----------------|
| `SxxExx` | `skavlan.s24e08.title-abc123-svtplay` | `show`, `season`, `episode`, `title` |
| Dated daily | `rapport-2024-04-05-abc123-svtplay` | `show`, `year`, `date` |
| Show-only | `drottningar-pa-savai-i-abc123-svtplay` | `show` |

The `-{8+ chars}-{service}` id+service trailer (e.g. `-abc123-svtplay`)
is stripped conservatively before captured tokens are normalised.

The captured tokens are substituted into `USENET_RELEASE_NAME_TEMPLATE`
(default `{show}.S{season}E{episode}.{quality}.WEB-DL.h264-{group}`).
Empty token scaffolds are dropped: a movie ends up as
`Show.Name.1080p.WEB-DL.h264-SVTDL.mp4` (the literal `S` and `E` from
the template are filtered out when both are unfilled).

**Available tokens:** `{show}`, `{season}`, `{episode}`, `{title}`,
`{year}`, `{date}`, `{quality}`, `{group}` (= `USENET_RELEASE_GROUP`,
default `SVTDL`).

**Caveat.** The default template doesn't include `{date}`, so dated
daily-show files lose their date in the rename. Add `{date}` to the
template if you publish dailies and want the date in the release name.

## 3. Newznab category auto-detection

`detectNewznabCategory(filename)` runs on the **original** svtplay-dl
filename (not the renamed one — the rename can drop the `{date}` token,
which would misclassify daily shows as movies):

| Filename has | Category | Newznab name |
|--------------|----------|--------------|
| `season` + `episode` | `5020` | TV/Foreign |
| `date` (dated daily) | `5020` | TV/Foreign |
| neither | `2010` | Movies/Foreign |

svtplay-dl only pulls from Swedish streaming services, so the *Foreign*
variants are always correct. The detected ID is persisted on the job
row (`category` column) and forwarded to the indexer hook as
`INDEXER_CATEGORY`. nzbDAV setups can ignore the value entirely.

If a programmatic caller of `enqueueJob` passes an explicit `category`,
it wins over auto-detection — the auto-detect is a fallback.

## 3b. Drop into the upload watch folder

After release naming, `dropForUpload` symlinks the renamed media into
`UPLOAD_WATCH_DIR` (default `/data/upload`). This folder is the single
trigger for usenet uploads — everything queued, whether kicked off by
auto-post or the manual button, lands here first. The downloaded media
itself stays in `DOWNLOAD_OUTPUT_DIR` untouched (the symlink is the
only thing the pipeline operates on).

`startUploadWatcher` runs `fs.watch` on the directory and, on each new
entry, calls `enqueueJob` with the (now-renamed) symlink as
`mediaPath`. On startup the watcher also rescans the directory once so
files left over from a crash mid-post get picked back up. When a job
hits `done`, the watcher removes the symlink so the same path can be
re-posted later.

External drops (files placed in the folder by something other than this
app) are **not** supported as a documented contract — there is no
stability check, so a half-written file would race the watcher.

## 4. Enqueue

`usenetService.enqueueJob` validates and inserts the job:

- Checks `USENET_ENABLED`.
- `fs.stat`s the media path and rejects zero-byte files.
- Checks free disk on the work root (need
  `USENET_MIN_FREE_DISK_MULTIPLIER` × media size).
- Generates a 16-char random RAR password
  (`generatePassword`), stored on the job row so the user can reveal it
  in the History view later.
- Inserts a row in `usenet_jobs` with `state='queued'`.
- Calls `scheduleNext()`, which starts pipelines until
  `USENET_MAX_CONCURRENT` is hit.

The job row is the source of truth: state machine, progress, error
message, NZB path, indexer response, and category all live on it
(see `db/schema.ts`).

## 5. Pipeline stages

State sequence:
`queued → archiving → par2 → posting → posted → indexing → done`.
Failure routes to `failed` (with `failureState` set to whichever stage
threw). Cancel routes to `cancelled`. Source:
`src/backend/services/usenet/pipeline.ts`.

### 5a. archiving

Runs `rar` with these flags:

```
rar a -m0 -v{USENET_RAR_SIZE_MB}m -hp<password> -ep -y -idq <baseName>.rar <media> [<nfo>]
```

- `-m0` — store, no compression. **Required for nzbDAV** (it cannot
  stream compressed RAR volumes; do not override this in
  `USENET_NYUU_EXTRA_ARGS` either).
- `-v{N}m` — split into `{N}`-MB volumes (default 50).
- `-hp<password>` — encrypt headers + data with the per-job password.
- `-ep` — exclude path info from archive entries.
- `-y -idq` — assume yes, quiet.
- Optional NFO: if `USENET_NFO_PATH` points at a file, it's added to the
  archive alongside the media.

Output: `<baseName>.rar`, `<baseName>.part2.rar`, … in the job's work
directory under `USENET_WORK_DIR/<jobId>/`.

`rar` is **not bundled** in the Docker image (license restriction); see
the README's "RAR licensing" section.

### 5b. par2

Runs `parpar` (npm-installed, MIT-licensed) over the RAR volumes:

```
parpar -s 1M -r {USENET_PAR2_PERCENT}% -o <baseName>.par2 -O -- <rar files>
```

`USENET_PAR2_PERCENT` (default 10) is the redundancy level — 10% extra
recovery data, the de-facto standard for Usenet posts. Output:
`<baseName>.par2` + a fan of `<baseName>.volNNN+MM.par2`.

### 5c. posting

Runs `nyuu` (npm-installed, MIT-licensed):

```
nyuu -h <host> -P <port> -u <user> -p <pass> -n <connections>
     -g <groups> -s "<subject>" -o <nzbPath>
     [-S]                                # if USENET_SSL=true
     [<USENET_NYUU_EXTRA_ARGS>]
     -- <rar files> <par2 files>
```

**Subject template.** `USENET_SUBJECT_TEMPLATE` (default
`[{filename}] - "{rarname}" yEnc ({part}/{total})`). nyuu fills the
per-article tokens; `{random}` (if used) is substituted server-side
with 8 hex chars before nyuu runs.

**Progress.** Lines with `NN%` from nyuu's stdout drive the job's
progress bar (capped at 99 until the close event lands).

**Output.** A single NZB at `NZB_OUTPUT_DIR/<baseName>.nzb`. Once
written, the job transitions to `posted` and the NZB path is persisted.

**Cancel during `posting` is destructive.** Some articles are already on
the news server but no NZB was generated, so they cannot be retrieved.
The cancel-confirm dialog warns about this. Cancel earlier
(`archiving`/`par2`) or wait it out if you care about the bandwidth.

### 5d. indexing (hook)

If `INDEXER_HOOK_SCRIPT` is configured, `runHook` spawns it with these
environment variables (and no CLI arguments):

| Env var | Source |
|---------|--------|
| `INDEXER_NZB_PATH` | absolute path to the NZB on disk |
| `INDEXER_TITLE` | `baseName` (the renamed scene-style name, no extension) |
| `INDEXER_CATEGORY` | auto-detected Newznab ID (`5020` / `2010`) |
| `INDEXER_PASSWORD` | the per-job RAR password |
| `INDEXER_GROUP` | first entry of `USENET_GROUPS` |
| `INDEXER_MEDIA_PATH` | original media path (pre-archive) |

Anything the script writes to stdout is recorded as the job's
`indexerResponse` and shown in the History view. Non-zero exit ==
`failed` at stage `indexing`. See
[examples/drunkenslug-upload.sh](../examples/drunkenslug-upload.sh) for
a working reference.

If `INDEXER_HOOK_SCRIPT` is empty, the stage is a no-op — useful for
nzbDAV-only setups where the NZB landing in `NZB_OUTPUT_DIR` is the
whole story.

### 5e. done

`progress = 100`, work directory is removed. The NZB stays in
`NZB_OUTPUT_DIR` until you delete the job (or `NZB_RETENTION_DAYS`
cleans it up — `0` = keep forever, the default).

## 6. *arr-stack discovery (the part that lives outside this app)

Two integration paths, served by the same NZB:

### Path A — Newznab indexer (Prowlarr / NZBHydra2 / DrunkenSlug etc.)

Your `INDEXER_HOOK_SCRIPT` registers each NZB with a Newznab-compatible
indexer. The indexer stores it with the supplied `INDEXER_CATEGORY` so
Sonarr/Radarr (via Prowlarr) can find it under TV/Foreign or
Movies/Foreign. Sonarr's release-name parser extracts show/season/episode
from `INDEXER_TITLE` — which is why release naming has to be correct.

The reference script
[examples/drunkenslug-upload.sh](../examples/drunkenslug-upload.sh)
handles this for DrunkenSlug; private indexers usually expose a similar
upload endpoint.

### Path B — nzbDAV (mount-only, no indexer)

nzbDAV watches `NZB_OUTPUT_DIR` (or wherever you point it), exposes the
NZBs as a virtual filesystem, and Sonarr/Radarr import directly from the
mount. No search step, no category filtering — only the **release name**
matters for the *arr parser. Set `INDEXER_HOOK_SCRIPT` to empty to skip
stage 5d entirely.

**Important nzbDAV constraint** (already enforced in this codebase): RAR
archives must be `-m0` (store) — nzbDAV cannot stream compressed
volumes.

## 7. Settings & where things are configured

Every knob in this pipeline is controlled by a key in the registry
(`src/backend/config/registry.ts`). Each key has:

- a default,
- an env-var name (e.g. `USENET_RAR_SIZE_MB`),
- a UI override stored in the SQLite `app_settings` table.

Resolution order at startup: **env var > DB row > default**. Keys set
via env are "pinned" — the Settings UI marks them with a lock icon and
refuses to edit them until the env var is removed. See
[`.env.example`](../.env.example) for the full list of env-var names.

Live updates from the UI mutate the in-memory `usenetConfig` /
`indexerConfig` singletons in place, so no restart is needed for most
changes (NNTP credentials etc. take effect on the next job).

## 8. Troubleshooting checklist

- **Stuck at `archiving`.** Is `rar` on the PATH? The Docker image needs
  `--build-arg INSTALL_RAR=true` or a bind-mounted host binary.
- **Stuck at `posting` with `441` from server.** Your news account is
  read-only / no posting plan. (Eweka in particular requires an explicit
  posting-enabled tier.)
- **Sonarr can't find the release.** Check the renamed filename in the
  Usenet History view. If it doesn't look scene-style
  (`Show.S01E02...`), the parser failed — adjust
  `USENET_RELEASE_NAME_TEMPLATE` or report the offending svtplay-dl
  filename so the parser can be extended.
- **Daily shows misclassified as movies (cat 2010).** The default
  release-name template strips the date. Add `{date}` to
  `USENET_RELEASE_NAME_TEMPLATE` — auto-detect already runs on the
  original (pre-rename) filename, so the persisted category is correct;
  this only affects what the renamed file looks like.
- **Indexer hook fails.** History view shows the hook's stderr tail.
  Re-run `--check` from Settings → Test indexer hook to confirm
  connectivity in isolation.
- **NZB never appears.** Check `NZB_OUTPUT_DIR` exists and is writable;
  check job logs for nyuu output. A failed NZB write surfaces as
  `nyuu reported success but no NZB at <path>`.
