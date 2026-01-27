#!/bin/bash

set -e

echo "=== Git Backup Container Starting ==="

# Validate required environment variables
if [ -z "$GIT_REPO_URL" ]; then
    echo "ERROR: GIT_REPO_URL environment variable is required"
    exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "WARNING: GITHUB_TOKEN not set, GitHub CLI features may not work"
fi

# Configure GitHub CLI
if [ -n "$GITHUB_TOKEN" ]; then
    # Use a temporary file with restricted permissions to avoid exposing token in process args
    TEMP_TOKEN_FILE=$(mktemp)
    chmod 600 "$TEMP_TOKEN_FILE"
    echo "$GITHUB_TOKEN" > "$TEMP_TOKEN_FILE"
    unset GITHUB_TOKEN
    gh auth login --with-token < "$TEMP_TOKEN_FILE"
    rm -f "$TEMP_TOKEN_FILE"
    export GITHUB_TOKEN=$(gh auth token)
fi

# Set default backup interval (in hours)
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-6}"

echo "Configuration:"
echo "  Repository: $GIT_REPO_URL"
echo "  Branch: ${GIT_BRANCH:-main}"
echo "  Backup Interval: $BACKUP_INTERVAL_HOURS hours"
echo "  Backup Directory: ${BACKUP_DIR:-/backup}"

git config --global user.name "${GIT_USER_NAME}"
git config --global user.email "${GIT_USER_EMAIL}"

# Run Node.js scheduler
echo "Starting Node.js scheduler..."
export RUN_SCHEDULER=true
exec node /usr/local/bin/server.js
