# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

# Stage 2: Backend with frontend dist
FROM node:20-alpine AS production

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev

# Chromium prints notes to PDF (Export → PDF). Noto fonts cover most languages and emoji.
# ffmpeg reads meeting recordings (any format → 16 kHz audio for transcription); tar + bzip2 unpack
# the speech models the admin downloads.
RUN apk add --no-cache chromium font-noto font-noto-emoji ffmpeg tar bzip2
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY backend/package*.json ./
# Build better-sqlite3 from source against this Node version
RUN npm_config_build_from_source=true npm ci --silent

COPY backend/ .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Data directory for SQLite + uploads
RUN mkdir -p /data/uploads

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

CMD ["node", "src/index.js"]
