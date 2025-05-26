# syntax=docker/dockerfile:1

# Build stage
FROM node:18-bullseye AS builder

WORKDIR /app

# Install build tools and ffmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source code (excluding test files via .dockerignore)
COPY . .

# Build TypeScript
RUN npm run build

# Production stage  
FROM node:18-bullseye-slim AS production

WORKDIR /app

# Install only essential runtime dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get autoremove -y \
    && apt-get clean

# Ensure node user exists (may already exist in base image)
RUN if ! id -u node > /dev/null 2>&1; then \
        groupadd -r node && useradd -r -g node node; \
    fi

# Copy package files
COPY package*.json ./

# Install production dependencies with better-sqlite3 rebuild
RUN npm ci --only=production \
    && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy package.json for runtime info
COPY --from=builder /app/package.json ./package.json

# Create directories and set permissions
RUN mkdir -p /app/tmp /app/audio \
    && chown -R node:node /app

# Switch to non-root user
USER node

# Environment variables
ENV NODE_ENV=production
ENV AUDIO_TMP=/app/tmp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

EXPOSE 3000

CMD ["node", "./dist/index.js"]
