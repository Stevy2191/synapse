<div align="center">

<img src="assets/logo.svg" width="80" height="80" alt="Synapse Logo"/>

# Synapse

**Your connected knowledge base**

*Self-hosted · Docker · Proxy-ready*

</div>

---

## Features

- **Workspaces** — Separate Home, Work, etc. in one instance
- **Three note types** — Rich text notes, Flowchart diagrams, Freehand whiteboard
- **Markdown Editor** — Live preview, split view, or editor-only
- **Rich Text Editor** — Full Trilium-style toolbar with all formatting options
- **Wiki Links** — Type `[[Note Title]]` to link notes with autocomplete
- **Graph View** — Interactive D3 mind map of all note connections
- **Full-text Search** — Fast SQLite FTS5 search (Ctrl+K)
- **Tags** — Tag and filter notes
- **File Attachments** — Upload images and files (50MB limit)
- **Themes** — Dark, Light, Dracula, Nord, Solarized, Tokyo Night
- **Multi-user** — JWT auth, first user becomes admin
- **Hierarchical notes** — Nest notes inside each other
- **Proxy-ready** — Works behind Nginx Proxy Manager, Cloudflare Tunnel

---

## Install

```bash
mkdir /opt/stacks/synapse && cd /opt/stacks/synapse

curl -O https://raw.githubusercontent.com/Stevy2191/synapse/main/docker-compose.yml

cat > .env << EOF
JWT_SECRET=$(openssl rand -base64 48)
CORS_ORIGIN=https://synapse.yourdomain.com
EOF

docker compose pull
docker compose up -d
```

---

## Update

```bash
cd /opt/stacks/synapse
docker compose pull
docker compose up -d
```

GitHub Actions automatically builds and pushes a new image on every push to main. No building required on the server.

---

## First Run

1. Navigate to your domain
2. Click **Register** — fill in username, email, password
3. First registered user is automatically **admin**
4. Create your first workspace and start taking notes

---

## Nginx Proxy Manager

| Setting | Value |
|---------|-------|
| Scheme | http |
| Forward Hostname | synapse |
| Forward Port | 3001 |
| Websockets | Enabled |
| SSL | Let's Encrypt |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | (weak default) | **Change this!** `openssl rand -base64 48` |
| `CORS_ORIGIN` | `*` | Set to your domain |
| `PORT` | `3001` | Internal port |
| `DATA_DIR` | `/data` | Database and uploads location |

---

## Backup

```bash
tar -czf synapse-backup-$(date +%Y%m%d).tar.gz /opt/stacks/synapse/data/
```

---

## Stack Layout

```
/opt/stacks/synapse/
├── docker-compose.yml
├── .env
└── data/
    ├── synapse.db
    └── uploads/
```

---

## Architecture

- **Backend:** Node.js + Express + better-sqlite3 (WAL mode)
- **Frontend:** React 18 + Vite + TailwindCSS + TipTap + D3.js
- **Auth:** JWT (7-day expiry)
- **Search:** SQLite FTS5 with porter stemmer
- **Graph:** D3 force simulation
- **Image:** Alpine Linux, hosted on GHCR
