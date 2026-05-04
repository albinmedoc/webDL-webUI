# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web interface for [svtplay-dl](https://github.com/spaam/svtplay-dl) (a CLI tool for downloading from Swedish streaming services). Built with a Vue 3 frontend and Node.js/Express backend communicating over Socket.IO.

The app has two main features:
1. **Downloads** — queue, run, and monitor `svtplay-dl` jobs.
2. **Usenet upload pipeline** (optional, enabled via `USENET_ENABLED=true`) — auto-archive completed downloads with RAR + par2, post to a Usenet provider via nyuu, and notify a Newznab indexer. Jobs and history are persisted in SQLite.

External automation (n8n, Sonarr-like polling, etc.) integrates over a REST API + outbound webhooks. The browser UI uses Socket.IO; both layers ride the same underlying job state.

## Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Frontend dev server (port 5173, proxies /api to backend)
pnpm run dev

# Backend dev server (port 3001)
pnpm run dev:server        # one-shot
pnpm run dev:server:watch  # with file watching

# Build frontend (vue-tsc + vite, outputs to dist/)
pnpm run build

# Type-check both frontend and backend
pnpm run type-check

# Database (Drizzle + better-sqlite3)
pnpm run db:generate       # generate migration from schema changes
pnpm run db:migrate        # apply pending migrations

# Docker
docker-compose up -d       # production on port 3001
```

There are no tests configured in this project.

## Architecture

**Frontend** (`src/frontend/`): Vue 3 + TypeScript + Vite + Pinia. Vite root is `src/frontend/`, builds to `dist/`.

**Backend** (`src/backend/`): Express + Socket.IO, run via `tsx` (TypeScript executed directly, no build step needed for dev or in Docker). Has its own `tsconfig.json`. Entry point is `server.ts`, which calls `startServer()` from `app.ts`.

**Persistence**: SQLite via `better-sqlite3` + Drizzle ORM. The DB file is `DB_PATH` (defaults to `./data/svtplay-dl-webui.db` in dev, `/data/svtplay-dl-webui.db` in Docker). Migrations live in `src/backend/db/migrations/` and run automatically at startup.

### Communication Flow

The browser communicates with the backend over **Socket.IO** for everything related to job lifecycle. REST is used for one-shot queries (settings, history pagination, file/NZB downloads, probe).

#### Download events
- Client → server: `start-download`, `cancel-download`, `remove-download-job`, `clear-completed-downloads`, `clear-old-downloads`, `clear-all-downloads`, `sync-downloads`, `health-check`, `check-svtplay-dl`
- Server → client: `download-jobs-sync` (full list on connect/sync), `download-job-upserted` (incremental insert/update), `download-job-deleted`, `download-error` (validation), `health-status`, `svtplay-dl-status`

#### Usenet events
- Client → server: `start-usenet-upload`, `cancel-usenet-upload`, `retry-usenet-upload`, `sync-usenet-uploads`
- Server → client: equivalent sync/upsert/delete events emitted by `UsenetHandler`

#### REST endpoints (see `middleware/setup.ts`)
The full schema is served at `GET /api/openapi.json` and rendered as Swagger UI at `GET /api/docs`. Highlights:

System / read-side (no auth):
- `GET /api/health` — Docker healthcheck, returns version + `usenetEnabled`
- `GET /api/probe?url=` — list available qualities for a URL
- `GET|PUT /api/settings`, `DELETE /api/settings/:key` — runtime-tunable settings (registry-backed)
- `GET /api/usenet/config|tools`, `POST /api/usenet/test/nntp`

Job control (writes — gated by API key when `apiKey` is set):
- `POST /api/downloads` — queue a new download. Body: `{ url, args?, options: { resolution?, allEpisodes?, autoPostUsenet?, autoPackSeason? } }`. Returns `{ job }`.
- `GET /api/downloads` — paginated list, optional `status` filter
- `GET /api/downloads/:id`, `POST /api/downloads/:id/cancel`, `DELETE /api/downloads/:id?deleteFiles=1`
- `POST /api/usenet/uploads` — drop a media path into the upload watcher
- `POST /api/usenet/jobs/:id/cancel`, `POST /api/usenet/jobs/:id/retry`
- `GET /api/usenet/history`, `GET /api/usenet/jobs/:id`, `DELETE /api/usenet/jobs/:id`, `POST /api/usenet/jobs/bulk-delete`
- `GET /api/usenet/jobs/:id/nzb` — download generated NZB
- `GET /api/downloads/jobs/:id/files/download?path=` — stream a downloaded file (path-validated against the job's allowed roots)

Webhooks (auth-gated):
- `GET /api/webhooks/events` — list event names
- `GET|POST /api/webhooks`, `GET|PUT|DELETE /api/webhooks/:id`
- `POST /api/webhooks/:id/test` — fire a one-shot test payload
- `GET /api/webhooks/:id/deliveries` — recent attempts (with status, error, retry schedule)

#### Auth
The `apiKey` setting (env `API_KEY`, or `/api/settings` at runtime) gates write endpoints. Empty = auth disabled (back-compat for the socket-only deployment). Auth check is `Authorization: Bearer <key>` with timing-safe compare. Reads stay open so the bundled UI keeps working without a key.

#### Webhook delivery
Outbound webhooks (POST JSON) fire on job lifecycle changes. Events: `download.queued|started|completed|failed|cancelled`, `usenet.queued|posted|done|failed|cancelled`. Empty `events` array on a webhook = subscribe to all (wildcard). Each delivery includes:
- `X-Webhook-Event` header (event name)
- `X-Webhook-Delivery` header (delivery uuid)
- `X-Webhook-Signature: sha256=<hex>` HMAC of the body using the webhook's `secret` (omitted when secret is empty)
- JSON body: `{ event, timestamp, data: { job: <job-row> } }`

Failed deliveries (non-2xx, timeout, network error) retry with exponential backoff at 1m / 5m / 30m / 2h / 12h. After 5 failed attempts the delivery is marked `failed`. State is persisted in `webhook_deliveries` and recovered on restart.

### Backend Structure

- `server.ts` — entry point (just calls `startServer`)
- `app.ts` — `createApp()`/`startServer()`: runs migrations, recovers interrupted jobs, starts schedulers, wires Socket.IO + Express
- `config/`
  - `config.ts` — server config (port, dirs, CORS); reads from settings registry
  - `registry.ts` — typed settings registry (env var + DB-overridable)
  - `usenetConfig.ts` — Usenet provider/indexer config + `enabled` gate
- `controllers/socketController.ts` — routes socket events to handlers
- `handlers/`
  - `downloadHandler.ts` — download lifecycle events
  - `usenetHandler.ts` — Usenet upload lifecycle events
- `middleware/setup.ts` — Express middleware + REST route definitions
- `db/`
  - `schema.ts` — `download_jobs`, `usenet_jobs`, `app_settings`, `webhooks`, `webhook_deliveries` tables
  - `client.ts` — better-sqlite3 client + `runMigrations()`
  - `migrate.ts` — standalone migration runner (used by `db:migrate`)
  - `migrations/` — Drizzle migration files
- `services/`
  - `downloadService.ts` — spawns `svtplay-dl` child processes, manages active downloads
  - `downloadJobsService.ts` — DB CRUD for download jobs + interrupted-job recovery
  - `downloadOrchestrator.ts` — socket-free entrypoint for starting/cancelling/removing a download. Both the Socket.IO handler and the REST endpoint route through here, so lifecycle (auto-post-usenet, auto-pack-season) lives in one place.
  - `outputTracker.ts` — tracks files produced by an svtplay-dl run
  - `qualityProbe.ts` — runs `svtplay-dl --get-only-episodes` (or similar) to enumerate qualities
  - `svtplayDlConfig.ts` — writes a config file consumed by svtplay-dl (note: must be nested under a `default:` key)
  - `settingsService.ts` — load/update/clear DB-side overrides for the registry
  - `uploadWatcher.ts` — watches the upload-drop directory for files to enqueue
  - `usenetService.ts` — Usenet job DB CRUD, queueing, observer/subscription API
  - `usenetSummary.ts` — `toUsenetJobSummary` (shared between socket handler and webhook payloads)
  - `usenetRecoveryService.ts` — recovers interrupted Usenet jobs at startup
  - `webhooksService.ts` — webhook + delivery DB CRUD
  - `webhookDispatcher.ts` — observer subscriptions, HMAC signing, retry worker, delivery recovery
  - `usenet/` — pipeline stages: `archiver` (RAR), `par2`, `poster` (nyuu), `indexer`, `mediaProbe`, `nntpProbe`, `releaseNamer`, `password`, `workspace`, `nzbFiles`, `nzbRetention`, `tools` (detect nyuu/parpar/rar), `pipeline` (orchestrator)
- `utils/` — `progressUtils` (parse svtplay-dl stdout), `logger`, etc.
- `types/` — shared types, including socket event payload shapes

### Frontend State

Two Pinia stores in `src/frontend/stores/`:

- **`downloadStore.ts`** — central store for downloads. Manages the Socket.IO connection and mirrors the server's `download_jobs` table. On (re)connect the store emits `sync-downloads` and the backend replies with `download-jobs-sync`; incremental changes flow as `download-job-upserted` / `download-job-deleted`. Also handles quality-probing (`/api/probe`) and selected-resolutions fan-out at submit time.
- **`usenetStore.ts`** — analogous store for Usenet uploads.

Views: `Downloads.vue` and `UsenetHistory.vue` (router in `src/frontend/router/`).

Note: jobs are **persisted server-side in SQLite**. The browser caches a copy in the Pinia store but treats the DB as the source of truth — anything missing from the next sync is removed locally.

### Key Details

- Backend runs TypeScript directly via `tsx` in dev and Docker (no compile step). `pnpm run build:backend` and `start:prod` exist but aren't used by the default Docker image.
- Frontend Vite dev server proxies `/api` requests to `localhost:3001`.
- `svtplay-dl` must be installed on the system (Python package) for downloads to work.
- The Usenet pipeline additionally needs `nyuu`, `parpar`, and `rar` on `PATH`. `tools.ts` probes for them; `/api/usenet/tools` reports availability.
- Docker image: `node:20-slim` (Debian-based) with Node.js 20, Python 3, ffmpeg, `svtplay-dl` (pip), and `nyuu` + `@animetosho/parpar` (npm) pre-installed.
- Docker volume layout (`/data`): `svtplay-dl-webui.db`, `downloads/`, `work/` (Usenet staging), `nzb/` (generated NZBs).
- Key env vars: `PORT`, `DB_PATH`, `DOWNLOAD_OUTPUT_DIR`, `USENET_WORK_DIR`, `NZB_OUTPUT_DIR`, `USENET_ENABLED`, `API_KEY`, plus Usenet provider/indexer config (see `config/usenetConfig.ts`). Most are also overridable at runtime via `/api/settings`.
- Hooks: `hooks/indexers/*.sh` are shell scripts invoked by the indexer stage to notify external indexers.

### Automation / n8n integration

The intended automation pattern is "n8n is the orchestrator, this app is the engine." Two SVT Play feed shapes are useful:
- `https://www.svtplay.se/<show-slug>/rss.xml` — per-show feed with `<pubDate>` + episode-level `<link>`s pointing at `https://www.svtplay.se/video/<id>/<slug>/<episode>`. Pass these straight to `POST /api/downloads`.
- `https://www.svtplay.se/kategori/<category>/rss.xml` — catalog feed (no pubDate, link is show URL). Useful for "alert me on new shows," not for tracking new episodes.

Typical flow:
1. n8n RSS Trigger node on the per-show feed.
2. HTTP Request node → `POST /api/downloads` with `Authorization: Bearer <API_KEY>` and `{ url: item.link }`.
3. Configure a webhook in this app pointing at an n8n Webhook node. Subscribe to `download.completed` or `usenet.done` to trigger downstream actions (Plex refresh, Discord ping, etc.).
