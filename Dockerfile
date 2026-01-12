FROM node:20-alpine

# Install required packages
RUN apk add --no-cache \
    git \
    bash \
    curl \
    rsync \
    ca-certificates \
    github-cli

# Install GitHub Copilot CLI extension
# Note: This requires network access and may fail in restricted environments
RUN gh extension install github/gh-copilot || echo "Warning: gh-copilot extension installation failed. Copilot features may not be available."

# Create directories
RUN mkdir -p /backup /repo

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy scripts
COPY backup.js /usr/local/bin/backup.js
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set working directory
WORKDIR /backup

# Run entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
