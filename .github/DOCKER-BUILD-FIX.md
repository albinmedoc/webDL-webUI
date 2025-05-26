# Docker Build Fix Summary

## Issue
The Docker build was failing with:
```
sh: 1: vue-tsc: not found
```

## Root Cause
The Dockerfile was installing only production dependencies (`npm ci --only=production`) before trying to build the application, but `vue-tsc` is a development dependency required for the build process.

## Solution Applied

### 1. Multi-Stage Docker Build
- **Build Stage**: Install all dependencies (including dev dependencies), build the frontend
- **Production Stage**: Install only production dependencies + tsx, copy built assets

### 2. Key Changes to Dockerfile:
```dockerfile
# Build stage - has ALL dependencies
FROM ubuntu:22.04 AS builder
# ... install all deps with npm ci
# ... build frontend with npm run build

# Production stage - minimal runtime dependencies
FROM ubuntu:22.04
# ... install production deps + tsx
# ... copy built frontend from builder stage
# ... run backend with npx tsx
```

### 3. Updated GitHub Workflow
- Added Docker Hub publishing alongside GitHub Container Registry
- Updated environment variables and image names
- Fixed registry references throughout the workflow

## Benefits
1. **Smaller final image**: Dev dependencies not included in production stage
2. **Faster builds**: Multi-stage caching
3. **Dual publishing**: Both GitHub Container Registry and Docker Hub
4. **TypeScript runtime**: Using tsx to run TypeScript directly

## Docker Images Available At:
- **Docker Hub**: `albinmedoc/webdl-webui:latest`
- **GitHub**: `ghcr.io/[username]/svtplay-dl-webui:latest`

The build should now succeed! 🚀
