FROM --platform=linux/amd64 mcr.microsoft.com/devcontainers/javascript-node:20

ARG INSTALL_RAR=true
ARG RAR_VERSION=720

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        ca-certificates \
        curl \
        sqlite3 \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages svtplay-dl

RUN if [ "$INSTALL_RAR" = "true" ]; then \
        set -eux; \
        curl -fsSL "https://www.rarlab.com/rar/rarlinux-x64-${RAR_VERSION}.tar.gz" -o /tmp/rar.tar.gz; \
        tar -xzf /tmp/rar.tar.gz -C /tmp; \
        install -m 755 /tmp/rar/rar /usr/local/bin/rar; \
        install -m 755 /tmp/rar/unrar /usr/local/bin/unrar; \
        rm -rf /tmp/rar /tmp/rar.tar.gz; \
    fi

RUN npm install -g pnpm@9 nyuu @animetosho/parpar

USER node
