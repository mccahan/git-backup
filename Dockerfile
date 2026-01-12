FROM node:25-slim

# Install required packages
RUN apk add --no-cache \
    git \
    bash \
    curl \
    rsync \
    ca-certificates \
    github-cli

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

# Install GitHub Copilot CLI extension
# Note: This requires network access and may fail in restricted environments
RUN npm install -g @github/copilot

# Set working directory
WORKDIR /backup

# Run entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
