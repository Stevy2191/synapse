# Node 24 = the supported long-term (LTS) release; Node 20 stopped getting security fixes in April 2026.

# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

# Stage 2: Backend packages. better-sqlite3 is compiled here, so the compilers (python3, make, g++)
# stay in this build stage and never ship in the image that runs.
FROM node:24-alpine AS backend-deps

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
# Build better-sqlite3 from source against this Node version
RUN npm_config_build_from_source=true npm ci --omit=dev --silent && npm cache clean --force

# Stage 3: What runs
FROM node:24-alpine AS production

# Latest security fixes for the base system packages.
RUN apk upgrade --no-cache

# Chromium prints notes to PDF (Export → PDF). Noto fonts cover most languages and emoji.
# ffmpeg reads meeting recordings (any format → 16 kHz audio for transcription); tar + bzip2 unpack
# the speech models the admin downloads.
RUN apk add --no-cache chromium font-noto font-noto-emoji ffmpeg tar bzip2
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Data directory for SQLite + uploads
RUN mkdir -p /data/uploads

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

CMD ["node", "src/index.js"]
