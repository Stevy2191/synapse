# Changelog

What's new in each Synapse release. Install or update with `synapse update` (always the newest).
Each release also has its own Docker image, `ghcr.io/stevy2191/synapse:<version>` (e.g. `:v1.1.0`),
so you can go back to a known version if you ever need to.

## v1.18.1 — November 2026

### Security
A full security review. Fixes:
- **The server can no longer be used to reach your network.** Calendar links and AI service addresses
  (and push notification endpoints) are checked before the server connects: cloud-metadata addresses are
  always refused, and addresses on the server's own network (192.168.x.x, 10.x.x.x, localhost…) are only
  allowed for admins — or for everyone if an admin turns on **Settings → Server → Let everyone use
  local-network addresses** (needed if family/office members use Ollama on your LAN). Every redirect is
  checked too.
- **Content-Security-Policy turned on**: browsers only run Synapse's own code, so even if harmful HTML
  ever got into a page it couldn't run. Also stops other sites from framing Synapse.
- **Password and two-step-code guessing limited per account** (10 wrong passwords or 6 wrong codes →
  that account's sign-in pauses for 15 minutes), on top of the per-address limits. Published-link PINs
  also have a limit across all addresses.
- **Visitors can't fake their address** to get around those limits: only proxies on this machine or a
  private network are trusted to report it (`TRUST_PROXY` to change).
- **Live editing:** the connection now uses a one-time pass instead of putting the sign-in in the
  address (proxies log addresses), and people removed from a workspace — or signed out everywhere — are
  disconnected immediately instead of being able to keep editing an open note.
- **Meeting recordings:** only ordinary audio/video files are processed (a disguised "playlist" file
  could otherwise make the converter read other files or fetch addresses).
- **Updated libraries with known security bugs**: the editor (Tiptap 3.32, ProseMirror — fixes a paste
  issue), the HTML cleaner (DOMPurify), Express, compression, nodemailer, axios and others.
- Excalidraw whiteboards now load their fonts from your server only (they also tried esm.sh on the internet).

## v1.18.0 — November 2026

### Changed
- **New "New" window** (the + next to Notes, or New note). Four clear choices, each one click (or keys 1–4):
  - **Note** — text, checklists, tables, tasks, meetings, pictures…
  - **Drawing** — a full page for handwriting and sketching with a pen or finger.
  - **Diagram** — a note with a draw.io diagram, which opens straight away.
  - **Whiteboard** — a note with an Excalidraw sketch, which opens straight away.
- **Your templates are right there** as one-click buttons (Meeting, Project, Weekly review…), plus
  **All templates**, and a **Today's daily note** button.
- The old standalone flowchart canvas is no longer offered for new notes (draw.io diagrams replace it);
  existing flowchart notes still open and work as before.

## v1.17.1 — November 2026

### Fixed
- **Tab in notes:** pressing Tab on a plain line (for example inside a toggle) or on a bullet that
  couldn't be indented any further jumped out of the note to the bottom of the page. Tab now always
  stays in the note.
- **"/" menu:** typing `/h1`, `/h2` or `/h3` found nothing (only "heading 1/2/3" did), so Enter just
  made a new line. These short names work now.
- **"/" menu on a toggle's title:** choosing a heading now makes the title that size (like the H1–H3
  buttons), and Enter picks the menu item instead of jumping into the toggle. On a toggle title the menu
  only offers what fits there (text sizes, date/time, link, AI).

### New
- **Indent plain lines and headings** with Tab (Shift+Tab to undo) — up to 8 steps, inside toggles too.
  Bullets and checklists indent as before; in a code block Tab adds two spaces.

## v1.17.0 — November 2026

### New — team features (part 2)
- **Comments on highlighted text** (like Google Docs / Word): select words in a note → **Comment**. The
  words get a yellow highlight and the thread opens in a **Comments** panel beside the note, where people
  reply, edit or delete their comments, and **Resolve** the thread (the highlight goes away; **Reopen**
  brings it back). There's also **Comment on the whole note**. Click highlighted text to jump to its
  thread; the **Comments** button in the note's top bar shows how many are open. People who can only
  view a workspace can still comment on the whole note. Comments need a connection.
- **Inbox** (the bell in the sidebar, with a count): when someone @mentions you (in a note or a comment),
  assigns you a to-do, replies to a thread you're in, resolves your comment, or adds you to a workspace.
  Click an item to go straight to it (the right comment thread opens); **Mark all read**.
- **Activity** (sidebar, in shared workspaces): who created, edited, deleted, restored or commented on
  what, grouped by day, with a filter per person.

## v1.16.0 — November 2026

### New — team features (part 1)
- **Shared workspaces.** Workspace menu → **Share this workspace…** (or Settings → Workspace → Members):
  add people on this server as **Can edit** or **Can view**. They see the workspace in their own
  workspace menu (with the owner's name) and get a notification. The owner can change or remove
  people; members can leave. Everything in the workspace is shared — notes, the task board, templates.
- **Edit together, live** (like Google Docs): Write-mode notes in a shared workspace can be edited by
  several people at the same time. You see each other's cursors with names, and a bar at the top shows
  who's in the note. Edits made offline are kept on the device and **merged in automatically** when it
  reconnects. People who can only view see changes appear as they're typed.
- **New notes and changes by teammates appear within a couple of seconds** — no refresh needed.
- **@mentions:** type `@` in a note of a shared workspace and pick someone; they get a notification
  with a link to the note.
- **Assign to-dos to people:** in a to-do's details (/due, or click a card on the board) choose
  **Assigned to**. They get a notification and that to-do's reminders, and their avatar shows on the
  card. Tasks has an **Assigned to** filter (Everyone / Me / Nobody / a person).

### Notes
- If you use your own reverse proxy (e.g. Nginx Proxy Manager), turn on **Websockets Support** for
  live editing. Without it, notes still save normally and Synapse tells you.

## v1.15.0 — November 2026

### New
- **Board view for Tasks** (like Trello): Tasks → **Board**. A list per status — To do, Doing, Done — with
  cards showing priority labels, due dates (orange today, red overdue), reminder time, repeat and the
  note each to-do lives in.
  - **Drag cards** between lists with the mouse or pen; on a phone or tablet, press and hold a card,
    then drag. Dropping on Done ticks it off (repeating to-dos move to their next date instead).
  - **Add your own lists** (“Add another list”), rename, recolour, move or delete them from a list's ⋯
    menu. Lists are shared by all your devices.
  - **Add a card** at the bottom of any list — it's saved to today's daily note, already in that list.
  - **Click a card** to set its priority, move it, change the date/reminder/repeat, open its note, or mark it done.
- **Priority: High / Medium / Low** on any to-do — from the card, the date window (**/due** or
  **/priority** in a note), or when adding a task. Shown as coloured labels everywhere.
  - **Sort by** priority, due date or note, and **group by** priority — on the board (columns per
    priority; drag to change it) and on the list (sections per priority).
  - The daily email and the morning summary list high-priority to-dos first.
- In notes these are small signs after the to-do, like dates: `⏫` high, `🔼` medium, `🔽` low (the same
  signs as Obsidian's Tasks plugin) and `🗂 doing` for the list it's in.

## v1.14.0 — November 2026

### New
- **Templates.** Make a note from a template with **+ → From a template** (in the sidebar), or drop one
  into an open note with **/template**. Built-in: Meeting, Daily note, Project, Weekly review, Recipe.
  - Your own templates are ordinary notes in a **Templates** folder in each workspace — write them with
    any blocks. **Add built-ins to my templates** puts editable copies there.
  - **Fill-in fields** are replaced when a note is made: `{{date}}`, `{{date_short}}`, `{{today}}`,
    `{{time}}`, `{{title}}`, `{{me}}` and more (a “Template · fill-in fields” button on template notes
    lists them). Lines whose fields are all empty are left out.
  - **Share a template:** copy it to another of your workspaces, or send a copy to someone else on the
    server (it appears in their Templates folder, and they get a message).
- **Meeting notes from the calendar use your “Meeting” template** (the + on an event → Meeting note):
  meeting name, when, where, a Join link, the attendees and a link to the day — plus whatever you add.
  **Daily notes use your “Daily note” template.** Both are now normal Write-mode notes.

## v1.13.0 — November 2026

### New
- **Daily email:** every day at the time you choose, an email with **today's meetings** (from your
  connected calendars — time, place and a Join link for online meetings), **what's due today** and
  **what's overdue**, each linking straight to its note in Synapse. Turn it on in
  **Settings → Reminders → Daily email**; "Skip quiet days" leaves out days with nothing on, and
  "Send today's email now" shows you what it looks like. Works alongside the push reminders.
- **Settings → Server → Email** (admins): the mail account Synapse sends from — any provider with SMTP
  (Gmail / iCloud / Outlook with an app password, Proton on paid plans, or your own mail server), with
  a **Send a test email** button. The password is stored encrypted.

## v1.12.0 — November 2026

### New
- **Reminders** for to-dos with a due date.
  - **Morning summary:** one notification a day (08:00 by default) listing what's due today and
    what's overdue. Nothing is sent on days with nothing due.
  - **At the task's time:** give a to-do a time (⏰) and you get a reminder right then.
  - Arrives as a phone/computer notification when Synapse isn't open (turn notifications on in
    **Settings → Reminders**, needs the https address), or as a pop-up while it is. Tapping it opens
    the note or Tasks. Times follow your own time zone. There's a **Test** button.
- **Repeating to-dos:** `🔁 every week` (day, weekday, 2 weeks, month, year, "monday and thursday"…).
  Ticking one moves it to its next date instead of finishing it — in the note or on the Tasks page.
- **Due date & reminder window:** type **/due** in a note, use the new 🔔 button in the formatting bar,
  or click a date in a to-do — pick the day (Today / Tomorrow / Next week), a reminder time and how it
  repeats. Dates, times and repeats show as small chips in notes (overdue ones in red), and on the
  Tasks page. Still plain text underneath: `Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month`.

## v1.11.0 — November 2026

### New
- **Clusters** — smart groups of notes (like AFFiNE's collections). A cluster gathers notes from
  anywhere in a workspace that match its rules, without moving them; a note can be in many clusters.
  - Make one with **+** next to **Clusters** in the sidebar. Rules: tag, words in the title or text,
    kind of note, created / edited (in the last week, before or after a date), inside a note, or
    has open to-dos, a checklist, a meeting recording, pictures, files, links or tags. Match **all**
    or **any** of the rules, and see how many notes match while you build it.
  - New notes join by themselves as soon as they match. On a cluster's page you can also **add notes
    by hand** or **remove** one (the note itself isn't touched; "bring back" undoes it).
  - Clusters sync to all your devices and work offline (changing them needs a connection).

## v1.10.2 — November 2026

### Fixed
- **Phones:** tapping **Files** in the sidebar only closed the sidebar — the Files window now opens.
- **Phones:** the **Tasks** and **Trash** pages had no way back to the sidebar; they now have the
  “show sidebar” button like the other pages.

## v1.10.1 — November 2026

### Improved
- **Settings redesigned** in the style of AFFiNE: a larger window with a “Settings” title and your
  profile at the top of the menu, quieter section names, and pages laid out as clean rows separated
  by thin lines instead of boxes. Works in light and dark themes and on phones.

## v1.10.0 — November 2026

### New
- **Record and transcribe meetings** — type `/meeting` in a note (or the microphone button in the
  formatting bar):
  - **In the room** — records with the device’s microphone (computer, tablet or phone).
  - **Online meeting on this computer** — Teams, Zoom, Meet…: share the screen with “Share system
    audio” (or a tab with “Share tab audio”) in Chrome/Edge, and your microphone is recorded too.
  - **Upload a recording** you already have (voice memo, Teams/Zoom recording, any audio/video file).
  - A recording bar stays on screen while you work (pause, stop, throw away). Recordings are kept
    on the device until they’re uploaded — safe if the tab closes or you’re offline.
  - **Transcript with speakers** — who said what (“Speaker 1, Speaker 2…” — click a name to rename
    it), an audio player, and click a time to jump there. Optionally say how many people spoke.
  - **AI summary and to-do list** (if your AI assistant is set up — Gemini’s free tier works),
    added below the transcript; to-dos show up in Tasks. Turn them on/off in Settings → Meetings.
  - Transcribed **free and privately on your server** (Whisper + speaker detection; the admin
    downloads the speech models once in Settings → Server → Meetings), or with your own
    **AssemblyAI** or **Deepgram** key (faster, better at telling voices apart).
  - You get a notification when a transcript is ready. The audio is kept with the note (and in
    backups) until you delete it.
- Settings pages for Meetings use a new, cleaner row layout.

## v1.9.0 — November 2026

### New
- **Text recognition (OCR)** — get the text out of pictures, screenshots, photos of documents or
  whiteboards, and scanned PDFs.
  - Click a picture in a note → **Read text** (printed) or **Handwriting** (uses your AI assistant —
    needs a model that can see pictures). Check or correct the text, then **Copy text** or
    **Insert below**.
  - Type `/text` (or the scan button in the formatting bar / Markdown toolbar) to pick a picture or
    PDF from your device and insert its text. PDFs use their own text where they have it and read
    scanned pages.
  - **Free Draw**: the new **To text** button turns your handwriting (the selection, or the whole
    page) into text — copy it or make a new note from it.
  - **Read text** on files opened from a note or a folder/drive.
  - **Search finds words inside pictures** — Synapse quietly reads the pictures in notes in the
    background; results say “🖼 In a picture: …”. Works on every device, offline too.
  - Printed text is read on your server (nothing is sent anywhere else). When a device can’t reach
    the server it reads the text itself — the reader is downloaded from your server once and kept.
  - English is built in. Admins can add other languages in Settings → Server → **Text recognition**
    (downloaded once; the server needs internet for that) and turn off reading pictures for search.

### Fixed
- **AI “Test” (and AI replies) timing out with Gemini** and some other services: Synapse now stops
  waiting as soon as the reply says it’s complete, instead of waiting for the connection to close.
  A real timeout now says so clearly and suggests a faster model.

## v1.8.0 — November 2026

### New
- **Files: network folders, OneDrive and Google Drive** — browse, open and save files without leaving
  Synapse.
  - **Network folders** — the admin lets Synapse use a folder on the server (for example a NAS share
    mounted there) with `synapse files-add "/path/to/folder" "Name"`, then chooses in
    Settings → Server → **Files** who can use it: everyone and/or chosen people, each *can read* or
    *can read & write*. `synapse files-remove` and `synapse files-list` manage them.
  - **OneDrive and Google Drive** — the admin registers Synapse once with Microsoft / Google (the
    Files page walks through it and shows the address to paste), then **each person connects their
    own account** in Settings → **Connected drives**. Synapse never sees passwords; sign-in tokens are
    stored encrypted on the server.
  - **In notes** — type `/file` (or the paperclip in the formatting bar / Markdown toolbar), pick a
    file and choose **Attach a copy** (kept in Synapse, works if the original moves) or **Link to it**
    (opens the original, always the latest). Files show as a 📎 chip; click to open. Pictures copied
    in go straight into the note.
  - **Save exports there** — Export → **Save to…** puts the PDF / Word / Markdown / web page straight
    into a folder or drive.
  - **Files** in the sidebar to look around, open, download and upload.
- People a note is shared with can now open files attached to it.

### Improved
- The `/` menu lists the best match first (items whose name starts with what you typed).

## v1.7.0 — November 2026

### New
- **Formatting bar in Write mode** — click the new bar button next to *Write / Markdown* to keep a
  formatting bar at the top of the note (like Markdown mode has): undo/redo, Turn into, bold,
  italic, underline, strikethrough, code, highlight, H1–H3, lists, checklist, task list, toggle,
  quote, code block, link, image, table, divider and alignment. Each device remembers the choice.
- **Headings on toggle and task list titles** — titles can now be Heading 1, 2 or 3 (or normal
  text) with the bar's H1–H3 buttons, *Turn into*, or Ctrl+Alt+1/2/3 (Ctrl+Alt+0 for normal). The
  size is kept in Markdown, previews and exports.

## v1.6.0 — November 2026

### New
- **Task list** block — type `/task list`: a collapsible checklist with a name, and a count next to
  the name: “5 of 5 remaining”, then “3 of 5 remaining” as you tick things off, and “✓ All 5 done”.
  Type the name, press Enter, and list the tasks. The count shows while it's collapsed, in exports,
  and on any toggle section that holds a checklist. Also in **Turn into** (first line = the name).

### Fixed
- A toggle section at the very top of a note could get stuck (wouldn't open again, or forgot whether
  it was open).

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
