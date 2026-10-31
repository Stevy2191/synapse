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
- **Write as you read** — The default editor shows finished formatting while understanding Markdown as you type (`# `, `**bold**`, `- `, `[] `, `> `, ```` ``` ````). Type `/` for a menu of blocks (headings, checklists, tables, code, images…), select text for a formatting toolbar
- **Markdown view** — Switch any note to raw Markdown (with split view and preview); notes are always kept as Markdown too, for search and export
- **Wiki Links** — Type `[[` to search your notes and link one (or create it); click a link to open it
- **Graph View** — Interactive D3 mind map of all note connections
- **Full-text Search** — Fast SQLite FTS5 search (Ctrl+K)
- **Tags** — Tag and filter notes
- **File Attachments** — Upload images and files (50MB limit)
- **Themes** — Neural (default) and Neural Light, following your device's light/dark setting, plus Dark, Light, Dracula, Nord, Solarized and Tokyo Night
- **Multi-user** — First user becomes admin and invites everyone else
- **Hierarchical notes** — Nest notes inside each other
- **Offline-first** — Keep writing with no connection; changes upload automatically when you're back online
- **Installable** — Add to your phone's home screen or desktop as an app
- **Proxy-ready** — Works behind Nginx Proxy Manager, Cloudflare Tunnel

---

## Install

On a Linux server (64-bit PC / VM), run:

```bash
curl -fsSL https://raw.githubusercontent.com/Stevy2191/synapse/main/install.sh | sudo bash
```

The installer:

- checks your system and offers to install Docker if it's missing
- asks how you'll open Synapse:
  1. **On your home network**: `http://192.168.x.x:3001`
  2. **Through your reverse proxy** (Nginx Proxy Manager, Cloudflare Tunnel…), printing the settings to enter
  3. **At your own web address with HTTPS**: sets up [Caddy](https://caddyserver.com), which gets a free Let's Encrypt certificate automatically
  4. **HTTPS without a domain**: `https://192.168.x.x:8443`. Caddy creates this server's own certificate, and a small **trust page** (with a QR code) walks each phone or computer through trusting it once. After that there are no warnings, and offline mode works
- checks which ports are free, tells you what's using a busy one, and suggests a free one
- opens the port in your firewall (ufw / firewalld) if one is active
- prints the address and a **setup code** for creating the admin account

Prefer no questions? Pass the answers: `… | sudo bash -s -- --yes --mode home --port 3001` (see `install.sh --help`).

Installing by hand with Docker Compose instead? Download [`docker-compose.yml`](docker-compose.yml), then `docker compose up -d`; the setup code is printed in `docker compose logs`.

---

## First Run

1. Open the address the installer printed
2. Enter the **setup code** and create your account. The first account is the **admin**.
   (Lost the code? Run `synapse setup-code`.)
3. Add family members or teammates from **Settings → Admin**
4. Start writing

The setup code stops a stranger from claiming the admin account before you do. It's deleted once the admin exists.

---

## The `synapse` command

| Command | What it does |
|---|---|
| `synapse status` | Is it running, and at what address? |
| `synapse update` | Download and start the latest version |
| `synapse backup [folder]` | Save notes, uploads and settings to a `.tar.gz` |
| `synapse restore <file>` | Restore a backup (the current data is kept aside) |
| `synapse logs [-f]` | Recent logs (`synapse logs caddy` for HTTPS) |
| `synapse setup-code` | Show the admin setup code |
| `synapse users` | List accounts |
| `synapse reset-password <user>` | New temporary password (works for the admin too) |
| `synapse make-admin <user>` | Make someone an admin |
| `synapse port <number>` | Move to another port (checks it's free) |
| `synapse trust` | HTTPS without a domain: show the trust page address and QR code |
| `synapse set-ip [address]` | HTTPS without a domain: update after the server's IP changes (devices stay trusted) |
| `synapse restart` / `stop` / `start` | |
| `synapse uninstall` | Remove Synapse (asks before deleting notes) |

---

## Offline Mode

Synapse keeps a copy of your notes on each device, so you can open, search, write and organise notes without a connection.

- **While offline**, the badge in the top bar shows **Offline · N waiting**. Everything you do is saved on the device right away.
- **When you reconnect**, waiting changes upload automatically (or click the badge to sync now), and changes made on your other devices download.
- **Conflicts never lose work.** If a note was edited on another device while you were offline, the other device's version stays, and yours is saved next to it as **"Title (conflict copy)"**. Merge them by hand and delete the copy.
- **Install it:** in Chrome or Edge use *Install app* in the address bar; on iPhone use *Share → Add to Home Screen*.

Notes:
- Your first sign-in on a device needs a connection.
- Offline mode needs **HTTPS** (or `localhost`) for the app to open with no connection. No domain? Install option 4 gives HTTPS on the server's IP address. Your notes are still stored locally over plain HTTP, but the page itself won't load offline.
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
| `SETUP_CODE` | random | Code needed to create the admin account. `off` to skip it (trusted networks only) |
| `ALLOW_REGISTRATION` | `false` | `true` lets anyone create an account. Otherwise only the first user (admin) can register |
| `CORS_ORIGIN` | unset | Only needed if a different site calls the API from a browser (comma-separated list) |
| `PORT` | `3001` | Internal port |
| `DATA_DIR` | `/data` | Database and uploads location |

---

## Local Development

```bash
cd backend && npm install && npm run dev      # API on :3001 (data in ./data)
cd frontend && npm install && npm run dev     # UI on :5173, proxies /api to :3001
```

---

## Architecture

- **Backend:** Node.js + Express + better-sqlite3 (WAL mode)
- **Frontend:** React 18 + Vite + TipTap + CodeMirror + D3.js; themes are CSS variables in `frontend/src/themes/`
- **Auth:** JWT (7-day expiry)
- **Search:** SQLite FTS5 with porter stemmer on the server; in-browser search of the local copy in the app
- **Offline:** Service worker (vite-plugin-pwa) caches the app; IndexedDB holds notes plus an outbox of pending changes (`frontend/src/offline/`). Notes carry a version number so the server can detect conflicting edits
- **Graph:** D3 force simulation
- **Image:** Alpine Linux, hosted on GHCR
