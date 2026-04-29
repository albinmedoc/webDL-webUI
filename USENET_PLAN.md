# Usenet Upload Pipeline — Implementation Plan

Tracking progress for the feature defined in `TODO.md`.

## Stack decisions

- **ORM**: Drizzle (TypeScript-native, no codegen, supports SQLite + Postgres).
- **Frontend routing**: `vue-router` for tab switching between Downloads and Usenet History views.
- **Auto-post concurrency**: queue uploads immediately as each download finishes; `USENET_MAX_CONCURRENT` caps parallelism.
- **DB file**: `/data/svtplay-dl-webui.db` (mounted volume). Schema covers Usenet jobs/history only — existing download state stays in localStorage so feature-flag-off requirement is trivially met.
- **Indexer hook contract**: User sets `INDEXER_HOOK_SCRIPT=/path/to/script.sh`. Invoked with env vars: `NZB_FILE`, `RAR_PASSWORD`, `MEDIA_FILENAME`, `MEDIA_SIZE_BYTES`, `CATEGORY` (optional). Exit 0 = success; non-zero = failure (stderr captured to job log). **Contract requirement**: when invoked with single arg `--check`, script must validate connectivity/credentials and exit 0/non-zero without uploading. Sample `examples/drunkenslug-upload.sh` implements this.
- **Archiver**: RAR only. `which rar` at startup; cache result. If rar is missing at upload time, fail loudly with a clear error rather than producing a non-standard archive. (7z fallback considered and dropped — extra code path, unnecessary given user's setup.)
- **RAR settings**: `rar a -m0 -v50m` (store, no compression, 50 MB volumes). Run par2 on the rar files, not the original.
- **Docker RAR**: `ARG INSTALL_RAR=false` build arg. Default off (legal). User can also bind-mount host binary via `/usr/bin/rar:/usr/local/bin/rar:ro`. With default build, uploads fail until rar is provided one way or the other — surfaced via the Settings panel "Test" button and at upload time.
- **Pause**: skipped — Nyuu doesn't support resume mid-post. Cancel only, with explicit cleanup + partial-post warning.
- **Tests**: no unit tests (project has none). Document manual integration test in README.

## State machine

Granular states so retry can resume at the exact failure point:

```
queued → archiving → par2 → posting → posted → indexing → done
                                          ↓
                                      (NZB on disk;
                                       indexer hook
                                       can be retried
                                       in isolation)
```

Any state can transition to `failed` (with `failureState` recording where it died) or `cancelled`. Retry rules:
- Failed in `archiving` / `par2` / `posting` → restart from `archiving` (work dir was cleaned)
- Failed in `indexing` (NZB exists at `nzbPath`) → re-run indexer hook only
- Cancelled → no retry; user must re-queue from scratch

## Phased plan

### Phase 1 — Foundation: DB + config + feature flag ✅
- [x] Add `drizzle-orm` + `better-sqlite3` deps
- [x] Schema `usenet_jobs`: id, downloadId, mediaPath, mediaSizeBytes, state, failureState, progress, rarPassword, nzbPath, error, indexerResponse, category, createdAt, updatedAt
- [x] Drizzle config + migration runner on startup (creates `data/` dir, runs migrations)
- [x] `src/backend/config/usenetConfig.ts` reads env vars and exposes `usenetEnabled`. Vars:
  - `USENET_ENABLED`, `USENET_HOST`, `USENET_PORT`, `USENET_SSL`, `USENET_USER`, `USENET_PASS`
  - `USENET_CONNECTIONS` (default 20), `USENET_GROUPS` (default `alt.binaries.boneless`)
  - `USENET_PAR2_PERCENT` (default 10), `USENET_RAR_SIZE_MB` (default 50)
  - `USENET_MAX_CONCURRENT` (default 2)
  - `USENET_MIN_FREE_DISK_MULTIPLIER` (default 3)
  - `USENET_SUBJECT_TEMPLATE` (default `[{filename}] - "{rarname}" yEnc ({part}/{total})`; tokens `{filename}`, `{rarname}`, `{part}`, `{total}`, `{random}`)
  - `USENET_NFO_PATH` (optional path to NFO file copied into RAR set)
  - `USENET_NYUU_EXTRA_ARGS` (raw extra args appended to Nyuu CLI; advanced escape hatch)
  - `INDEXER_HOOK_SCRIPT`, `NZB_OUTPUT_DIR` (default `./data/nzb`)
- [x] **Startup recovery**: on boot, find all `usenet_jobs` in non-terminal states (`archiving`/`par2`/`posting`/`indexing`) and mark `failed` with error `"Server restart during job"`, recording `failureState`. Verified by inserting stuck rows and confirming recovery on restart.
- [x] Wire `usenetEnabled` into `/api/health` so frontend knows whether to show UI

### Phase 2 — Output file discovery ✅
- [x] `dirSnapshot()` util — recursive file+size list (skips ENOENT/EACCES, logs other errors)
- [x] In `downloadHandler`: snapshot output dir before spawn and after `close` (success); diff = produced media files. Discard on failure/cancel/spawn error.
- [x] Track paths in in-memory map keyed by `downloadId` (`outputTracker` service)
- [x] New socket event `download-files` (emitted only when files were produced); also included in `download-completed` payload as `outputDir` + `files`
- Note: caveat — concurrent downloads writing to the *same* output dir can have their "new files" sets cross-contaminated. Acceptable for now; auto-post in Phase 4 will need to be aware.

### Phase 3 — Usenet backend pipeline (no UI yet)

Split into 5 sub-batches, each a commit point.

#### Phase 3a — Foundation utilities + tool verification ✅
- [x] **npm packages confirmed**: `nyuu` (exposes `nyuu` bin) and `@animetosho/parpar` (exposes `parpar` bin). Note: bare `parpar` on npm is unrelated.
- [x] `usenet/tools.ts` — detect `rar` on PATH at startup, log result, cache; also probe `nyuu` and `parpar` and warn if missing
- [x] `usenet/password.ts` — crypto-grade 16-char password generator (rejection-sampled over 55-char ambiguity-safe alphabet)
- [x] `usenet/workspace.ts` — create / clean `data/work/<jobId>/` (overridable via `USENET_WORK_DIR`)
- [x] `usenet/diskspace.ts` — free-disk check via `fs.statfs`, against `mediaSize × USENET_MIN_FREE_DISK_MULTIPLIER`

#### Phase 3b — Offline pipeline wrappers ✅
- [x] `usenet/archiver.ts` — `createArchive({mediaPath, workDir, password, baseName, volumeSizeMb, nfoPath})` runs `rar a -m0 -v{size}m -hp{pw} -ep -y -idq`; refuses to start (clear error) if rar is missing; embeds NFO if provided; returns `{baseName, partFiles}`
- [x] `usenet/par2.ts` — `generatePar2({inputFiles, workDir, baseName, percent, sliceSize})` wraps ParPar with `-O` overwrite; returns `{par2Files}`
- [x] Smoke-tested parpar wrapper end-to-end. Note: ParPar 0.4.5 SIGSEGVs on Apple silicon (writes 0-byte par2). Works correctly on Linux x64 (Docker target). Wrapper correctly surfaces signal info.

#### Phase 3c — Network pipeline wrappers ✅
- [x] `usenet/poster.ts` — `postToUsenet({ files, workDir, nzbOutPath, config, subjectTemplate, dryRun, onProgress })`. `buildNyuuArgs()` is exported for reuse in tests/UI. `substituteRandomToken()` replaces `{random}` with crypto hex. Nyuu has no native dry-run; ours is "skip spawn, return constructed args" for validating config without requiring the binary.
- [x] `usenet/indexer.ts` — `runHook({nzbPath, title, category, password, group, mediaPath?})` + `runHookCheck()` (invokes script with `--check`). Captures stdout/stderr tail, masks password in startup logs.
- [x] Smoke-tested arg construction, `{random}` substitution, `runHook`, `runHookCheck`, and dry-run mode (without nyuu installed).

#### Phase 3d — Pipeline orchestrator + service ✅
- [x] `usenet/pipeline.ts` — orchestrator implementing the state machine. Each transition persisted via Drizzle. Cleanup matrix honored. Disk-space precheck on work root. Posting % parsed best-effort from nyuu stderr.
- [x] `usenet/spawnUtil.ts` — AbortError + attachAbort helper (SIGTERM with 5s SIGKILL escalation); threaded through all four wrappers.
- [x] `services/usenetService.ts` — active map, `USENET_MAX_CONCURRENT` cap, `enqueueJob` / `cancelJob` / `retryJob` / `subscribe` / `startupKick`. Retry resumes at `indexing` if hook failed with NZB on disk; otherwise restarts at `archiving`.
- [x] Wired `startupKick()` into `app.ts` so queued rows resume after restart.
- [x] Smoke-tested end-to-end without rar/nyuu installed: enqueue → archiving fails with clear error → state=`failed` with `failureState=archiving`; retry walks back through states.

#### Phase 3e — Socket handler + wiring ✅
- [x] `handlers/usenetHandler.ts` — `start-usenet-upload`, `cancel-usenet-upload`, `retry-usenet-upload`, `sync-usenet-uploads`. Subscribes to service observer per socket; disposes on disconnect. Also emits `usenet-enqueued`, `usenet-log`.
- [x] Registered in `socketController.ts`.
- [x] Usenet socket types added to `types/socket.ts`.
- [x] End-to-end socket smoke test verified: enqueue → state events → sync → retry — all events arrive at the client cleanly with no duplicates.

### Phase 4 — Auto-post trigger ✅
- [x] Add `autoPostUsenet` boolean (and optional `category`) to `DownloadOptions`
- [x] On `download-completed` (success): if flag set and `USENET_ENABLED`, queue usenet job per output file
- [x] Disk space pre-check: refuse if free < `mediaSize × USENET_MIN_FREE_DISK_MULTIPLIER` (default 3×). Emit `usenet-error` with reason; do not transition out of `queued`.
  - Implementation note: precheck moved into `enqueueJob` so it runs *before* the row is inserted (per spec: "do not transition out of queued"). Fixed an unrelated `scheduleNext` recursion bug discovered while smoke-testing.

### Phase 5 — Frontend: form checkbox + Upload Queue sidebar ✅
- [x] `DownloadForm.vue`: conditional "Auto-post to Usenet after download" checkbox (visible only when `usenetEnabled`); expand sub-card with optional category override
- [x] `usenetStore.ts` mirroring `downloadStore` patterns (reuses the same Pinia socket; auto-syncs on (re)connect)
- [x] `UsenetQueue.vue` sidebar — distinct state-coloured badges; cancel-confirm dialog with extra "orphaned articles on Eweka" warning when current state is `posting`
- [x] Layout adjustment in `App.vue` for second sidebar

### Phase 6 — Usenet History page ✅
- [x] Add `vue-router` dep; define routes for "/" (Downloads) and "/usenet" (History); add nav links in header
- [x] `UsenetHistory.vue` — table fetched from `GET /api/usenet/history` (paginated)
- [x] Filter by state, search by filename
- [x] "Show password" reveal (lazy-fetched from `GET /api/usenet/jobs/:id`), "Download NZB" link (`GET /api/usenet/jobs/:id/nzb`)
- [x] **Retry button** — wired to existing `retryJob` service logic (hook-only when `nzbPath` exists and `failureState === 'indexing'`; otherwise full restart from `archiving`). Tooltip reflects which path will be taken.

### Phase 7 — Settings panel ✅
- [x] Gear icon in nav (only shown when usenet is enabled) opens modal
- [x] Read-only Usenet config display (`getPublicConfig()` redacts password to `passSet` and hook script to `hookScriptSet`)
- [x] "Test NNTP" button → `services/usenet/nntpProbe.ts` opens TLS/TCP socket, runs banner → AUTHINFO USER/PASS → GROUP on first group, returns banner + auth response + duration
- [x] "Test indexer" button → invokes existing `runHookCheck()`; displays ok/error + stdout/stderr tail

### Phase 8 — Docker, docs, examples ✅
- [x] **Verified npm package names**: `nyuu` and `@animetosho/parpar` (already cached in `tools.ts` warning text — confirmed unchanged)
- [x] Dockerfile: `npm install -g nyuu @animetosho/parpar`
- [x] Dockerfile: `ARG INSTALL_RAR=false` block — when true, downloads rar from rarlab.com (amd64 + arm64) and installs to `/usr/local/bin/rar`
- [x] Dockerfile: creates `/data`, `/data/work`, `/data/nzb`; defaults `DB_PATH` / `USENET_WORK_DIR` / `NZB_OUTPUT_DIR` to those paths
- [x] Migrated Dockerfile from npm to pnpm to match the rest of the project
- [x] `docker-compose.yml`: `/data` volume, `INSTALL_RAR` build arg, commented env var block covering every USENET_*/INDEXER_* knob
- [x] README — full Usenet section with pipeline diagram, env var reference table, indexer hook contract, RAR licensing disclaimer, manual integration test walkthrough, operational caveats (cancel-during-posting orphans articles on Eweka, no resume mid-post, posting-plans note, nzbDAV `-m0` requirement), and the new REST endpoints in the API table
- [x] `examples/drunkenslug-upload.sh` — reference hook implementing both upload and `--check` modes against drunkenslug's API; demonstrates the full env-var contract

## Notes / context worth keeping

- Existing download state model stays untouched — `DownloadJob` lives in localStorage, in-memory `activeDownloads` Map on backend. Don't break this.
- svtplay-dl picks its own filename; we don't know it ahead of time. Hence dir snapshot diff in Phase 2.
- Nyuu progress: `--log-level 0 --log-time --progress` emits JSON on stdout.
- Eweka user has confirmed posting-enabled plan.
- Feature flag `USENET_ENABLED=false` (default) → entire subsystem invisible/inactive.
- Indexer-specific conventions (subject format, password.txt embedding, group choice, NFO) must be set via Nyuu config — the hook script can't fix them after posting. Hence configurable subject template, groups, NFO path, and Nyuu extra-args escape hatch.
- Cancelling mid-`posting` leaves orphaned articles on Eweka — surfaced in both server logs and frontend confirm dialog.
