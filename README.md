# git-backup

Docker container to run periodic backups of a mapped folder to a Git repository using GitHub Copilot for intelligent commit messages.

## Features

- 🔄 Automated periodic backups on a configurable schedule
- 🤖 AI-powered commit messages using GitHub Copilot CLI
- 🐳 Lightweight Alpine-based Docker image
- 📦 Published to GitHub Container Registry
- ⚡ One-way sync: only local changes are pushed to the remote repository
- 🔧 Configurable backup intervals and Git settings

## Quick Start

### Using Docker Run

```bash
docker run -d \
  -e GIT_REPO_URL=https://github.com/yourusername/your-backup-repo.git \
  -e GITHUB_TOKEN=your_github_token_here \
  -v /path/to/your/data:/backup \
  ghcr.io/mccahan/git-backup:latest
```

### Using Docker Compose

1. Copy the `docker-compose.yml` file to your project directory
2. Edit the environment variables and volume paths
3. Run:

```bash
docker-compose up -d
```

## Configuration

### Required Environment Variables

- `GIT_REPO_URL`: The Git repository URL to push backups to (e.g., `https://github.com/user/repo.git`)
- `GITHUB_TOKEN`: GitHub Personal Access Token with:
  - `repo` scope for private repositories
  - Copilot access for AI-generated commit messages

### Optional Environment Variables

- `GIT_BRANCH`: Git branch to use (default: `main`)
- `BACKUP_INTERVAL_HOURS`: Hours between backups (default: `6`)
- `GIT_USER_NAME`: Git commit author name (default: `Git Backup Bot`)
- `GIT_USER_EMAIL`: Git commit author email (default: `gitbackup@example.com`)
- `BACKUP_DIR`: Internal backup directory path (default: `/backup`)
- `REPO_SUBDIR`: Subdirectory within the Git repository to sync files to (default: `` - root of repository). Useful for organizing backups within a subdirectory of the repository.

### Volume Mounts

- `/backup`: Mount your local directory that you want to backup here

## How It Works

1. **Initial Setup**: On container start, the repository is cloned (or fetched if it exists)
2. **Sync Files**: Files from the mounted `/backup` volume are copied to the local repository
3. **Detect Changes**: Git checks for any modifications, additions, or deletions
4. **Generate Commit Message**: If changes are detected, GitHub Copilot generates an intelligent commit message based on the diff
5. **Commit & Push**: Changes are committed and pushed to the remote repository
6. **Schedule**: The process repeats every X hours based on `BACKUP_INTERVAL_HOURS`

## Creating a GitHub Token

1. Go to [GitHub Settings > Developer Settings > Personal Access Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Git Backup Container")
4. Select scopes:
   - `repo` (Full control of private repositories)
5. Click "Generate token"
6. Copy the token immediately (you won't be able to see it again)

**Note**: Ensure your GitHub account has GitHub Copilot enabled for AI-generated commit messages.

## Examples

### Backup a configuration directory every 12 hours

```bash
docker run -d \
  -e GIT_REPO_URL=https://github.com/myuser/config-backup.git \
  -e GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  -e BACKUP_INTERVAL_HOURS=12 \
  -e GIT_USER_NAME="Config Backup Bot" \
  -v /etc/myapp/config:/backup \
  ghcr.io/mccahan/git-backup:latest
```

### Backup documents daily

```bash
docker run -d \
  -e GIT_REPO_URL=https://github.com/myuser/documents-backup.git \
  -e GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  -e BACKUP_INTERVAL_HOURS=24 \
  -v /home/user/Documents:/backup \
  ghcr.io/mccahan/git-backup:latest
```

### Backup to a subdirectory within the repository

This example backs up local files to the `servers/web01` subdirectory in the repository:

```bash
docker run -d \
  -e GIT_REPO_URL=https://github.com/myuser/infrastructure-backups.git \
  -e GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  -e REPO_SUBDIR=servers/web01 \
  -e GIT_USER_NAME="Web Server Backup" \
  -v /etc/nginx:/backup \
  ghcr.io/mccahan/git-backup:latest
```

## Building Locally

```bash
# Clone the repository
git clone https://github.com/mccahan/git-backup.git
cd git-backup

# Build the image
docker build -t git-backup .

# Run locally
docker run -d \
  -e GIT_REPO_URL=your_repo_url \
  -e GITHUB_TOKEN=your_token \
  -v /path/to/data:/backup \
  git-backup
```

## Logs

View container logs to monitor backup activity:

```bash
docker logs -f <container_name>
```

## Important Notes

- ⚠️ **One-way sync only**: Changes from the remote repository are NOT pulled to the local directory. Only local changes are pushed.
- 🔒 **Security**: Keep your `GITHUB_TOKEN` secure. Use Docker secrets or environment files, not hardcoded values.
- 📝 **Commit Messages**: If GitHub Copilot is unavailable, a timestamped fallback message is used.
- 🚀 **First Run**: The initial backup runs immediately when the container starts, then follows the schedule.

## License

MIT

