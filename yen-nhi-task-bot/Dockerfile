# syntax=docker/dockerfile:1

# Build stage
FROM node:18-bullseye AS builder

WORKDIR /app

# Install build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-bullseye AS production

WORKDIR /app

# Install runtime dependencies and build tools for native modules
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

# Install only production dependencies
RUN npm ci --only=production

# Explicitly rebuild better-sqlite3 for this container
RUN npm rebuild better-sqlite3

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy other necessary files
COPY --from=builder /app/src ./src

ENV NODE_ENV=production

CMD ["node", "./dist/index.js"]
