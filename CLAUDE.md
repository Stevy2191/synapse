# Synapse — notes for Claude

Self-hosted, offline-first notes app (Obsidian / Outline / AFFiNE-style) run by its owner, Sean
(GitHub: Stevy2191), for himself and family. One Docker container (Node + SQLite) serving a React
app. Most of what's here was built in one long session; this file is the hand-off.

## How Sean works (please keep doing this)

- He's an IT person, not a full-time developer. **Explain results in plain language**: what
  changed, what he'll see, what he needs to do. Avoid jargon.
- He asks for features in a sentence; for anything with real choices, ask 1–2 multiple-choice
  questions (with a recommended option) before building. Otherwise just build it.
- **Never merge to `main` without his OK.** Develop on a branch, push, summarise, then ask
  "Want me to merge it to main?". "Merge to main" means a fast-forward push:
  `git fetch origin main && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main`
- Releases: every push to `main` → GitHub Actions (`.github/workflows/docker.yml`) builds
  `ghcr.io/stevy2191/synapse:latest` → he runs `synapse update` on his server. Tell him that.
- **Test in a real browser before saying something works** (see Testing). Say honestly what
  was and wasn't tested (e.g. no internet in the sandbox → couldn't load diagrams.net).
- Uses: Windows PC, a tablet with a pen (iPad/Safari likely), self-hosted Bitwarden,
  Outlook calendar. Installs in `/srv/docker/synapse`.

## Layout

```
backend/src/
  index.js            Express app, /api/config, startup (setup code, calendar sync, trash purge)
  config.js           env: DATA_DIR, JWT_SECRET, TRASH_DAYS (30), ALLOW_REGISTRATION …
  db/index.js         SQLite schema, addColumn migrations, versioned migrations, FTS indexing
  routes/notes.js     notes CRUD, offline-sync protocol (version / base_version / op_id),
                      conflict copies, [[link]] table, Trash (soft delete, restore, purge)
  routes/auth.js, security.js, mfa.js   login, setup code, TOTP, passkeys, recovery codes
  routes/calendars.js + calendars.js    ICS calendars, fetched server-side every 15 min
  cli.js, setup.js    first-admin setup code, `synapse` CLI helpers
frontend/src/
  offline/db.js       IndexedDB (per user): notes, workspaces, outbox, calendar
  offline/sync.js     THE data layer: local-first reads/writes, outbox push, pull, search,
                      graph, links, trash helpers, undoDelete
  offline/tasks.js    Tasks: parse/edit checklist items in notes (rich via DOM, markdown by line)
  offline/dailyNotes.js  daily notes, meeting notes (Meetings › Month), to-dos from meetings
  stores/useStore.js  zustand (persisted): user, workspaces, tree `notes`, activeNote, view …
  pages/AppPage.jsx   layout; `view` = editor | graph | tasks | trash
  components/editor/Editor.jsx      note page (title, tags, Write/Markdown modes, saving)
  components/editor/RichEditor.jsx  Tiptap v3 editor ("Write" mode, the default)
  components/editor/extensions.js   "/" menu (SLASH_ITEMS, grouped), [[ suggest, wiki decorations
  components/editor/convert.js      Markdown ⇄ HTML (marked + turndown) incl. all custom blocks
  components/editor/blocks.jsx      callouts, table of contents, toggles (details)
  components/editor/embeds.jsx      KaTeX math, video embeds, Mermaid
  components/editor/CodeBlockView.jsx + codeLanguages.js   code blocks, ~95 languages
  components/diagrams/              draw.io (embed protocol) + Excalidraw blocks
  components/freedraw/              Free Draw note type (canvas, pen/touch, model/render)
  components/tasks, trash, calendar, sidebar (Settings.jsx, SecuritySettings.jsx), graph
  components/ColorPicker.jsx, noteKinds.js (icons/labels/auto-names per kind of note)
  themes/index.js     themes as CSS variables; index.css has most component CSS
install.sh            one-line installer (modes home|proxy|https|lan-https, storage folder|volume|smb,
                      optional self-hosted draw.io); wrapped in { } so curl|bash is safe
scripts/synapse       the `synapse` CLI installed on the server (status, update, backup, drawio on|off …)
docs/screenshots/     README images (WebP), taken from a seeded demo
```

## Key design decisions

- **Offline-first**: the UI reads/writes IndexedDB; `sync.js` pushes an outbox and pulls.
  Notes carry `version`; edits send `base_version` + `op_id`; a mismatch makes a
  "(conflict copy)" note on the server (keep-both). `getWorkspaceNotes()` is the local source of truth.
- **Two copies of text**: Write-mode notes store HTML in `rich_content` (source of truth) and a
  Markdown copy in `content` (search, links, Markdown view). Markdown-mode notes use `content`.
  Anything new in the editor needs Turndown rule + `markdownToHtml` handling in `convert.js`
  (and usually Markdown-preview handling in `Editor.jsx` `renderMarkdown`/`PreviewHtml`).
  Formats used: callouts `> [!NOTE]`, `[TOC]`, `<details>`, `$…$`/`$$…$$`, `[▶ Video](url)`,
  ```` ```mermaid ````, ```` ```synapse-diagram ```` (draw.io/Excalidraw JSON), `![[Drawing]]`.
  Empty inline/blocks need `special()` in convert.js (Turndown drops blank nodes).
- **Links are by title** (`[[Title]]`), so auto-names are kept unique.
- **Trash**: server-side soft delete (`deleted_at`, `trash_root`); all list/search/graph/link
  queries filter `deleted_at IS NULL`; purge after `TRASH_DAYS` at startup + every 6 h. Clients
  just see trashed notes disappear on pull; the Trash page is online-only. Editing a trashed
  note (offline device) restores it.
- **Tasks** are checklist items; due date is text in the item: `📅 2026-11-20`. Default view shows
  dated tasks + everything in meeting/daily notes; tag a note `#no-tasks` to exclude it.
- **First user = admin**, gated by a one-time setup code printed in logs / `synapse setup-code`.
- Tiptap packages must all be the same version (3.22.5). Images are stored as data URLs
  (resized) so they work offline.

## Testing (how this was done)

- Build: `cd frontend && npm run build` (the backend serves `frontend/dist`).
- Run: `cd backend && DATA_DIR=<tmp> PORT=3001 node src/index.js` — fresh DATA_DIR each time;
  read the setup code from the log (`admin account: XXXX-XXXX`) and register with it.
- Playwright + headless Chromium (preinstalled in the sandbox): log in, click through, read
  IndexedDB in `page.evaluate`, screenshot and *look at* the screenshots. Pen input:
  CDP `Input.dispatchMouseEvent` with `pointerType: 'pen'`, `force`; touch: `Input.dispatchTouchEvent`.
- draw.io can't load in the sandbox (no internet): serve a stand-in page that speaks the embed
  protocol and set `DRAWIO_URL=http://localhost:8098`.
- Installer/CLI: ShellCheck (`-S warning`), `SYNAPSE_DRY_RUN=1`, fake `docker` on PATH.
- Kill the test server by PID (`pgrep -x node` + check cmdline); `pkill -f "node src/index.js"`
  also kills the shell running it.

## Gotchas found the hard way

- A CSS reset from a library sets `ol, ul { list-style: none }` — markers are re-enabled in index.css.
- iPad Safari: use `100dvh` (not `100vh`) or the bottom of the sidebar is hidden.
- Free Draw: pointer events need `touch-action: none` and `preventDefault` on pointerdown
  (otherwise focus jumps and typing becomes tool shortcuts).
- Popovers inside Tiptap's floating (bubble) menu, like the colour picker, must render inline,
  not in a portal, or the menu closes when you click them.
- `pendingChanges()` returns a count; outbox entries are keyed by `seq`.
- Search/trash excerpts: use one of rich/markdown text, not both (it doubled the text).

## Ideas not built yet

- Version history per note; sharing / public links; real-time collaboration.
- Note templates; attachments other than images in the editor; import from Obsidian/Notion.
- Mobile-specific UI polish; a native "share to Synapse".
