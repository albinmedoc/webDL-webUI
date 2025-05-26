#!/bin/bash

# GitHub Actions Docker Release Setup Script
# This script helps set up the repository for automated Docker releases

set -e

echo "🚀 Setting up GitHub Actions Docker Release Automation"
echo "=================================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists git; then
    echo "❌ Git is required but not installed"
    exit 1
fi

if ! command_exists gh; then
    echo "⚠️  GitHub CLI (gh) is not installed. Some features may not work."
    echo "   Install it from: https://cli.github.com/"
else
    echo "✅ GitHub CLI found"
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Not in a git repository"
    exit 1
fi

echo "✅ Git repository detected"

# Get repository information
REPO_URL=$(git config --get remote.origin.url)
if [[ $REPO_URL == *"github.com"* ]]; then
    # Extract owner/repo from URL
    if [[ $REPO_URL == *".git" ]]; then
        REPO_PATH=${REPO_URL%.git}
    else
        REPO_PATH=$REPO_URL
    fi
    REPO_PATH=${REPO_PATH##*/}
    REPO_OWNER=$(echo $REPO_PATH | cut -d'/' -f1)
    REPO_NAME=$(echo $REPO_PATH | cut -d'/' -f2)
    
    if [[ $REPO_URL == *"github.com:"* ]]; then
        # SSH format
        REPO_FULL=${REPO_URL#*:}
        REPO_FULL=${REPO_FULL%.git}
    else
        # HTTPS format  
        REPO_FULL=${REPO_URL#*github.com/}
        REPO_FULL=${REPO_FULL%.git}
    fi
    
    echo "✅ GitHub repository detected: $REPO_FULL"
else
    echo "❌ Not a GitHub repository"
    exit 1
fi

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Current branch: $CURRENT_BRANCH"

# Check if package.json exists and get current version
if [ -f "package.json" ]; then
    CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
    echo "📦 Current version: $CURRENT_VERSION"
else
    echo "⚠️  package.json not found"
    CURRENT_VERSION="0.0.0"
fi

echo ""
echo "🔧 Setup Actions:"
echo "=================="

# 1. Commit and push workflow files
echo "1️⃣  Committing GitHub Actions workflows..."

if git diff --quiet && git diff --staged --quiet; then
    echo "   No changes to commit"
else
    git add .github/
    git add Dockerfile
    git add .dockerignore
    git add README.md
    git add src/backend/middleware/setup.ts
    
    if git diff --staged --quiet; then
        echo "   No workflow changes to commit"
    else
        git commit -m "ci: add automated Docker release workflows

- Add GitHub Actions for Docker builds and releases
- Support multi-architecture builds (amd64, arm64)
- Automated versioning and tagging
- Security scanning with Trivy
- Development builds for feature branches
- GitHub Container Registry integration"
        
        echo "   ✅ Committed workflow files"
        
        read -p "   Push changes to remote? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git push origin $CURRENT_BRANCH
            echo "   ✅ Pushed changes to $CURRENT_BRANCH"
        fi
    fi
fi

# 2. Create initial version tag if needed
echo ""
echo "2️⃣  Version tagging..."

if git tag -l | grep -q "^v"; then
    LATEST_TAG=$(git tag -l "v*" | sort -V | tail -n1)
    echo "   Latest tag found: $LATEST_TAG"
else
    echo "   No version tags found"
    read -p "   Create initial tag v$CURRENT_VERSION? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -a "v$CURRENT_VERSION" -m "Initial release v$CURRENT_VERSION"
        echo "   ✅ Created tag v$CURRENT_VERSION"
        
        read -p "   Push tag to trigger first release build? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git push origin "v$CURRENT_VERSION"
            echo "   ✅ Pushed tag v$CURRENT_VERSION"
            echo "   🚀 This will trigger the Docker release workflow!"
        fi
    fi
fi

# 3. Repository settings check
echo ""
echo "3️⃣  Repository settings..."

if command_exists gh; then
    echo "   Checking repository permissions..."
    
    # Check if user has admin access
    REPO_PERMS=$(gh api repos/$REPO_FULL --jq '.permissions.admin // false' 2>/dev/null || echo "false")
    
    if [ "$REPO_PERMS" = "true" ]; then
        echo "   ✅ You have admin access to configure repository settings"
        
        # Check workflow permissions
        WORKFLOW_PERMS=$(gh api repos/$REPO_FULL/actions/permissions --jq '.default_workflow_permissions // "read"' 2>/dev/null || echo "unknown")
        echo "   Current workflow permissions: $WORKFLOW_PERMS"
        
        if [ "$WORKFLOW_PERMS" != "write" ]; then
            read -p "   Enable write permissions for workflows? (y/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                gh api repos/$REPO_FULL/actions/permissions -X PUT -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true
                echo "   ✅ Updated workflow permissions"
            fi
        fi
    else
        echo "   ⚠️  Limited repository access. You may need to ask an admin to:"
        echo "      - Go to Settings → Actions → General"
        echo "      - Set Workflow permissions to 'Read and write permissions'"
    fi
else
    echo "   ⚠️  Cannot check repository settings without GitHub CLI"
    echo "      Please ensure workflow permissions are set to 'Read and write permissions'"
    echo "      Go to: https://github.com/$REPO_FULL/settings/actions"
fi

# 4. Next steps
echo ""
echo "✨ Setup Complete!"
echo "=================="
echo ""
echo "🎯 What happens next:"
echo ""
echo "📋 Automatic Releases:"
echo "   • Pushes to 'main' → Auto-version and create tag → Docker release"
echo "   • Manual tags (v1.2.3) → Docker release with multiple tags"
echo "   • Pushes to 'develop' → Development Docker builds"
echo ""
echo "🐳 Docker Images will be available at:"
echo "   ghcr.io/$REPO_FULL:latest"
echo "   ghcr.io/$REPO_FULL:v1.2.3"
echo "   ghcr.io/$REPO_FULL:dev"
echo ""
echo "📊 Monitor builds at:"
echo "   https://github.com/$REPO_FULL/actions"
echo ""
echo "📦 View published images at:"
echo "   https://github.com/$REPO_FULL/pkgs/container/${REPO_NAME##*/}"
echo ""
echo "🔧 Development workflow:"
echo "   1. Work on feature branches"
echo "   2. Create PR → Docker image built automatically"
echo "   3. Merge to main → Auto-version and release"
echo ""
echo "📚 For detailed documentation, see:"
echo "   .github/DOCKER.md"
echo ""
echo "🎉 Happy releasing!"
