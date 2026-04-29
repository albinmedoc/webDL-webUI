# TODO

## Simplify svtplay-dl options UI

- [x] Done

Strip the DownloadForm down to the essentials and bake opinionated defaults
into the args. Rationale: most knobs aren't useful day-to-day, and the
current "Download subtitles" + "Download thumbnail" checkboxes produce
sidecar files that the Usenet auto-post pipeline then queues as separate
releases.

### Forced defaults (no UI control)
- Always pass `-S -M` (download subtitles + merge into the container).
- Always omit `-t` (no thumbnail sidecar).

### Keep in the form
- URL
- Quality
- Output format (mp4 / mkv)
- All episodes
- Create subfolder
- Output directory
- Token (optional)
- Username / password (optional, for premium content)
- Auto-post to Usenet + category (already conditional on `usenetEnabled`)
- "List Quality" button

### Remove from the form
- "Download subtitles" checkbox (always on)
- "Download thumbnail" checkbox (always off)
- Entire **Advanced Options** section:
  - `forceSubtitle`, `requireSubtitle`, `allSubtitles`, `rawSubtitles`,
    `convertSubtitleColors`, `mergeSubtitle`
  - `preferred` (DASH/HLS/HTTP) — let svtplay-dl auto-pick
  - `live` checkbox
  - `noMerge`

### Side-effect: removes the sidecar-gets-posted gap
Once subtitles are always merged and thumbnails are never downloaded, the
auto-post loop in `downloadHandler.ts:111` will only see the single video
file, so the "filter to media extension whitelist" gap raised after Phase
8 disappears on its own.

### Touch list
- `src/frontend/components/DownloadForm.vue` — strip the relevant
  checkboxes + the whole Advanced section.
- `src/frontend/components/OptionsPanel.vue` — likely shrinks or goes
  away entirely.
- `src/frontend/stores/downloadStore.ts` — remove deleted fields from
  `DownloadOptions` + `currentOptions` defaults; in `buildArgs()` (around
  line 511), force-push `-S -M` regardless of options and drop the
  removed flags.

## Tool availability check in UI

- [x] Done

Today `detectTools()` (rar / nyuu / parpar) only runs lazily inside the
Usenet pipeline, so a missing binary surfaces only after the user queues
their first job and watches it fail at `archiving`. Surface this earlier:

- Backend: new endpoint, e.g. `GET /api/usenet/tools`, returning the
  cached `ToolAvailability` from `services/usenet/tools.ts`. Run
  `detectTools()` once at app startup (in `app.ts` after the
  `usenetConfig.enabled` branch) so the cache is warm before the first
  HTTP call.
- Frontend: extend `SettingsModal.vue`'s "Connectivity tests" block with
  a "Tools" row showing pass/fail badges for `rar`, `nyuu`, and `parpar`
  — fetched on modal open alongside the existing `/api/usenet/config`
  call. If `rar` is missing, link to the README's RAR licensing section.
- Optional: also nudge the user on `DownloadForm.vue` when
  `autoPostUsenet` is ticked but `rar` is missing — small inline warning
  rather than letting the upload fail later.

## "Delete job" in the History view

- [x] Done

Old `usenet_jobs` rows accumulate in SQLite forever — there's a Retry
button but no way to prune. Rows are tiny, but the History list grows
unbounded.

- Backend: `DELETE /api/usenet/jobs/:id`. Refuse if the job is currently
  active (`isActive(id)`); 409 with the running state. Otherwise delete
  the row + the NZB file on disk if `nzbPath` is set.
- Frontend: trash-can button in each `UsenetHistory.vue` row, only shown
  for terminal states (`done`, `failed`, `cancelled`). Confirm dialog
  warning that the NZB will be deleted too.
- Consider a "Delete all completed older than N days" bulk action in the
  Settings modal once individual delete works.

## NZB-file retention policy

- [x] Done

`/data/nzb/*.nzb` grows unbounded — same shape of problem as the SQLite
rows above but on the filesystem.

- Add `NZB_RETENTION_DAYS` env var (default `0` = keep forever).
- On startup *and* once per N hours via `setInterval`, scan
  `indexerConfig.nzbOutputDir` and delete any `.nzb` whose mtime is older
  than the cutoff. Also null out the `nzbPath` column on the matching
  `usenet_jobs` rows so the History view's "Download NZB" button
  disappears for those entries (or surfaces a "(deleted)" hint).
- Document the variable in the README env-var table.
- Implementation note: the per-job delete in the previous TODO must
  share the NZB-removal helper so we have one path that does it
  correctly.

## Scene-style release naming for *arr auto-import

- [x] Done

svtplay-dl's filenames are inconsistent (sometimes `SxxExx`, sometimes a
date, never quality/codec tags) so Sonarr/Radarr can't reliably parse
grabs or imports today. `deriveBaseName(mediaPath)` in `pipeline.ts:63`
just strips the extension and that name flows through the RAR set, the
NZB filename, and `INDEXER_TITLE`. The file *inside* the archive also
keeps the svtplay-dl name, which is what *arr re-parses at import time.

Fix: rename the media file once, before Usenet enqueueing, into a
scene-style template. The renamed name then flows through every
downstream step automatically.

### New env vars
- `USENET_RELEASE_GROUP` (default e.g. `SVTDL`) — the `-GROUP` suffix
  appended by the template. Lets the user pick their own tag.
- `USENET_RELEASE_NAME_TEMPLATE` (default
  `{show}.S{season}E{episode}.{quality}.WEB-DL.h264-{group}`) — the
  full filename template, applied to each media file.

### Tokens
| Token       | Source                                                  |
|-------------|---------------------------------------------------------|
| `{show}`    | parsed from svtplay-dl filename (show name)             |
| `{season}`  | zero-padded season number                               |
| `{episode}` | zero-padded episode number                              |
| `{title}`   | episode title (may be empty)                            |
| `{year}`    | year extracted from filename or empty                   |
| `{quality}` | resolved from the quality dropdown (`720p` / `1080p`)   |
| `{group}`   | `USENET_RELEASE_GROUP`                                  |
| `{date}`    | `YYYY.MM.DD` for daily shows where SxxExx isn't present |

If a token can't be filled (e.g. `{episode}` for a one-off documentary),
strip it cleanly rather than leaving `S01E.` artefacts.

### Where the rename happens
- New helper, e.g. `services/usenet/releaseNamer.ts`, that takes
  `(mediaPath, downloadOptions)` and returns the new filename.
- Called from `downloadHandler.ts` *before* `enqueueJob()` (around the
  auto-post loop, line 111). Rename the file on disk, then pass the new
  path to `enqueueJob`. Persisted `mediaPath` is the renamed one.
- Parsing strategy: a small set of regexes for common svtplay-dl
  patterns (`-s01e02-`, dotted dates, etc.). On parse failure, log a
  warning and fall back to the original filename so the upload still
  goes through — broken naming shouldn't block a working upload.

### Why this only kicks in for Usenet
Users who don't auto-post don't want their downloads renamed; the rename
should be conditional on `autoPostUsenet` being set on the job, so the
local-only download path is unaffected.

### Documentation
Add both env vars to the README env-var table, with a short example of
how the template plus a parsed `programname-s02e04` filename produces
`Programname.S02E04.1080p.WEB-DL.h264-SVTDL.mkv`.

## Stop persisting credentials to localStorage

- [x] Done

`downloadStore.ts:142` (`persistJobs()`) serialises the full job array,
including `options.password`, `options.username`, and `options.token`,
into `localStorage` every time the watcher fires. Anything with read
access to the page (XSS, browser extensions, shared machine) can pull
plaintext credentials back out across reloads.

- Before writing to `localStorage`, build a sanitised copy of each job
  with `password`, `username`, and `token` stripped from `options`. Same
  for the in-memory restore path: don't restore those fields either —
  the user can re-enter them if they retry.
- While we're touching this, drop the redundant `console.log` calls in
  `loadPersistedJobs()` / `persistJobs()` — they're dev noise.
- After the simplify-form TODO lands, the persisted shape shrinks
  drastically anyway, so consider whitelisting the safe keys (`url`,
  `status`, `progress`, `logs`, `startTime`, `endTime`, `output`,
  `error`, `id`) instead of blacklisting credential fields — fewer
  footguns when fields get added later.

## Hardcoded Socket.IO URL breaks production

- [x] Done

`downloadStore.ts:234` calls `io('http://localhost:3001', ...)`. That
only works when the browser sits on the same host as the backend.
Anyone accessing the container from another machine (the normal Docker
deployment) hits a connection error.

- Replace with `io({ autoConnect: true, transports: ['websocket',
  'polling'] })` — same-origin connect, picks up whatever the user used
  to load the page.
- Verify the Vite dev proxy still works (it should — it already proxies
  `/api`, and Socket.IO defaults to `/socket.io` which Vite proxies the
  same way if configured; otherwise add `/socket.io` to the proxy in
  `vite.config.ts`).
- Smoke-test from another device on the LAN once changed.

## Default output directory falls back to `process.cwd()`

- [x] Done

`outputTracker.resolveOutputDir()` (`outputTracker.ts:13`) walks args
for `-o`/`--output` and otherwise defaults to `process.cwd()`. In
Docker that's `/app`, not the `/app/downloads` volume — so if a user
submits a form without filling the "Output Directory" field, files
land somewhere unmounted and the snapshot diff is taken in the wrong
directory.

- Add a `DOWNLOAD_OUTPUT_DIR` env var (default `/app/downloads` in the
  container, sensible local default elsewhere). Read it in
  `config/config.ts`.
- In `downloadHandler.handleStartDownload`, if `args` doesn't contain
  `-o`/`--output`, push `['-o', config.downloadOutputDir]` before
  spawning. That way both svtplay-dl *and* the snapshot tracker see
  the same path.
- Document in README env-var table.

## Tighten URL validation + apply it earlier

- [x] Done

Two related papercuts:
- `downloadService.validateUrl()` regex `/^https?:\/\/[^\s]+$/` accepts
  garbage like `http://x` — not a security issue (we `spawn` without a
  shell, so no command injection), but it lets bad input through to
  svtplay-dl which then fails with a cryptic error.
- `ValidationUtils.validateDownloadRequest()` (`progressUtils.ts:54`)
  only checks for *presence* of `url`/`downloadId`. The format check
  lives only in the service.

- Replace the regex with `new URL(url)` parse + check
  `protocol === 'http:' || 'https:'` and a non-empty hostname. Reject
  on parse failure.
- Move that check into `validateDownloadRequest` so the validation gate
  in `handleStartDownload` is the single source of truth; drop the
  duplicate from `downloadService`.

## Redact all sensitive flags in command logs

- [x] Done

`downloadService.sanitizeCommandForLogging()` (line 18) hides only
`--token` and `-p`. svtplay-dl also accepts `--password` (long form),
and the username (`-u`/`--username`) is arguably worth masking too. If
the flag set ever grows, this list will silently rot.

- Pull the redacted-flag set into a top-level `const SENSITIVE_FLAGS =
  new Set(['--token', '-p', '--password', '-u', '--username'])` and
  test membership instead of literal comparisons.
- Apply the same redaction in any other log path that echoes command
  args (grep for `args.join`).

## Convert remaining class-based modules to function modules

- [x] Done

For consistency with the newer Usenet-pipeline modules
(`outputTracker.ts`, `services/usenet/*`, `nntpProbe.ts`), convert:
- `services/downloadService.ts` — singleton class with `export default
  new DownloadService()`. Replace with a module that owns a
  module-scoped `Map<string, ChildProcess>` and exports plain
  functions.
- `handlers/downloadHandler.ts` — class wrapping a `Socket`. Replace
  with a factory function `createDownloadHandler(socket,
  usenetHandler)` returning the handler methods, mirroring how
  `usenetHandler` is wired in `socketController.ts`.

Pure refactor — no behaviour change. Defer until the simplify-form
TODO lands so the diff stays focused.
