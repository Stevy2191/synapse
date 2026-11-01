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
  routes/attachments.js, workspaces.js, admin.js   uploads, per-workspace prefs, admin tools
  settings.js, users.js, middleware/   server settings (Settings → Server), users, auth + rate limit
  cli.js, setup.js    first-admin setup code, `synapse` CLI helpers
  chat.js + routes/chats.js   Chat: tables (chats, chat_members, chat_messages, chat_files,
                      chat_reactions, push_subscriptions), SSE live hub, web-push (VAPID keys in
                      settings table), signed file links, GIF search proxy (GIPHY/Tenor key in settings)
  ai.js + routes/ai.js   AI assistant: per-user AI accounts (keys AES-GCM-encrypted with a key
                      derived from JWT_SECRET), Claude via @anthropic-ai/sdk, everything else via
                      OpenAI-compatible /chat/completions; SSE streaming; /write, /tasks, /ask, /models
  exporter.js + routes/export.js   headless Chromium (puppeteer-core): PDF printing + PNGs of
                      equations/charts for Word. Network blocked inside the page (data: URLs only)
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
  export/             Export (lazy-loaded): render.js builds one static HTML doc from notes (math,
                      Mermaid, code colours, diagrams/drawings as images, links → anchors);
                      styles.js (fonts inlined), docx.js (HTML → real .docx via `docx`),
                      markdown.js (zip of .md + attachments/), flowchart.js; UI in
                      components/editor/ExportDialog.jsx (Export button in the note top bar)
  chat/client.js      Chat data layer (zustand `useChat`): live stream via fetch-SSE with auth header,
                      reconnect + catch-up, unread, actions, push subscribe; chat/format.js = safe
                      message formatting (**bold**, links, @mentions, [[note]] links)
  components/chat/    ChatView (list+room, view 'chat'), ChatRoom, Message, Composer, GifPicker,
                      ChatDialogs (new chat, people, read the note); Chat button + side panel in Editor
  ai/client.js        AI calls from the browser (fetch-SSE streaming, settings)
  components/ai/      AiSettings (Settings → AI assistant), AiPanel (✨ on notes: top bar, selection
                      bubble, "/ai"), AskView (view 'ask', sidebar "Ask AI")
  public/push-sw.js   push + notificationclick handlers, pulled into the PWA service worker
  themes/index.js     themes as CSS variables; index.css has most component CSS
install.sh            one-line installer (modes home|proxy|https|lan-https, storage folder|volume|smb,
                      optional self-hosted draw.io); wrapped in { } so curl|bash is safe
scripts/synapse       the `synapse` CLI installed on the server (status, update, backup, drawio on|off …)
docs/screenshots/     README images (WebP), taken from a seeded demo
```

## Key design decisions

- **Export** (built Nov 2026): PDF, Word, Markdown (.zip), web page (.html); scope = note /
  note + sub-notes / whole workspace. All formats are built in the browser from the local copy
  (work offline) except PDF, which the server prints with Chromium (installed in the Docker
  image); if the server can't (offline / 503) the browser print dialog opens instead. Word asks
  the server for pictures of equations/Mermaid/SVGs, falling back to canvas / LaTeX text.
  New editor blocks need handling in `export/render.js` (and `docx.js` if structural).

- **Chat** (built Nov 2026): online-only (live by nature, nothing stored on the device).
  A chat is standalone or tied to one note (`chats.note_id`, unique); members are any users on
  the server (workspaces stay private). Note-chat members can *read* the note
  (`GET /api/chats/:id/note`, rendered with export/render.js) but not edit it — shared editing is
  the next step. Live delivery = one SSE stream per open app (`/api/chats/events`; excluded from
  compression, `X-Accel-Buffering: no` for nginx). Push goes out only when none of the person's
  apps is on screen (clients report visibility via `/chats/presence`); muted chats push only
  for @mentions/@everyone. Files: `DATA_DIR/uploads/chat/`, served via HMAC-signed links (≈1 week)
  because `<img>` can't send the auth header; unsent uploads purged after a day. GIF search needs
  an admin-entered GIPHY/Tenor key (Settings → Server); otherwise paste a GIF link.
  Push needs a secure context: on http://LAN-IP the bell shows "needs https" and explains.
  Messages are texting-style bubbles: mine on the right (accent colour), others on the left
  (Sean chose this), with the sender's avatar beside *every* bubble on both sides; hover
  actions = react / reply / ⋯ menu beside the bubble.
  Nicknames: `user_nicknames` (owner_id, target_id) — only the owner sees them, like phone
  contacts; set in Chat settings → People. Server adds `nickname` to /chats/users and chat
  members (per viewer) and uses it in push titles; client always names people via
  `personName()` / `userName()` in chat/client.js (nickname → display name → username).
- **AI assistant** (built Nov 2026): *each person* connects their own AI (Sean's choice — no
  shared/admin keys). Providers: Claude (official SDK; default model `claude-opus-5-5`, and for
  current Claude models server-side refusal fallbacks `fallbacks: "default"` + beta
  `server-side-fallback-2026-07-01`), ChatGPT, Grok, Gemini (its OpenAI-compatible endpoint),
  Ollama, LM Studio, any OpenAI-compatible URL. Online-only. Model lists come live from the
  provider ("Load models") — don't hard-code non-Claude model names. Prompts live server-side
  in routes/ai.js. Features: writing actions on selection/whole note (replace / insert below),
  "Find action items" → `- [ ] task (who) 📅 date` under "## Action items" (shows in Tasks),
  "Ask AI" = server FTS (OR of keywords) → top notes → answer citing [[Title]]. Workspace
  setting `ai: 'off'` hides AI and the server refuses requests for that workspace. Usage counted
  in `ai_usage`. Not built yet: suggest tags/titles, OCR via vision models.
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
- Export: LibreOffice (`soffice --headless --convert-to pdf`) + `pdftoppm` are in the sandbox,
  so Word/PDF output can be turned into images and looked at.
- Chat: two browser contexts (two users) in one Playwright script; add the 2nd user with
  `POST /api/admin/users`. Real push can't be tested in the sandbox (needs the browser's push
  service on the internet); GIF search likewise.
- AI: no internet in the sandbox — a stand-in script serves the Anthropic Messages API (port
  8098, used via `ANTHROPIC_BASE_URL`) and an OpenAI-compatible API (8099) with canned replies.
  The Anthropic SDK sends the key as `Authorization: Bearer` (not only `x-api-key`).
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
- Chat dialogs: a `window` keydown listener re-registered on every render (inline onClose)
  missed real Escape presses; Modal in ChatDialogs.jsx keeps one `document` listener + a ref.

## Ideas not built yet

Sean's priorities first (asked for Nov 2026):

- **File integrations** — browse, open and save files directly to:
  - OneDrive (Microsoft Graph; needs an Azure app registration Sean creates),
  - Google Drive (Drive API; needs a Google Cloud OAuth client),
  - a network share (SMB/NFS mounted into the container, like the install-time SMB option).
  Online-only feature; tokens stored server-side per user, encrypted. Uses: attach/link files
  in notes, save exports there, scheduled backups there.

Other ideas:

- **Shared note editing** (Sean wants this, follow-up to Chat): let note-chat members edit the
  note together — needs shared notes in sync (pull notes shared with me, permission checks in
  PATCH, a "Shared with me" section), ideally real-time (Yjs works with Tiptap).
- Version history per note (diff + restore); sharing / public read-only links.
- Note templates (meeting, project, recipe…); attachments other than images (PDF viewer
  inline, files); import from Obsidian / Notion / OneNote / Evernote.
- Web clipper (bookmarklet / browser extension) and email-to-note.
- Outlook calendar two-way: create a meeting note from an event, push tasks with due dates.
- Reminders / notifications for due tasks (web push, email, or ntfy/Gotify for self-hosters).
- Kanban board view of tasks; database/table views (properties per note, Notion-style).
- **OCR text recognition** (Sean wants this): pull text out of pasted images, screenshots,
  scanned PDFs and photos of documents/whiteboards — "Copy text from image" and "Insert text
  below", plus indexing the recognised text so search finds words inside pictures. Offline
  via Tesseract.js (printed text, runs on the server or device); handwriting / Free Draw via
  an AI vision model when the AI assistant is set up. Pen handwriting → typed text.
- PDF annotation with the pen.
- Family features: shared workspaces with per-person permissions, shared lists (groceries),
  family calendar view.
- Encrypted / locked notes (client-side encryption, e.g. for passwords-adjacent info).
- Automatic backups to a share or cloud drive with retention; one-click restore.
- Mobile polish; installable PWA "share to Synapse"; quick-capture widget.
- Public REST API + API tokens / webhooks (for Home Assistant, scripts, n8n).
