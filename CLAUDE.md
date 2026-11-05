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
- Versions: to cut a release, bump `version` in backend/ + frontend/ package.json (and their
  lockfiles) and add a `## vX.Y.Z` section to CHANGELOG.md. On merge to main,
  `.github/workflows/release.yml` creates the tag + GitHub Release (notes from the changelog) and
  builds `ghcr.io/stevy2191/synapse:vX.Y.Z`. (This session can't push tags itself — the git proxy
  only allows the working branch — which is why the workflow does it.)
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
  shares.js + routes/shares.js   note sharing (note_shares: view/edit, include_children), access
                      check noteAccess(), editing turn (in-memory lock, 60 s idle), note_versions
                      history (one entry per person per 10-min session), live note:update/note:lock
  routes/publish.js   published links (note_publications): owner API /api/publish, public no-auth
                      API /api/public (PIN check w/ lockout, expiry, view count, e2e blob)
  backups.js + routes/backups.js   automatic backups (admin, Settings → Server → Backups): tar.gz of
                      db.backup() snapshot + uploads/ + manifest; optional AES-256-GCM (.enc) with a
                      scrypt key; schedule/keep/password in settings (backup_*); signed download links
  cloudBackups.js     backup copies in OneDrive / Google Drive (setting backup_cloud = {provider, user_id, folder_id,
                      keep}; queue backup_cloud_queue, retried every 15 min ×12; prune automatic ones; list / bring back);
                      drive operations = files.js backupDrive() (chunked OneDrive upload session / Google resumable)
  files.js + routes/files.js   File integrations: network folders under /files/<slug> (FILES_DIR in dev;
                      access per folder in file_folders), OneDrive (Graph) + Google Drive (v3) via OAuth —
                      admin client id/secret in settings (secret encrypted), per-user tokens in
                      file_accounts (encrypted, refreshed); list/download/upload/attach-copy
  ocr.js + routes/ocr.js   OCR with tesseract.js (wasm, local): one worker, queued; languages in
                      DATA_DIR/ocr-lang (eng copied from @tesseract.js-data/eng 4.0.0_best_int, others
                      downloaded by the admin); background job reads pictures in notes → ocr_cache
                      (picture hash → text) → FTS; /api/ocr/lookup for devices; /ocr-assets serves the
                      engine + languages for offline reading on devices. imagehash.js = picture hash
  meetings.js + routes/meetings.js   meeting recordings: upload → queue (one at a time, resumed after a
                      restart) → ffmpeg to 16 kHz f32 → engine (server: speech/worker.js in worker_threads —
                      VAD → parallel Whisper ASR + diarization, merged by overlap; or AssemblyAI / Deepgram
                      with the person's key) → optional AI summary/to-dos → live 'meeting:update' events +
                      push. Audio in UPLOADS_DIR/meetings (backed up), signed audio links. speech/models.js =
                      admin downloads sherpa-onnx models (GitHub releases) into DATA_DIR/speech-models
  (clusters)          stored in workspace settings `clusters` — validated by validClusters in routes/workspaces.js
  reminders.js + routes/reminders.js   task reminders: reminder_prefs (summary on/time, timed on, tz from the
                      browser), reminders_sent (dedupe keys); every minute reads open dated tasks from each person's
                      notes' Markdown copy (taskWhen.js) → morning summary / ⏰ exact-time; delivered via chat.js
                      (SSE 'reminder' if on screen, else pushTo). taskWhen.js = token parser (sync with frontend)
  mailer.js           email via nodemailer: SMTP settings (smtp_host/port/security/user/from, smtp_pass_enc
                      AES-GCM with a JWT_SECRET key, app_url for links) — admin Settings → Server → Email
                      (/api/admin/email, /email/test); reminders.js dailyEmail() = meetings (calendar_events in the
                      person's tz) + due/overdue tasks, sent at reminder_prefs.email_time
  members.js          shared workspaces: workspace_members (role edit|view), workspaceRole/workspaceFor(need),
                      MY_WORKSPACES_SQL, workspacePeople, notifyWorkspace (SSE 'ws:changed' → members pull)
  collab.js           live editing: Yjs docs per note over WebSocket /api/collab (y-protocols sync+awareness +
                      JSON control: hello{gen,role} / seed / external{html} / reset{gen} ← html{html,md}); note_ydocs
                      (state, gen); isCollabNote = rich note in a workspace with members; externalChange()
  mentions.js         "@username" / "👤 username" newly added to a note → SSE 'mention' or push to that person
  activity.js         activity log (per workspace; 'edited' coalesced per person+note for 10 min) + inbox table,
                      logActivity / addToInbox (SSE 'inbox' {unread}) / pruneActivity; routes/inbox.js =
                      /api/team/inbox (+/count, /read) and /api/team/activity/:wsId
  routes/comments.js  note_comments (thread root id = thread_id = the highlight mark id; anchored/quote; resolve);
                      notifies thread people + @mentions (inbox, push), SSE 'comment:changed'
  restore.js          finishes a restore at startup (before the DB opens) from DATA_DIR/restore-pending
  exporter.js + routes/export.js   headless Chromium (puppeteer-core): PDF printing + PNGs of
                      equations/charts for Word. Network blocked inside the page (data: URLs only)
frontend/src/
  offline/db.js       IndexedDB (per user): notes, workspaces, outbox, calendar
  offline/sync.js     THE data layer: local-first reads/writes, outbox push, pull, search,
                      graph, links, trash helpers, undoDelete
  offline/tasks.js    Tasks: parse/edit checklist items in notes (rich via DOM, markdown by line)
  tasks/board.js      Board lists (workspace settings `board.columns` [{key,name,color}], todo/done required),
                      columnOf, moveTask, columnKey, emptyColumn; components/tasks/BoardView.jsx = Trello-style
                      board (pointer-event drag; touch = 280 ms press, touchmove blocked while dragging), CardDialog
  offline/taskWhen.js 📅 due / ⏰ time / 🔁 repeat / ⏫🔼🔽 priority / 🗂 <list> tokens: splitWhen, setWhen, parseRepeat, nextDue (keep the
                      regexes in sync with backend/src/taskWhen.js)
  components/editor/recurring.js   TaskWhen extension: token chips (click → synapse:taskWhen → TaskWhenDialog),
                      ticking a 🔁 task moves it to the next date (appendTransaction), applyWhen()
  components/tasks/TaskWhenDialog.jsx, ReminderSettings.jsx (Settings → Reminders); reminders/client.jsx
                      (tz report, ?open=tasks / ?note=<id> from notifications, in-app reminder toast)
  offline/dailyNotes.js  daily notes, meeting notes (Meetings › Month), to-dos from meetings — rendered from the
                      workspace's "Daily note" / "Meeting" template (templates/templates.js), else built-ins
  templates/templates.js  templates = notes inside the top-level "Templates" folder: STARTERS (built-ins), FIELDS,
                      fillTemplate (HTML; list fields on their own line → bullets, all-empty lines dropped),
                      newNoteFromTemplate, copyTemplateToWorkspace, sendTemplateToPerson (POST /notes/:id/send-template)
  components/templates/ TemplatePicker (new | insert; store templatePicker → AppPage; share panel), TemplateHint
  team/team.jsx       members cache (offline too), add/role/remove, live team events (ws:changed, workspaces:changed,
                      members:changed, mention), startTeam() prefetches members of the open workspace
  collab/session.js   CollabSession: Y.Doc + y-indexeddb (per user+note) + WebSocket provider + awareness; colorFor()
  comments/client.js  API + CommentMark (<span data-comment="id" class="comment-mark">, click → 'synapse:comment-open'),
                      markRanges/removeHighlight/scrollToThread; components/comments/CommentsPanel.jsx
  components/team/InboxView.jsx (view 'inbox', refreshInboxCount), ActivityView.jsx (view 'activity')
  components/team/MembersSettings.jsx (Settings → Workspace → Members); components/editor/mentions.js ("@" menu);
                      components/tasks/Assignee.jsx
  stores/useStore.js  zustand (persisted): user, workspaces, tree `notes`, activeNote, view …
  pages/AppPage.jsx   layout; `view` = editor | graph | tasks | trash
  components/editor/Editor.jsx      note page (title, tags, Write/Markdown modes, saving)
  components/editor/RichEditor.jsx  Tiptap v3 editor ("Write" mode, the default)
  components/editor/RichToolbar.jsx optional fixed formatting bar for Write mode (store `richToolbar`, per device)
  components/editor/TurnInto.jsx    "Turn into" dropdown in the selection toolbar (block conversions)
  tabs/tabs.js + TabBar.jsx         tabs of open notes (per workspace, persisted per device in store `tabs`)
  components/editor/FileLink.jsx    📎 file chip node (copy → /open-file?att=…, link → /open-file?src=… or drive web URL)
  files/client.js, components/files/ FilePicker (insert | save | browse), FileSettings (Server → Files, Connected drives)
  pages/OpenFilePage.jsx            /open-file — fetches a file with the sign-in header, shows or downloads it
  ocr/client.js, ocr/hash.js        readText (server, else tesseract.js on the device; handwriting → /api/ai/read-image),
                                    readPdf (pdf.js text, OCR for scanned pages), search index (IndexedDB store `ocr`)
  components/ocr/                   ReadTextDialog (Printed / Handwriting, Copy / Insert / New note), OcrSettings (admin)
  home/home.js        Home: useHome (prefs from /api/home, cached in localStorage synapse.home), togglePin, allNotes,
                      datedTasks (reminder rule), openAnywhere (switch workspace + open); components/home/HomeView.jsx
                      (view 'home', WsChip = workspace icon+name+colour); backend routes/home.js (home_prefs table)
  import/             Import (New → Import notes; components/import/ImportDialog.jsx, store importOpen → AppPage):
                      common.js ImportBuilder (notes + asset placeholders → unique titles, links, HTML+MD, sync.importNotes
                      bulk insert; files queued via pdf/files.js queueFile), cleanHtml (Evernote/OneNote HTML), readEntries
                      (zip via fflate / folder); markdownVault.js (Obsidian + Notion), evernote.js (.enex, spark-md5),
                      onenote.js (server: files.js oneNote*, routes /api/files/onenote/*)
  pdf/files.js, pdf/pdfjs.js, pdf/ink.js   PDF blocks: file store/upload, pdf.js loader, markings (draw, erase, bake)
  components/pdf/                   PdfNode (Tiptap node `pdf`, pickPdf/insertPdf), PdfBlockView (viewer + pen tools)
  meetings/client.js                recorder (zustand useRecorder: mic or getDisplayMedia + mic mixed, MediaRecorder,
                                    chunks kept in IndexedDB `recordings` until uploaded, retryUnsent), API
  components/meetings/              MeetingBlock (Tiptap node `meeting`), Recorder (RecordDialog, RecorderBar,
                                    beginMeeting), MeetingSettings (Settings → Meetings / Server → Meetings, Row/Group)
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
  shares/client.js    Shared-with-me list, turns, live note events (arrive on the chat SSE stream),
                      saving shared notes straight to the server
  components/share/   ShareDialog (people + Can view/Can edit), HistoryPanel (who/when + word diff, restore)
  clusters/clusters.js  Clusters: rules (FIELDS), inCluster / clusterNotes / clusterCounts (on the device,
                      offline), saveClusters (PATCH workspace settings — online only)
  components/clusters/ ClustersSection (sidebar, between the tree and Shared with me), ClusterEditor (rules
                      modal, live count), ClusterView (view 'cluster', store activeClusterId; add/remove by hand)
  publish/client.js   links + browser-side AES-GCM for end-to-end encrypted links (key in #k=…,
                      kept in this device's localStorage; re-uploads the scrambled copy after saves)
  pages/PublicNotePage.jsx  /p/:id — what visitors see (PIN form, decrypt, render, downloads)
  components/share/PublishDialog.jsx  Publish button on notes
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
- **Sharing & history** (built Nov 2026): share a note (optionally with everything inside it) with
  people on the server as **Can view** or **Can edit** (owner only changes sharing; PATCH in
  notes.js lets "edit" guests change content fields, not move/retype). **Take turns**: one editor at
  a time (`takeLock` on focus/first real keystroke, heartbeat 20 s, released on leaving, expires
  after 60 s idle, "Take over" = force). Shared notes — owner's too, while online — save straight to
  the server *only while holding the turn* (Editor `save` → `saveSharedNote`; owner then
  `storeServerNote()` replaces the local copy and drops queued outbox updates), because the
  editor sometimes re-saves a note on open and a stale queued save would overwrite someone
  else's edit. Live updates replace the open note when you're not the editor. Guests open shared
  notes from the server (online only); AI/Chat/Export are hidden for them. History is recorded for
  *every* note on each server save (`note_versions`), shown with a word diff and Restore.
- **Publishing** (built Nov 2026): owner makes links anyone can open at `/p/<128-bit id>`. Per link:
  **normal** (server returns the current note → always latest) or **end-to-end encrypted** (the note
  is AES-GCM-encrypted in the browser; key only in the link fragment `#k=` and the publishing
  device's localStorage; server stores ciphertext; the publishing device re-uploads after each save
  via `noteSaved()` in Editor). Optional PIN/password (bcrypt, 8 wrong tries per link+IP → 15 min
  lock), expiry date, "allow downloading" (print-to-PDF / Word / HTML in the visitor's browser —
  no anonymous server PDF printing). Visitors render with export/render.js inside a sandboxed iframe
  (no scripts). Encryption needs a secure context (https/localhost); the dialog warns when the
  address is LAN-only or not https.
- **Backups** (built Nov 2026): the server makes them itself (no Docker access needed) into
  `/backups` if mounted (installer + `synapse update` add `${SYNAPSE_BACKUPS:-./backups}:/backups`;
  `synapse backups-to <host folder>` sets SYNAPSE_BACKUPS), else `DATA_DIR/backups`. Default daily
  02:00 in the admin's browser time zone, keep 14 automatic ones (manual / before-restore / uploaded
  ones aren't counted; only 3 before-restore kept). Password: never stored — the scrypt-derived key
  is kept wrapped with a JWT_SECRET-derived key so schedules run unattended; each .enc header has
  salt + a check value, so the UI knows which backups need an older password. Restore = check +
  unpack into `restore-staging`, safety backup, rename to `restore-pending` (with `ready` marker +
  fixups.json), SIGTERM → Docker restarts → restore.js swaps DB + uploads → backups.js
  `finishRestore()` keeps the *current* backup_* settings, re-encrypts AI keys if the manifest
  carried the old AI key (only in encrypted backups). Restore also accepts `synapse backup`
  archives (data/ prefix). Clients need no special handling: pull compares versions and drops
  notes the server no longer has.
- **Cloud backup copies** (v1.20.0): Sean chose "its own keep number (default 7)" and "warn, but allow without a
  password". The admin who turns it on uses *their own* connected drive (file_accounts); folder "Synapse Backups"
  at the drive root (re-made if deleted). backups.js runBackup → afterBackup(name, kind) for automatic + manual
  (not before-restore). Uploads stream from the file in 10 MiB pieces (OneDrive createUploadSession with
  conflictBehavior replace; Google resumable + dedupe same name), 3 retries per piece. Only AUTO-named files are
  pruned in the cloud. backup_cloud* settings survive a restore (backup_ prefix). Test stand-in: scratchpad
  cb/mock2.py (upload sessions, resumable, DELETE, /fail/on|off, /state) on 8097. Not built: choosing another
  folder, sending to a network folder (NAS is done via `synapse backups-to`).
- **Home** (v1.22.0): Sean chose "home page with widgets" and "all workspaces, but clearly defined" → every item has a
  WsChip (workspace icon, name, colour) and filter chips narrow to one workspace. Boxes: today, tasks, pinned,
  recent, inbox, workspaces (order/hidden/pinned/start_home per person in home_prefs, synced; offline uses the
  localStorage copy). Two independent columns (chunks around the full-width Workspaces box). Opens at start unless
  start_home is off or the URL asks for a note. Home → New note sets store newNoteRequest (Sidebar opens its New
  window; opens the sidebar on phones). Sidebar/Search/Shared-with-me clicks now leave *any* non-editor view.
- **Import** (v1.21.0): Sean chose "a folder in this workspace" and "OneNote from the Microsoft account". All
  file parsing is in the browser; notes are added locally in one transaction (sync.js importNotes) and upload via
  the outbox. Pictures → data URLs (fitImage; 1000 px when a note has >20), PDFs → PDF blocks, other files → 📎
  chips; both kinds of files are stored in IndexedDB `pdfs` (generalised: `mime`) and uploaded with device-picked
  attachment ids once the note exists on the server (uploadPending retried). Titles are made unique against the
  workspace ("Name (2)") and links rewritten. OneNote: separate consent — POST /files/connect/onedrive {onenote:true}
  adds Notes.Read to the scope; the granted scope is kept in the token and reused on refresh (hasOneNote). Server
  inlines page pictures as data URLs; attachments via /api/files/onenote/resource (only Graph /onenote/resources/
  URLs). DOMPurify drops data-tag="to-do:completed" (looks like a URI) → markers translated first. ENML self-closing
  <en-todo/> must be expanded before HTML parsing. Not built: Evernote internal note links, created dates as note
  dates, Notion HTML exports, Obsidian canvas/Excalidraw. Test data + OneNote stand-in: scratchpad imp/, cb/mock2.py.
- **Tabs** (built Nov 2026): browser-like (Sean's choice). `activeNote` is still the one open note;
  a store subscription in tabs/tabs.js puts every opened note into the current tab (or switches to
  its tab if already open). `openInNewTab()` / `nextInNewTab()` (Ctrl/⌘/middle-click in the sidebar,
  Ctrl-click on [[links]]) and "+" (blank `new:` tab, filled by the next pick) add tabs. Tabs whose
  notes vanish from the tree are pruned; shared-with-me tabs reopen via openSharedNote.
- **Files** (built Nov 2026): Sean chose "choose each time" (Attach a copy / Link to it) and "admin adds
  folders, picks who" (everyone and/or people, read | write; admins get no automatic access). Folders are
  bind mounts `"<host>:/files/<slug>[:ro]"` added by `synapse files-add` (after the /backups line);
  paths are resolved with realpath and must stay inside the folder (symlinks out are refused). Clouds:
  each person connects their own account (popup → `/api/files/oauth/<p>/callback`, state kept in memory
  10 min; redirect URI = the browser's origin, shown on the admin page). helmet COOP is
  `same-origin-allow-popups` and the callback sends `unsafe-none`, otherwise the popup loses its
  opener. Copies go to the attachments table (50 MB cap; pictures are embedded as data URLs instead);
  downloads are served as attachments except safe inline types. Online-only. Nothing install-specific
  in code: all names/paths/keys come from settings or the CLI.
- **OCR** (built Nov 2026): Sean chose "both" (server when online, device when offline) and "English,
  more optional". Pictures are data URLs inside notes, so OCR results are keyed by a cyrb53 hash of the
  data URL (same function in backend/src/imagehash.js and frontend/src/ocr/hash.js — keep in sync).
  The server reads pictures in the background (every 2 min, ~90 s per round, tracked in ocr_note_scan
  by updated_at) and appends their text to the FTS row (searchableText); devices fetch texts for the
  hashes they have via /api/ocr/lookup after each pull and search them locally ("🖼 In a picture").
  Device fallback: tesseract.js with workerPath/corePath/langPath under /ocr-assets (CacheFirst in the
  service worker; prepareOffline() warms it after the first server read). Handwriting = the person's
  AI (vision; Anthropic image block / OpenAI image_url) — online only. Changing languages clears the
  cache so pictures are re-read.
- **Meetings** (built Nov 2026): Sean chose "server + optional cloud" and "keep audio with the note".
  Server engine = sherpa-onnx **WebAssembly** npm package (works on Alpine/musl; the native one is
  glibc-only), Whisper int8 (base.en default) + Silero VAD + pyannote segmentation (windowShiftRatio
  0.5) + NeMo TitaNet-small embeddings — ~2× faster than real time on 4 cores with 2 ASR workers.
  Recording: the block is inserted first with a localId; the upload result is announced by a window
  event (open editor) or patched into the saved note's rich_content (attachToSavedNote). The block
  copies segments/speakers into its attrs when done (offline-readable, searchable via the Markdown
  fence) and inserts "### Summary" / "### Action items" (`- [ ] task (who) 📅 date`) below once.
  Online calls need getDisplayMedia (Chrome/Edge desktop; no iPad/phone). Needs https (secure context).
- **Clusters** (built Nov 2026): AFFiNE-style collections; Sean chose the name "Clusters". Saved smart
  groups per workspace in `workspaces.settings.clusters` = `[{id, name, icon, match:'all'|'any',
  rules:[{field, op, value}], pinned:[noteIds], hidden:[noteIds], created_at}]`. Matching runs on the
  device over getWorkspaceNotes() (works offline); hidden always wins, pinned always included; no
  rules = only pinned notes. Fields: tag, title, text, kind, created, updated, inside, has. Editing
  needs a connection (workspace settings PATCH). Real folders were offered then and not wanted; Sean asked for
  them later (v1.23.0) — see Folders.
- **Folders** (v1.23.0): Sean chose "folders + sub-notes" (notes can still hold notes) and "convert holder notes".
  A folder is a note with `note_type='folder'` (NOTE_TYPES on the server), so sync, sharing, Trash, moves and
  drag and drop all work unchanged; its `content` is an optional plain description, editor_mode 'markdown'.
  Migration 5 (db/index.js) turned existing holders into folders: note with children and no own text, or only
  the blurb Synapse wrote (Daily notes / Meetings / Templates). Daily notes, Meetings › month, Templates and
  imports (root + textless vault folders) now create folders. folders/folders.js: newFolder, moveToFolder,
  open/closed state per device (localStorage `synapse.openFolders`), takeRename (select a new folder's name).
  components/folders: FolderView (folder page in Editor when noteType==='folder'), MoveToFolder (dialog,
  `useStore.setState({ moveToFolder: id })`). Folders are left out of the graph, [[ menu, clusters, Home's recent
  list, tasks; kept in search. Folder top bar: Share + Move only.
- **Meeting notes** no longer create a daily note (Sean disliked it): ensureMeetingNote only links an existing
  daily note; the template's {{day}} is empty otherwise (empty field drops the "Day:" line).
- **PDF blocks** (v1.19.0): Sean chose "block inside a note" and "keep original, markings on top". Tiptap node
  `pdf` (components/pdf/PdfNode.js + PdfBlockView.jsx): `<div data-pdf="<attachment id>" data-name data-pages
  data-ink='{"<page>":[strokes]}'>`, Markdown fence ```` ```synapse-pdf {json} ````. The file is a normal
  attachment whose id the *device* picks (`POST /api/attachments/note/:id?id=<uuid v4>`; same id + same note =
  no-op, other note = 409), so a block added offline already points at it; pdf/files.js keeps PDFs in IndexedDB
  store `pdfs` (db v5; `pending` until uploaded, uploadPending() on start / online / every 60 s; offline copies
  capped at 400 MB). Markings: pdf/ink.js, page units (page width = 1000), perfect-freehand outlines via
  freedraw strokePath; eraser removes whole strokes; bakeInk() draws them into a copy with pdf-lib (handles page
  rotation). Pen seen → fingers pan by hand (touch-action none while marking, so a pen never scrolls). pdf.js
  worker is `.mjs` → workbox globPatterns include mjs (needed offline). Export: render.js turns pages into PNGs
  (≤40), Markdown export adds the (marked-up) file. Not built: search inside PDFs, text notes/typing on pages,
  pinch-zoom inside the viewer, PDFs for public (published) links (shows "couldn't be included").
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
- **Reminders & repeating tasks** (built Nov 2026): Sean chose "morning summary + exact times" and "push
  only" (no email/ntfy). Tokens in the task text: `📅 2026-11-20 ⏰ 09:00 🔁 every month` (⏰ needs a date).
  Repeating = Todoist-style: ticking moves the date to the next occurrence (skipping past today if
  overdue) and leaves it unticked — no done copies kept. Done in the editor (recurring.js, undoable)
  and in updateTask (Tasks page); Markdown-mode typing of `[x]` doesn't trigger it. Server reads the
  Markdown copy (`content`) of the person's own notes (not shared ones), skips #no-tasks. Summary is
  sent once per day at/after the chosen time (up to 4 h late if the server was down); ⏰ reminders up
  to 20 min late. Delivery follows chat: live toast if an app is on screen, else push. Push test in the
  sandbox: web-push always uses https → a self-signed https stand-in + NODE_TLS_REJECT_UNAUTHORIZED=0,
  payload decrypted with http_ece.
- **Daily email** (built Nov 2026): Sean chose "admin sets the mail account once" and "separate from the push
  summary, both optional". Per person: email_daily / email_time / email_skip_empty in reminder_prefs; sent
  to the account's email once per local day (key `mail:<user>:<date>`, up to 4 h late; on SMTP failure
  retried every 15 min). Meetings = the person's enabled calendars' events overlapping their local day
  (all-day events: end date is exclusive). Links use the `app_url` setting (prefilled from the admin's
  browser). HTML is inline-styled tables (email apps ignore stylesheets) + a plain-text part.
  Testing: SMTP stand-in with the `smtp-server` + `mailparser` npm packages (scratchpad), ICS file
  served by `python3 -m http.server`.
- **Templates** (built Nov 2026): Sean chose "a Templates folder of notes" and "per workspace, but can be
  shared". Built-ins are usable without the folder (picker shows them with a "built-in" badge); the
  calendar's meeting/daily notes use the workspace template of that name if present. Sharing = a copy
  (to another own workspace locally, or to a person via the server into their first workspace's
  Templates folder + SSE 'template:received' toast). New note title: template title with fields filled
  if it has `{{…}}`, else "<Template> – Nov 2" (datedName, kept unique).
- **Board & priority** (built Nov 2026): Sean wanted it "almost like Trello", chose "status lists, add your
  own" and "new cards → today's daily note". List membership is a token in the task (`🗂 doing`; To do =
  none, Done = ticked) so it lives in the note like dates; list names live in workspace settings (key stays
  when renamed; deleting a list strips its token from open tasks). Priority tokens = Obsidian Tasks signs
  (⏫ high, 🔼 medium, 🔽 low; 🔺/⏬ read as high/low). Ticking a repeating task also clears its list.
  Board/list/group/sort choices are per device (localStorage synapse.tasks.*). Done list shows the 30 latest.
- **Team features** (built Nov 2026, part 1): Sean wants his office to use it; chose "people one by one" (no
  groups) and "live together, like Google Docs". Access: owner = workspaces.user_id, members in
  workspace_members; notes.js getWorkspace/getOwnedNote take a needed role ('view' to read, 'edit' to change),
  noteAccess() returns members first (`member: true`); edit members may only change settings.board/clusters.
  Live editing only for Write-mode notes in shared workspaces (Markdown notes there use the old conflict-copy
  rule; note_shares "take turns" sharing is unchanged elsewhere). The Yjs doc is the truth: editors don't
  save content through the outbox — they send `html` over the socket (server updates rich_content/content,
  history, mentions, ws:changed) and update the local copy with saveLocalCopy(). Live notes skip conflict
  copies. Writes from outside the editor (Tasks page, board, fallback) are REST PATCHes → externalChange():
  a connected editor applies it with setContent (y-prosemirror diffs it) or, with nobody connected, the doc
  is reset (gen+1) and re-seeded from rich_content by the next opener ("seed" goes to one client). A device
  whose stored gen differs drops its copy (saving a "(conflict copy)" note if it had unsent text). Editor
  shows the live editor once the doc is available locally or synced; offline with no local copy, or
  online but no socket for 12 s (proxy without WebSockets) → 'fallback' = normal editor + REST saves.
  Remote y-sync transactions are ignored by recurring.js and by saving (each person saves their own edits).
  Reminders: own workspaces = to-dos not assigned to someone else; shared = to-dos assigned to me.
  Testing: two/three Playwright contexts; context.setOffline + dispatch 'online' to test merging.
  Part 2 (built): Sean chose "comments on highlighted text" and "a bell with an inbox". The highlight is a
  mark in the note (syncs live, offline, history); whether it's coloured comes from a <style> the Editor
  builds from the *open* threads, so resolving needs no edit to the note. The editor picks the thread id
  (it's already in the text); cancelling a draft removes its mark. Comments/inbox/activity are online-only.
- **New window** (v1.18.0, components/editor/NewNoteModal.jsx; Sidebar createNote handles the choices):
  note / draw (Free Draw) / drawio / excalidraw (= a rich note holding an empty `figure[data-diagram]`,
  whose block view opens its editor on mount), template chips (workspace templates + built-ins, not
  "Daily note"), 'template' (full picker), 'daily' (openDailyNote with today's events). The legacy
  'diagram' note type (custom flowchart canvas) is no longer offered but still opens.
- **Tasks** are checklist items; due date is text in the item: `📅 2026-11-20`. Default view shows
  dated tasks + everything in meeting/daily notes; tag a note `#no-tasks` to exclude it.
- **First user = admin**, gated by a one-time setup code printed in logs / `synapse setup-code`.
- Tiptap packages must all be the same version (3.32.2). Images are stored as data URLs
  (resized) so they work offline.

- **Security** (review Nov 2026, v1.18.1): outbound requests to user-entered addresses go through
  backend/src/netguard.js `guardedFetch` (undici Agent with a DNS lookup that refuses blocked IPs at
  connect time + manual redirects, each hop checked; `publicHttpsAgent` for web-push). NEVER = link-local/
  metadata/multicast; LOCAL (loopback, RFC1918, CGNAT, fc00::/7) only if `mayUseLocal(user)` = admin or
  setting `allow_local_urls`. Used by calendars, AI (OpenAI-compatible), push. Helmet CSP is on (index.js:
  script-src self + wasm-unsafe-eval for OCR; img https:/http:; frame-src draw.io origin + YouTube/Vimeo/
  Loom; connect-src self + ws(s)://host) — new external resources need adding there. Per-account lockouts
  in middleware/accountGuard.js (login 10, MFA 6 per 15 min). `trust proxy` defaults to
  'loopback, linklocal, uniquelocal' (TRUST_PROXY env). Collab WebSocket uses one-time tickets
  (POST /api/notes/:id/collab-ticket, 60 s) and recheckCollab() every minute / on membership change.
  ffmpeg runs with -protocol_whitelist file and a -format_whitelist. Excalidraw font path is set in
  public/excalidraw-path.js before any app code (it reads it at module load; Vite chunk order made an
  in-bundle assignment too late). Tiptap is now 3.32.2 (all packages the same). Known leftovers: uuid
  (v3/v5 buffer issue, we only use v4), katex (needs prior prototype pollution; peer-capped at 0.18 by
  @tiptap/extension-mathematics), lodash-es/nanoid inside Excalidraw/mermaid (not reachable with user input).

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
- Files: `FILES_DIR=<tmp folder with subfolders>`; a stand-in for Microsoft login + Graph and Google
  OAuth + Drive (scratchpad mock/mock_cloud.py, port 8097) via MS_LOGIN_BASE, MS_GRAPH_BASE,
  GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_API_BASE, GOOGLE_UPLOAD_BASE (client secret "SECRET").
  After a rebuild the open app reloads itself once (appUpdate.js) — wait for it in scripts.
- OCR: test pictures can be made with Playwright screenshots of text; PDFs with page.pdf (an <img>
  only → a "scanned" PDF). The AI stand-in answers "transcribe images" system prompts. Simulate the
  device fallback with `page.route('**/api/ocr/image', r => r.abort())`. OCR_LANG_URL overrides where
  languages are downloaded from (serve a copy of eng as another code to test adding one).
- Meetings: Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<wav>` feed a WAV as the microphone. A two-voice test file can be
  made from the sherpa Whisper test_wavs (0.wav + 1.wav + 0.wav with silences, via ffmpeg). Serve the
  model files locally and set SPEECH_MODELS_BASE (same paths as GitHub releases); ASSEMBLYAI_BASE /
  DEEPGRAM_BASE point the cloud engines at stand-ins. The AI stand-in answers "meeting notes" prompts.
- Backups: restore makes the server exit (Docker restarts it); in the sandbox start it again by
  hand. Test a "new server" with a second DATA_DIR + different JWT_SECRET on another port.
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
- NFS/SMB data folders: SQLite's WAL shared-memory file fails there and shows up as "database is
  locked" at startup. db/index.js detects network filesystems from /proc/mounts (or
  SYNAPSE_NETWORK_STORAGE=true) and uses `locking_mode=EXCLUSIVE` (WAL, else TRUNCATE journal); a
  locked DB is retried with an explanation instead of crash-looping; SIGTERM closes the DB cleanly
  (Node as PID 1 ignores SIGTERM otherwise, so Docker used to SIGKILL it after 10 s).
  Even with that, an SMB mount made by the host *without `nobrl`* passes byte-range locks to the
  NAS, which often refuses → still "locked". better-sqlite3 is built with SQLITE_USE_URI=0, so the
  app can't switch to the unix-none VFS; the fix is `nobrl` on the mount (installer's own SMB
  option already uses it). The log + installer now detect a cifs mount without nobrl (or NFS
  without working locks) and print the exact fix.
- Stale app after an update (Sean saw it: new menu item only after a hard refresh): the PWA service
  worker kept serving the old cached app. Now every build has an id (vite `__BUILD_ID__` +
  dist/build.json → `/api/config.build`); `src/appUpdate.js` compares on start/visible/online and,
  if different, unregisters the worker, drops the precache and reloads (once per build per tab).
  sw.js/index.html/manifest are sent `no-store` so browsers and proxies don't cache them.
- @tiptap/extension-details ignores clicks on a toggle at doc position 0 (`if (!pos) return false`),
  so its open state never saved and it got stuck; blocks.jsx TaskCounter saves it in a click handler.
- Task lists = a toggle (details) holding a checklist; the "N of M remaining" badge is a widget
  decoration (TaskCounter in blocks.jsx), nothing stored — so Markdown/export formats are unchanged
  (export/render.js adds the same badge).
- Toggle titles (detailsSummary) can only hold text, so "headings" there are a `level` attribute
  (`<summary data-level="2">`, kept by Turndown/markdownToHtml/export). Use `setTextLevel()` /
  `textLevel()` from blocks.jsx for anything that sets heading levels, not setHeading directly.
- Settings look (AFFiNE-style, Nov 2026): the shared style objects in Settings.jsx (`section` = flat block
  with a bottom divider, no card) are passed to every page as `styles`; new pages should use them or the
  Row/Group components in components/meetings/MeetingSettings.jsx, not boxed cards.
- Phones: the sidebar is unmounted when closed (narrow screens), so anything opened *from* it (like the
  Files window — now `filesOpen` in the store, rendered in AppPage) must live outside it, and every
  full-screen view needs a way back (components/sidebar/SidebarButton.jsx).
- Tab in Write mode used to fall through to the browser (focus jumped to the next button, e.g. a toggle's
  arrow, and the page scrolled). components/editor/indent.js (priority 50, after lists/tables/menus) always
  swallows Tab/Shift+Tab: paragraphs/headings get `data-indent` 1–8 (CSS in RichEditor + export/styles.js),
  code blocks get two spaces, list items that can't move just stay.
- Suggestion menus ("/", "[[", "@") have priority 2000 so their Enter/arrow keys win over block keymaps
  (the toggle title's Enter used to steal it). Slash heading items call setTextLevel() (works on toggle
  titles); filterSlashItems(query, editor) limits the menu on a toggle title to TITLE_ITEMS.
- TurnInto.jsx (v1.22.1): replaceBlocks must set the selection inside the new block (+ scrollIntoView) — a
  replaced range leaves the cursor *after* it and the view jumped there. A selection starting on a toggle title
  (`fromTitle`) gets the full menu: heading items change only the title size when just the title is selected
  (`inTitle`); every other choice first `unwrapToggle()`s the whole details into plain lines, then applies.
  Per-line choices (lists, checklist, toggle, task list, code, math) first `splitBreaks()` — Shift+Enter /
  pasted lines are hardBreaks inside one paragraph and used to merge into a single item (v1.22.2).
- Chat dialogs: a `window` keydown listener re-registered on every render (inline onClose)
  missed real Escape presses; Modal in ChatDialogs.jsx keeps one `document` listener + a ref.

## Ideas not built yet

Sean's priorities first (asked for Nov 2026):

- (File integrations and cloud backup copies are built. Still open: search inside files, offline copies of
  attachments.)

Other ideas:

- Letting "Can edit" people add new notes inside a shared folder;
  showing embedded Free Draw drawings inside notes shared with you; offline copies of shared notes.
- Attachments other than images and PDFs (files). (Import from Obsidian / Notion / Evernote / OneNote is built.)
- Web clipper (bookmarklet / browser extension) and email-to-note.
- Outlook calendar two-way: push tasks with due dates (meeting notes from events are built).
- Reminders via ntfy/Gotify; per-task email reminders (push reminders + the daily email are built).
- Database/table views (properties per note, Notion-style). (Kanban board is built.)
- PDF follow-ups: search inside PDFs, typing text / signatures on pages, PDFs on published links.
- OCR follow-ups: search inside attached files/PDFs, reading text in pictures of shared notes for guests.
- Team follow-ups: groups/teams, shared lists, a team calendar view, comment reactions/emoji.
- Encrypted / locked notes (client-side encryption, e.g. for passwords-adjacent info).
- Meetings follow-ups: desktop helper app for one-click call recording, live (real-time) transcript,
  auto-recording prompts from calendar events; in Firefox/Safari hide "Online meeting" (no getDisplayMedia
  audio — Mozilla bug 1541425) and add a microphone picker (for Stereo Mix / virtual cables).
- Mobile polish. (Sean said no to "share to Synapse" / quick capture — Nov 2026; don't suggest it again.)
- Public REST API + API tokens / webhooks (for Home Assistant, scripts, n8n).
