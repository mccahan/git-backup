FROM node:20-alpine

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
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then \
        curl -L -o copilot.tar.gz https://github.com/github/copilot-cli/releases/download/v0.0.377/copilot-linux-arm64.tar.gz; \
    else \
        curl -L -o copilot.tar.gz https://github.com/github/copilot-cli/releases/download/v0.0.377/copilot-linux-x64.tar.gz; \
    fi && \
    tar -xzf copilot.tar.gz -C /usr/local/bin && \
    rm copilot.tar.gz

# Set working directory
WORKDIR /backup

# Run entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
