# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

git-backup is a Docker-based tool that periodically backs up local directories to Git repositories with AI-powered commit messages (via GitHub Copilot CLI). It supports multiple backup mappings (source directory to repo subdirectory), a web dashboard for management, and a compact widget for homepage embedding.

## Commands

```bash
npm ci --only=production      # Install dependencies
npm start                     # Start web UI + scheduler (node server.js)
node backup.js                # One-shot backup (legacy standalone mode)
node backup.js --schedule     # Legacy scheduler mode (env: RUN_SCHEDULER=true)
docker build -t git-backup .  # Build Docker image
```

There are no tests or linting configured in this project.

## Architecture

### Entry points

- **`server.js`** — Primary entry point. Express server (port 3000) serving the web dashboard, REST API, and cron scheduler. Orchestrates multi-mapping backups via `runFullBackup()`, which clones once then iterates enabled mappings. Has a `backupInProgress` concurrency guard (409 on conflict). Supports `BASE_PATH` env var for reverse proxy subdirectory mounting.

- **`backup.js`** — Core backup engine, also runnable standalone. Exports three functions consumed by server.js:
  - `getGlobalConfig()` — Builds config from env vars, embeds GITHUB_TOKEN in clone URL
  - `prepareRepo(globalConfig)` — Deletes `/repo`, fresh clone, checkout branch, set git user
  - `runBackupForMapping(repoGit, mapping, globalConfig)` — rsync source→target, apply ignore patterns, write managed `.gitignore`, detect changes, commit (Copilot or fallback), push, return `{ commitSha, commitMessage, filesChanged }` or null
  - Standalone mode preserved via `require.main === module` guard

- **`entrypoint.sh`** — Docker container init. Validates env vars, securely authenticates gh CLI (token written to temp file with 600 perms, env var unset), sets git config, execs `node server.js`.

### Supporting modules

- **`config.js`** — CRUD for `/data/config.json`. Stores `mappings[]` (id, name, sourceDir, repoSubdir, enabled, ignorePatterns) and `settings` (globalIgnorePatterns, configBackupPath). Atomic writes via temp file + rename. Backward compat: synthesizes single mapping from `BACKUP_DIR`/`REPO_SUBDIR` env vars if no config file exists.

- **`history.js`** — Append-only log at `/data/history.json`. Entries: timestamp, mappingId, mappingName, commitSha, commitMessage, filesChanged, commitUrl. Capped at 500 entries, newest first.

- **`github.js`** — Parses GitHub repo URLs (HTTPS and SSH) and builds commit URLs. Returns null for non-GitHub repos.

### Web UI (`public/`)

- **`index.html`** — Dashboard. Status bar, mappings CRUD table, history table with pagination, Settings modal (config backup path, global ignore patterns), Add/Edit Mapping modal (with per-mapping ignore patterns). Vanilla JS, dark theme, auto-refreshes every 60s. Detects `BASE_PATH` from page URL.

- **`widget.html`** — Compact widget for Homepage (gethomepage.dev) iframe embedding. Shows mapping count, last backup time, status indicator, latest commit message.

### Import graph

```
server.js → backup.js, config.js, history.js, github.js
backup.js → simple-git, child_process, fs, path
config.js → fs, path, crypto
entrypoint.sh → server.js (exec)
```

## Key Design Decisions

- **Fresh clone every run**: `/repo` is deleted and re-cloned each backup cycle. Intentional one-way sync (local → remote only) to avoid merge conflicts and stale state.
- **Separate commit per mapping**: Each mapping gets its own commit and push so commits are individually linkable in history.
- **Security**: `spawnSync` with array arguments (never shell strings). Paths validated against `"';|` characters. GitHub token embedded in clone URL and removed from env after gh auth.
- **Copilot fallback**: If `copilot` CLI fails for any reason, falls back to `Backup <name>: <ISO timestamp>`.
- **Ignore patterns**: Global patterns (settings) + per-mapping patterns merged at rsync time as `--exclude` args. Combined patterns also written as managed `.gitignore` in each repo target directory. Source directory `.gitignore` files still honored via `--exclude-from`.
- **Config backup + restore**: Optional `configBackupPath` setting copies config.json into the repo after all mapping backups, committed as "Update git-backup config". On first backup of a fresh container (no `/data/config.json`), if `CONFIG_BACKUP_PATH` env var is set or `configBackupPath` is in settings, the config is restored from the cloned repo.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GIT_REPO_URL` | Yes | — | Target repository URL |
| `GITHUB_TOKEN` | Yes | — | PAT with repo + Copilot access |
| `GIT_BRANCH` | No | `main` | Branch name |
| `BACKUP_INTERVAL_HOURS` | No | `6` | Hours between backups |
| `BACKUP_DIR` | No | `/backup` | Source directory (legacy single-mapping) |
| `REPO_SUBDIR` | No | `''` | Repo subdirectory (legacy single-mapping) |
| `GIT_USER_NAME` | No | `Git Backup Bot` | Commit author name |
| `GIT_USER_EMAIL` | No | `gitbackup@example.com` | Commit author email |
| `WEB_UI_PORT` | No | `3000` | Express server port |
| `BASE_PATH` | No | `''` | URL prefix for reverse proxy (e.g. `/git-backup`) |
| `CONFIG_FILE` | No | `/data/config.json` | Config persistence path |
| `HISTORY_FILE` | No | `/data/history.json` | History persistence path |
| `CONFIG_BACKUP_PATH` | No | `''` | Path in repo to restore config from on fresh container |

## API Endpoints

All under `{BASE_PATH}/api`:

- `GET /status` — Repo URL (sanitized), branch, interval, backup state
- `GET /mappings` — All mappings with latest backup info
- `POST /mappings` — Create mapping `{ name, sourceDir, repoSubdir }`
- `PUT /mappings/:id` — Update mapping fields
- `DELETE /mappings/:id` — Remove mapping
- `GET /settings` — Global settings
- `PUT /settings` — Update settings
- `GET /history` — History entries (query: `mappingId`, `limit`)
- `POST /backup` — Trigger backup (query: `mappingId` for single)
- `GET /backup/running` — Check if backup in progress

## CI/CD

GitHub Actions workflow (`.github/workflows/docker-publish.yml`) builds multi-platform images (amd64/arm64) and publishes to GitHub Container Registry on pushes to `main` and tagged releases.
