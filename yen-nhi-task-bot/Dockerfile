# syntax=docker/dockerfile:1
FROM node:18-bullseye

WORKDIR /app

# Cài build tools trước (cực quan trọng cho native module)
RUN apt-get update && apt-get install -y build-essential python3

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN npm run build

# Cài ffmpeg sau cùng
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

CMD ["node", "./dist/index.js"]
