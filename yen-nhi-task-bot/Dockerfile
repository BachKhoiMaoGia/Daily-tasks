# syntax=docker/dockerfile:1
FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

RUN npm rebuild better-sqlite3

COPY . .

RUN npm run build

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

CMD ["node", "./dist/index.js"]
