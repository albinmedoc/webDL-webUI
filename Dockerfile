# syntax=docker/dockerfile:1.6

# ───────────────────────────── Build stage ─────────────────────────────
FROM ubuntu:22.04 AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# pnpm
RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ──────────────────────────── Runtime stage ────────────────────────────
FROM ubuntu:22.04

ARG BUILDTIME
ARG VERSION
ARG REVISION

# Set INSTALL_RAR=true at build time to bake rar into the image.
# Default is false because rar (winrar.exe / rarlab) is non-free; users who
# accept the WinRAR license can enable it, or bind-mount a host binary at
# /usr/local/bin/rar:ro instead.
ARG INSTALL_RAR=false

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl ca-certificates \
    python3 python3-pip \
    ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 + pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@10

# svtplay-dl
RUN pip3 install --no-cache-dir svtplay-dl

# Usenet tooling: nyuu + @animetosho/parpar (verified package names).
RUN npm install -g nyuu @animetosho/parpar \
    && npm cache clean --force

# Optional: rar (license: see https://www.rarlab.com/license.htm).
# Disabled by default. Build with --build-arg INSTALL_RAR=true to enable.
RUN if [ "$INSTALL_RAR" = "true" ]; then \
        set -eux; \
        ARCH="$(dpkg --print-architecture)"; \
        case "$ARCH" in \
            amd64)  RAR_URL="https://www.rarlab.com/rar/rarlinux-x64-700.tar.gz" ;; \
            arm64)  RAR_URL="https://www.rarlab.com/rar/rarlinux-arm-700.tar.gz" ;; \
            *) echo "Unsupported arch for rar: $ARCH" >&2; exit 1 ;; \
        esac; \
        curl -fsSL "$RAR_URL" -o /tmp/rar.tgz; \
        tar -xzf /tmp/rar.tgz -C /tmp; \
        install -m 0755 /tmp/rar/rar /usr/local/bin/rar; \
        install -m 0755 /tmp/rar/unrar /usr/local/bin/unrar; \
        rm -rf /tmp/rar /tmp/rar.tgz; \
        rar -? | head -1; \
    else \
        echo "INSTALL_RAR=false: rar is not bundled. Bind-mount /usr/local/bin/rar:ro at runtime."; \
    fi

# Production deps + tsx for running TypeScript directly
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile \
    && pnpm add tsx

COPY --from=builder /app/dist ./dist
COPY src/backend ./src/backend

# Create downloads + persistent data dirs.
# /data is intended to be a volume — DB, work area, NZB output all live here.
RUN mkdir -p /app/downloads /data /data/work /data/nzb

# Default paths point at the /data volume; override via env if needed.
ENV DB_PATH=/data/svtplay-dl-webui.db \
    USENET_WORK_DIR=/data/work \
    NZB_OUTPUT_DIR=/data/nzb \
    PORT=3001 \
    NODE_ENV=production

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

CMD ["pnpm", "exec", "tsx", "src/backend/server.ts"]
