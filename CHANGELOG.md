# Changelog

What's new in each Synapse release. Install or update with `synapse update` (always the newest).
Each release also has its own Docker image, `ghcr.io/stevy2191/synapse:<version>` (e.g. `:v1.1.0`),
so you can go back to a known version if you ever need to.

## v1.5.0 — November 2026

### New
- **Tabs** — keep several notes open at once, in tabs above the note. Works like a web browser:
  clicking a note opens it in the current tab; **Ctrl/⌘-click** or **middle-click** a note (or a
  `[[link]]`) opens it in a new tab, and **+** opens an empty tab to fill by picking a note (handy on
  a tablet). Close with ×, middle-click, or right-click → *Close other tabs*; drag tabs to reorder.
  Each device remembers its own tabs, even after a refresh.
- **Turn into** — select text and use the new menu at the start of the formatting toolbar to turn it
  into text, a heading, quote, bulleted/numbered list, checklist, toggle section, callout (note,
  tip, warning, danger), code block, equation, inline math, or a link to the note with that title.
  (It replaces the separate heading / quote / checklist buttons in that toolbar.)

## v1.4.1 — November 2026

### Fixed
- **Old version showing after an update** — browsers (or a reverse proxy) could keep showing the
  previous version of Synapse until a hard refresh (e.g. no Backups in Settings). Synapse now
  notices when the server has a newer version and switches to it by itself.
- The `synapse` command finds your install when run from Synapse's folder, and keeps its folder when
  it updates itself.
- Backups page: the example uses a generic NFS/SMB share path, and shows the folder you chose.

## v1.4.0 — November 2026

### New
- **Automatic backups** — Settings → Server → **Backups** (admins). Synapse saves a copy of
  everything (every person's notes, drawings, pictures, chats, accounts and settings) every day at
  2 am by default — or weekly, at the time you choose — and keeps the newest 14. Backups run while
  Synapse keeps working; nobody is signed out.
  - **Back up now**, **Download**, **Delete**, and **Restore** right from Settings. Restoring first
    saves a backup of how things are now (so it can be undone), then restarts Synapse with the
    backup in place.
  - **Optional backup password** — backups are then encrypted (AES-256); nobody can open them
    without the password. The password can't be recovered, so keep it somewhere safe.
  - **Restore on a new server** — install Synapse, create an admin, then *Add a backup file* and
    Restore. Saved AI keys come along in password-protected backups.
  - Backups go to a `backups` folder next to your notes. To keep them on your NAS instead, run once:
    `synapse backups-to "/path/to/NFS-or-SMB-share"`.
  - Backups made with `synapse backup` show up in the list too and can be restored from there.
- `synapse update` now also updates the `synapse` command itself.

### Improved
- When an SMB/NFS data folder refuses file locks, the log and the installer now explain the exact
  fix (add `nobrl` to the SMB mount).

## v1.3.1 — November 2026

### Fixed
- **“database is locked” when notes are on an NFS or SMB folder** — Synapse now recognises a data
  folder on a network share by itself and uses network-safe database settings (before, only the
  installer's own share option did). No `.env` setting needed.
- If the database really is locked, Synapse explains the likely causes in the log and keeps trying
  for a couple of minutes, instead of crash-looping.
- Synapse now stops cleanly on `synapse update` / `restart` / `stop` (it used to be force-stopped
  after 10 seconds), so no lock is left behind on a network share.

## v1.3.0 — November 2026

### New
- **Publish notes as links** — click **Publish** on a note to get a link anyone can open, no account
  needed. Make as many links as you like, each with a name only you see and a view count.
  - **Normal link** — always shows the latest version of the note.
  - **End-to-end encrypted link** — the note is scrambled in your browser with a key that's only in
    the link; your server stores just a scrambled copy. It updates when you save the note on the
    device you published it from. (Needs your https address.)
  - Optional **PIN or password** (locks for 15 minutes after 8 wrong tries), **expiry date**, and
    **let visitors download** (PDF / Word / web page).
  - Change or unpublish a link any time.

### Good to know
- People outside your home can only open a link if Synapse is reachable from the internet — publish
  from your public https address.

## v1.2.0 — November 2026

### New
- **Share notes with permissions** — click **Share** on a note, pick people on your server, and give
  each **Can view** or **Can edit**; tick “Include the notes inside it” to share a whole folder.
  They’re notified and see it under **Shared with me**. Only the owner changes sharing.
- **Take turns editing** — one person edits a shared note at a time; everyone else sees the changes
  appear live with “Mom is editing”. The turn passes on when they leave or after a minute idle,
  and there’s a **Take over** button.
- **History** on every note — who changed what and when, with added and removed words highlighted,
  and **Restore** for any older version.

### Good to know
- Notes shared *with* you need a connection to open and edit; your own notes still work offline.
- New releases are now published automatically (tag, release page and a versioned Docker image).

## v1.1.0 — November 2026

### New
- **AI assistant (bring your own AI)** — connect Claude, ChatGPT, Grok, Gemini, or an AI running on
  your own computer (Ollama / LM Studio). Each person adds their own key in **Settings → AI assistant**;
  keys are stored encrypted on your server.
  - ✨ **AI** on notes (top bar, selected text, or `/ai`): improve, fix grammar, shorten, lengthen,
    summarise, explain, change tone, translate, continue writing, or any request — with a preview
    before anything changes.
  - **Find action items** turns meeting notes into checklist tasks with due dates (they show in Tasks).
  - **Ask AI** answers questions from your own notes and links the notes it used.
  - Any workspace can be kept AI-free (**Workspace → Preferences**).
- **Chat** — live conversations with family or your team, on their own ("Vacation 2026") or about a
  note (members can read it). Texting-style bubbles with everyone's picture, emoji, GIFs, pictures and
  files, replies, reactions, edit/delete, @mentions, `[[note]]` links, unread badges, typing
  indicators, personal nicknames, and phone/computer notifications (needs an https address).
- **Export** — save a note, a note with everything inside it, or a whole workspace as **PDF**,
  **Word** (.docx), **Markdown** (.zip, Obsidian-friendly) or a single **web page**.

### Improved
- Search (Ctrl K): Enter opens the highlighted result; arrow keys move between results.
- Clicking a note from the Chats or Ask AI page now opens it.

### Notes for updating
- The Docker image is larger (about 200–300 MB more) because PDF export includes a built-in browser.
- For GIF search in chat, an admin can add a free GIPHY or Tenor key in **Settings → Server**.

## v1.0.0

The first version: offline-first notes with Write and Markdown modes, wiki links and graph, the "/"
menu (callouts, toggles, tables, code, math, Mermaid, draw.io and Excalidraw), Free Draw for pen and
touch, flowcharts, Tasks, daily and meeting notes, calendars, Trash, workspaces, passkeys and
two-step sign-in, and the one-line installer with the `synapse` command.
