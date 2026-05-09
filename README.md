<div align="center">

<svg width="80" height="80" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="nodeGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </radialGradient>
    <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#a5b4fc"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </radialGradient>
  </defs>
  <g filter="url(#glow)" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" opacity="0.7">
    <line x1="36" y1="36" x2="16" y2="16"/>
    <line x1="36" y1="36" x2="56" y2="14"/>
    <line x1="36" y1="36" x2="62" y2="38"/>
    <line x1="36" y1="36" x2="52" y2="58"/>
    <line x1="36" y1="36" x2="18" y2="56"/>
    <line x1="36" y1="36" x2="10" y2="38"/>
    <line x1="16" y1="16" x2="56" y2="14" stroke-dasharray="3 3" opacity="0.4"/>
    <line x1="62" y1="38" x2="52" y2="58" stroke-dasharray="3 3" opacity="0.4"/>
    <line x1="10" y1="38" x2="18" y2="56" stroke-dasharray="3 3" opacity="0.4"/>
  </g>
  <g fill="#818cf8" opacity="0.5">
    <circle cx="8" cy="12" r="1.5"/>
    <circle cx="20" cy="8" r="1.5"/>
    <circle cx="66" cy="10" r="1.5"/>
    <circle cx="68" cy="42" r="1.5"/>
    <circle cx="56" cy="64" r="1.5"/>
    <circle cx="14" cy="62" r="1.5"/>
    <circle cx="6" cy="34" r="1.5"/>
  </g>
  <g filter="url(#glow)">
    <circle cx="16" cy="16" r="5" fill="url(#nodeGrad)" opacity="0.9"/>
    <circle cx="56" cy="14" r="4" fill="url(#nodeGrad)" opacity="0.85"/>
    <circle cx="62" cy="38" r="4.5" fill="url(#nodeGrad)" opacity="0.9"/>
    <circle cx="52" cy="58" r="4" fill="url(#nodeGrad)" opacity="0.85"/>
    <circle cx="18" cy="56" r="5" fill="url(#nodeGrad)" opacity="0.9"/>
    <circle cx="10" cy="38" r="3.5" fill="url(#nodeGrad)" opacity="0.8"/>
  </g>
  <circle cx="36" cy="36" r="9" fill="url(#centerGrad)" filter="url(#glow)"/>
  <circle cx="36" cy="36" r="5" fill="white" opacity="0.25"/>
  <circle cx="36" cy="36" r="2.5" fill="white" opacity="0.6"/>
</svg>

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
