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
- **Multi-user** — First user becomes admin and invites everyone else
- **Hierarchical notes** — Nest notes inside each other
- **Offline-first** — Keep writing with no connection; changes upload automatically when you're back online
- **Installable** — Add to your phone's home screen or desktop as an app
- **Proxy-ready** — Works behind Nginx Proxy Manager, Cloudflare Tunnel

---

## Install

```bash
mkdir /opt/stacks/synapse && cd /opt/stacks/synapse

curl -O https://raw.githubusercontent.com/Stevy2191/synapse/main/docker-compose.yml

cat > .env << EOF
JWT_SECRET=$(openssl rand -base64 48)
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
2. Create the **admin account** (only the first user can sign up)
3. Add family members or teammates from **Settings → Admin** (you can reset their passwords there too)
4. Create your first workspace and start taking notes

Want open sign-ups instead? Set `ALLOW_REGISTRATION=true`.

---

## Offline Mode

Synapse keeps a copy of your notes on each device, so you can open, search, write and organise notes without a connection.

- **While offline**, the badge in the top bar shows **Offline · N waiting**. Everything you do is saved on the device right away.
- **When you reconnect**, waiting changes upload automatically (or click the badge to sync now), and changes made on your other devices download.
- **Conflicts never lose work.** If a note was edited on another device while you were offline, the other device's version stays, and yours is saved next to it as **"Title (conflict copy)"**. Merge them by hand and delete the copy.
- **Install it:** in Chrome or Edge use *Install app* in the address bar; on iPhone use *Share → Add to Home Screen*.

Notes:
- Your first sign-in on a device needs a connection.
- Offline mode needs **HTTPS** (or `localhost`) for the app to open with no connection. Your notes are still stored locally over plain HTTP, but the page itself won't load offline.
- Creating workspaces and uploading attachments still need a connection.
- Signing out removes the device's copy of your notes (you'll be warned if anything hasn't uploaded yet).

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
| `JWT_SECRET` | auto-generated | Signs login tokens. If unset, a random one is created and saved to `data/.jwt_secret` |
| `ALLOW_REGISTRATION` | `false` | `true` lets anyone create an account. Otherwise only the first user (admin) can register |
| `CORS_ORIGIN` | unset | Only needed if a different site calls the API from a browser (comma-separated list) |
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

## Local Development

```bash
cd backend && npm install && npm run dev      # API on :3001 (data in ./data)
cd frontend && npm install && npm run dev     # UI on :5173, proxies /api to :3001
```

---

## Architecture

- **Backend:** Node.js + Express + better-sqlite3 (WAL mode)
- **Frontend:** React 18 + Vite + TailwindCSS + TipTap + D3.js
- **Auth:** JWT (7-day expiry)
- **Search:** SQLite FTS5 with porter stemmer on the server; in-browser search of the local copy in the app
- **Offline:** Service worker (vite-plugin-pwa) caches the app; IndexedDB holds notes plus an outbox of pending changes (`frontend/src/offline/`). Notes carry a version number so the server can detect conflicting edits
- **Graph:** D3 force simulation
- **Image:** Alpine Linux, hosted on GHCR
