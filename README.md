# 🧠 Synapse

A self-hosted, connected knowledge base with mind-map graph view, wiki-style note linking, and workspaces. Built with Node.js + SQLite + React.

---

## Features

- **Workspaces** — Separate Home, Work, etc. in one instance
- **Markdown Editor** — Live preview, split view, or editor-only
- **Wiki Links** — Type `[[Note Title]]` to link notes with autocomplete
- **Graph View** — Interactive D3 mind map of all note connections
- **Full-text Search** — Fast SQLite FTS5 search across all notes (Ctrl+K)
- **Tags** — Tag notes and filter
- **File Attachments** — Upload images and files to notes (50MB limit)
- **Themes** — Dark, Light, Dracula, Nord, Solarized, Tokyo Night
- **Multi-user** — JWT auth, first user becomes admin
- **Hierarchical notes** — Nest notes inside each other like TriliumNext
- **Proxy-ready** — Works behind Nginx Proxy Manager, Traefik, Cloudflare Tunnel

---

## Deploy

### 1. Clone / copy files

```bash
mkdir /opt/stacks/synapse && cd /opt/stacks/synapse
# Copy your Dockerfile, docker-compose.yml, backend/, frontend/ here
```

### 2. Configure environment

```bash
cp .env.example .env
vim .env
# Set JWT_SECRET to something random: openssl rand -base64 48
# Set CORS_ORIGIN to your domain: https://synapse.s6node.com
```

### 3. Build and start

```bash
docker compose up -d --build
```

First build takes 3-5 minutes (compiling native SQLite module). Subsequent starts are instant.

### 4. Nginx Proxy Manager

- **Forward Hostname/IP:** `synapse` (or container IP)
- **Forward Port:** `3001`
- **Websockets:** Enable (for future use)
- **SSL:** Let's Encrypt as usual
- Force SSL: Enable

---

## Nginx Proxy Manager Config (NPM)

```
Scheme: http
Forward Hostname: synapse
Forward Port: 3001
```

No special headers needed. The app sets `trust proxy` automatically.

---

## Stack location

```
/opt/stacks/synapse/
├── Dockerfile
├── docker-compose.yml
├── .env
├── backend/
│   ├── package.json
│   └── src/
├── frontend/
│   ├── package.json
│   └── src/
└── data/              ← Created at runtime
    ├── synapse.db     ← SQLite database
    └── uploads/       ← File attachments
```

---

## First Run

1. Navigate to your domain
2. Click **Register** — fill in username, email, password
3. **First registered user is automatically admin**
4. Create your first workspace and start taking notes

---

## Updating

```bash
docker compose down
docker compose up -d --build
```

Your `./data` directory is never touched — all notes and uploads persist.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open search |
| `Esc` | Close modal |
| `[[` | Start wiki link (with autocomplete) |
| `Enter` in tag box | Add tag |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | (weak default) | **Change this!** Used to sign auth tokens |
| `CORS_ORIGIN` | `*` | Set to your domain for security |
| `PORT` | `3001` | Internal port |
| `DATA_DIR` | `/data` | Where DB and uploads live |

---

## Backup

```bash
# Full backup
tar -czf synapse-backup-$(date +%Y%m%d).tar.gz /opt/stacks/synapse/data/

# SQLite only
cp /opt/stacks/synapse/data/synapse.db synapse-backup.db
```

---

## Architecture

- **Backend:** Node.js + Express + better-sqlite3 (WAL mode)
- **Frontend:** React 18 + Vite + TailwindCSS + CodeMirror 6 + D3.js
- **Auth:** JWT (7-day expiry)
- **Search:** SQLite FTS5 with porter stemmer
- **Graph:** D3 force simulation
- **Container:** Single service, Alpine Linux base
