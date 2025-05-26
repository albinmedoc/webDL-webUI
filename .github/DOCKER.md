# Docker Release Automation

This repository uses GitHub Actions to automatically build and publish Docker images to the GitHub Container Registry (ghcr.io).

## Workflows

### 🚀 Docker Release (`docker-release.yml`)
**Triggers:**
- Git tags starting with `v*` (e.g., `v1.0.0`)
- Pushes to `main` branch
- Pushes to `develop` branch
- Manual workflow dispatch

**Features:**
- Multi-architecture builds (linux/amd64, linux/arm64)
- Multiple tag strategies for different use cases
- Security scanning with Trivy
- Automatic GitHub releases
- Build attestation for supply chain security
- Automatic cleanup of untagged images

**Generated Tags:**
```bash
# For version tags (v1.2.3)
ghcr.io/owner/repo:1.2.3      # Exact version
ghcr.io/owner/repo:1.2        # Major.Minor
ghcr.io/owner/repo:1          # Major
ghcr.io/owner/repo:latest     # Latest stable

# For main branch
ghcr.io/owner/repo:main-20240526    # Branch with date
ghcr.io/owner/repo:2024.05.26       # Date format

# For develop branch
ghcr.io/owner/repo:develop-dev      # Development tag
ghcr.io/owner/repo:dev              # Short dev tag

# For all builds
ghcr.io/owner/repo:sha-abc1234      # Git commit SHA
```

### 🔄 Auto Versioning (`auto-version.yml`)
**Triggers:**
- Pushes to `main` branch (excluding documentation)
- Manual workflow dispatch

**Features:**
- Automatic version bumping based on commit messages
- Semantic versioning (major, minor, patch)
- Automatic changelog generation
- Git tag creation

**Commit Message Conventions:**
```bash
# Patch version (1.0.0 → 1.0.1)
fix: resolve download progress issue
docs: update README

# Minor version (1.0.0 → 1.1.0)  
feat: add download queue management

# Major version (1.0.0 → 2.0.0)
feat!: redesign API structure
BREAKING CHANGE: API endpoints changed
```

### 🧪 Development Build (`dev-build.yml`)
**Triggers:**
- Pushes to development branches (`develop`, `feature/*`, `fix/*`, `hotfix/*`)
- Pull requests

**Features:**
- TypeScript compilation and type checking
- Docker image builds for testing
- Security vulnerability scanning
- PR comments with image information

## Usage

### For Releases

1. **Automatic Release (Recommended):**
   ```bash
   # Make your changes and commit
   git add .
   git commit -m "feat: add new download feature"
   git push origin main
   
   # Auto-versioning will create a tag automatically
   # Docker release will build and publish the image
   ```

2. **Manual Release:**
   ```bash
   # Create and push a version tag
   git tag v1.2.3
   git push origin v1.2.3
   
   # This triggers the docker-release workflow
   ```

3. **Manual Versioning:**
   - Go to Actions → Auto Versioning → Run workflow
   - Select version type (patch/minor/major)

### For Development

Development images are automatically built for:
- Feature branches: `ghcr.io/owner/repo:feature-branch-name`
- Pull requests: `ghcr.io/owner/repo:pr-123`

### Pulling Images

```bash
# Latest stable release
docker pull ghcr.io/owner/repo:latest

# Specific version
docker pull ghcr.io/owner/repo:1.2.3

# Development version
docker pull ghcr.io/owner/repo:dev

# Feature branch
docker pull ghcr.io/owner/repo:feature-awesome-feature
```

### Running the Application

```bash
# Basic run
docker run -d \
  --name svtplay-dl-webui \
  -p 3001:3001 \
  -v $(pwd)/downloads:/app/downloads \
  ghcr.io/owner/repo:latest

# With environment variables
docker run -d \
  --name svtplay-dl-webui \
  -p 3001:3001 \
  -v $(pwd)/downloads:/app/downloads \
  -e NODE_ENV=production \
  ghcr.io/owner/repo:latest
```

## Repository Settings

To enable these workflows, ensure your repository has:

1. **Package permissions**: Repository → Settings → Actions → General → Workflow permissions → "Read and write permissions"

2. **Container registry**: Packages are automatically published to `ghcr.io/owner/repo`

## Security Features

- **Trivy Scanning**: All images are scanned for vulnerabilities
- **SARIF Upload**: Scan results are uploaded to GitHub Security tab
- **Build Attestation**: Supply chain security with build provenance
- **Multi-architecture**: Support for both AMD64 and ARM64

## Workflow Status

[![Docker Release](https://github.com/owner/repo/actions/workflows/docker-release.yml/badge.svg)](https://github.com/owner/repo/actions/workflows/docker-release.yml)
[![Auto Versioning](https://github.com/owner/repo/actions/workflows/auto-version.yml/badge.svg)](https://github.com/owner/repo/actions/workflows/auto-version.yml)
[![Development Build](https://github.com/owner/repo/actions/workflows/dev-build.yml/badge.svg)](https://github.com/owner/repo/actions/workflows/dev-build.yml)

## Container Registry

View all published images: [GitHub Container Registry](https://github.com/owner/repo/pkgs/container/repo)
