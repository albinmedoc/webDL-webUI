# Build stage
FROM ubuntu:22.04 AS builder

# Set working directory
WORKDIR /app

# Install system dependencies for build
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Copy package files
COPY package*.json ./

# Install ALL Node.js dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the frontend application
RUN npm run build

# Production stage
FROM ubuntu:22.04

# Build arguments
ARG BUILDTIME
ARG VERSION
ARG REVISION

# Set working directory
WORKDIR /app

# Install system dependencies for runtime
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install svtplay-dl
RUN pip3 install svtplay-dl

# Copy package files
COPY package*.json ./

# Install production dependencies + tsx for running TypeScript
RUN npm ci --only=production \
    && npm install tsx \
    && npm cache clean --force

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend source files (we'll run TypeScript directly with tsx)
COPY src/backend ./src/backend

# Create downloads directory
RUN mkdir -p /app/downloads

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Add labels for metadata
LABEL org.opencontainers.image.title="SVT Play Downloader Web UI"
LABEL org.opencontainers.image.description="Web interface for svtplay-dl with real-time progress tracking"
LABEL org.opencontainers.image.vendor="svtplay-dl-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.created="${BUILDTIME}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${REVISION}"

# Start the server using tsx to run TypeScript directly
CMD ["npx", "tsx", "src/backend/server.ts"]
