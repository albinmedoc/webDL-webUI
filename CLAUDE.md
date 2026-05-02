# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web interface for [svtplay-dl](https://github.com/spaam/svtplay-dl) (a CLI tool for downloading from Swedish streaming services). Built with a Vue 3 frontend and Node.js/Express backend communicating over Socket.IO for real-time download progress.

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

# Docker
docker-compose up -d       # production on port 3001
```

There are no tests configured in this project.

## Architecture

**Frontend** (`src/frontend/`): Vue 3 + TypeScript + Vite + Pinia. Vite root is `src/frontend/`, builds to `dist/`.

**Backend** (`src/backend/`): Express + Socket.IO, run via `tsx` (TypeScript executed directly, no build step needed for dev). Has its own `tsconfig.json`.

### Communication Flow

All download operations use **Socket.IO** (not REST). The frontend Pinia store (`downloadStore.ts`) connects to the backend via WebSocket and emits/listens for events:
- `start-download`, `cancel-download`, `sync-downloads` (client -> server)
- `download-started`, `download-progress`, `download-completed`, `download-error`, `download-cancelled`, `download-sync`, `download-not-found` (server -> client)

The REST endpoints (`/api/health`, `/api/check-svtplay-dl`, `POST /api/download`) exist but the primary interface uses WebSocket.

### Backend Structure

- `app.ts` - Express + Socket.IO server setup
- `controllers/socketController.ts` - Routes socket events to handler methods
- `handlers/downloadHandler.ts` - Handles download lifecycle events
- `services/downloadService.ts` - Spawns `svtplay-dl` as child processes, manages active downloads
- `config/config.ts` - Server config (port, CORS)
- `utils/progressUtils.ts` - Parses svtplay-dl stdout for progress percentage

### Frontend State

`downloadStore.ts` is the central Pinia store. It manages the Socket.IO connection and mirrors the server's `download_jobs` table — jobs are not persisted in the browser. On (re)connect the store emits `sync-downloads` and the backend replies with the full list (`download-jobs-sync`); incremental changes flow as `download-job-upserted` / `download-job-deleted` events.

### Key Details

- Backend runs TypeScript directly via `tsx` in dev and Docker (no compile step)
- Frontend Vite dev server proxies `/api` requests to `localhost:3001`
- `svtplay-dl` must be installed on the system (Python package) for downloads to work
- Docker image uses Ubuntu 22.04 with Node.js 20, Python 3, ffmpeg, and svtplay-dl pre-installed
