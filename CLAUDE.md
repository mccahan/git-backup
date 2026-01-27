# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

git-backup is a Docker-based tool that periodically backs up local directories to Git repositories with AI-powered commit messages (via GitHub Copilot CLI). It runs as a container with a mounted volume and pushes changes on a configurable schedule.

## Commands

```bash
# Install dependencies
npm ci --only=production

# Run backup once
npm start                    # or: node backup.js

# Run in scheduler mode (periodic backups)
node backup.js --schedule    # or set RUN_SCHEDULER=true

# Build Docker image locally
docker build -t git-backup .

# Run container
docker run -d \
  -e GIT_REPO_URL=<url> \
  -e GITHUB_TOKEN=<token> \
  -v /path/to/data:/backup \
  git-backup
```

There are no tests or linting configured in this project.

## Architecture

The system has three main components:

1. **`entrypoint.sh`** — Container init script. Validates env vars, authenticates GitHub CLI (writes token to temp file with 600 perms, then unsets the env var), sets git config, and launches the Node.js scheduler.

2. **`backup.js`** — Core application. On each backup cycle:
   - Deletes `/repo` and does a fresh clone (one-way sync, never pulls)
   - Uses `rsync` to copy `/backup` → cloned repo (or `REPO_SUBDIR` within it)
   - Detects changes via `git status`
   - Attempts commit message generation via `gh copilot suggest` with fallback to timestamp-based messages
   - Pushes to remote with `--set-upstream`
   - In scheduler mode, uses `node-cron` with expression `0 */N * * *`

3. **`Dockerfile`** — Based on `node:25-slim`. Installs git, rsync, gh CLI, and GitHub Copilot CLI extension. Creates `/backup` (mount point) and `/repo` (working clone) directories.

## Key Design Decisions

- **Fresh clone every run**: The repo is deleted and re-cloned each backup cycle to avoid merge conflicts and stale state. This is intentional one-way sync (local → remote only).
- **Security**: Uses `spawnSync` with array arguments (not shell strings) to prevent command injection. Path inputs are validated against special characters (quotes, semicolons, pipes). The GitHub token is embedded in the clone URL and removed from env after gh auth.
- **Copilot fallback**: If `gh copilot suggest` fails for any reason, falls back to a timestamp-based commit message.

## Environment Variables

- `GIT_REPO_URL` (required) — Target repository URL
- `GITHUB_TOKEN` (required) — PAT with repo + Copilot access
- `GIT_BRANCH` — Branch name (default: `main`)
- `BACKUP_INTERVAL_HOURS` — Hours between backups (default: `6`)
- `REPO_SUBDIR` — Subdirectory within repo for backups (default: root)
- `GIT_USER_NAME` / `GIT_USER_EMAIL` — Commit author identity

## CI/CD

GitHub Actions workflow (`.github/workflows/docker-publish.yml`) builds and publishes multi-platform images (amd64/arm64) to GitHub Container Registry on pushes to `main` and tagged releases.
