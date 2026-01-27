FROM node:25-slim

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    rsync \
    ca-certificates \
    gh && \
    rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /backup /repo /data

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy scripts
COPY backup.js config.js history.js github.js server.js /usr/local/bin/
COPY public/ /usr/local/bin/public/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN curl -fsSL https://gh.io/copilot-install | bash

# Set working directory
WORKDIR /backup

EXPOSE 3000

# Run entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
