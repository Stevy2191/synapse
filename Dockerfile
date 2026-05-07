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
