FROM mcr.microsoft.com/devcontainers/javascript-node:20

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
        build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages svtplay-dl

# RAR is only published as x86_64 by RARLAB. On arm64 hosts (Apple silicon
# native) the install is skipped — uploads will fail with a clear error
# until the user provides rar manually (bind-mount, or build the prod image
# with --platform=linux/amd64). pnpm dev/test still works without rar.
RUN if [ "$INSTALL_RAR" = "true" ]; then \
        set -eux; \
        arch="$(uname -m)"; \
        if [ "$arch" = "x86_64" ]; then \
            curl -fsSL "https://www.rarlab.com/rar/rarlinux-x64-${RAR_VERSION}.tar.gz" -o /tmp/rar.tar.gz; \
            tar -xzf /tmp/rar.tar.gz -C /tmp; \
            install -m 755 /tmp/rar/rar /usr/local/bin/rar; \
            install -m 755 /tmp/rar/unrar /usr/local/bin/unrar; \
            rm -rf /tmp/rar /tmp/rar.tar.gz; \
        else \
            echo "Skipping RAR install on $arch — RARLAB ships x86_64 only"; \
        fi; \
    fi

RUN npm install -g pnpm@9 nyuu @animetosho/parpar

USER node
