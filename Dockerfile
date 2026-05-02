# syntax=docker/dockerfile:1.6

# ───────────────────── Frontend build stage ─────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ─────────────────────── Prod deps stage ────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ─────────────────────── Runtime stage ──────────────────────────
FROM node:20-slim

ARG BUILDTIME
ARG VERSION
ARG REVISION

WORKDIR /app

# Single-layer runtime install: pull in runtime deps + temporary build tools
# (parpar compiles a native addon from source), install everything that needs
# them, then purge the build tools so they don't bloat the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
        python3 python3-pip \
        ffmpeg \
        make g++ \
    && pip3 install --no-cache-dir --break-system-packages svtplay-dl \
    && npm install -g nyuu @animetosho/parpar tsx \
    && npm cache clean --force \
    && apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=frontend-builder /app/dist ./dist
COPY package.json pnpm-lock.yaml ./
COPY src/backend ./src/backend
COPY hooks ./hooks
RUN chmod +x ./hooks/indexers/*.sh

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# /data is intended to be a volume — DB, downloads, work area, NZB output all live here.
RUN mkdir -p /data /data/downloads /data/work /data/nzb

ENV DB_PATH=/data/svtplay-dl-webui.db \
    DOWNLOAD_OUTPUT_DIR=/data/downloads \
    USENET_WORK_DIR=/data/work \
    NZB_OUTPUT_DIR=/data/nzb \
    PORT=3001 \
    NODE_ENV=production \
    INSTALL_RAR=false \
    RAR_VERSION=720

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

LABEL org.opencontainers.image.title="SVT Play Downloader Web UI"
LABEL org.opencontainers.image.description="Web interface for svtplay-dl with optional Usenet upload pipeline"
LABEL org.opencontainers.image.vendor="svtplay-dl-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.created="${BUILDTIME}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${REVISION}"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["tsx", "src/backend/server.ts"]
