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

# Create log file
touch /var/log/backup.log

# Run immediate backup
echo "Running initial backup..."
node /usr/local/bin/backup.js 2>&1 | tee -a /var/log/backup.log

# Setup cron job for periodic backups
CRON_SCHEDULE="0 */$BACKUP_INTERVAL_HOURS * * *"
echo "$CRON_SCHEDULE node /usr/local/bin/backup.js >> /var/log/backup.log 2>&1" > /etc/crontabs/root

echo "Cron job scheduled: $CRON_SCHEDULE"
echo "Starting crond daemon..."

# Start crond in foreground and tail logs
crond -f -l 2 &
tail -f /var/log/backup.log
