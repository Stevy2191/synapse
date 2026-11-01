# Changelog

What's new in each Synapse release. Install or update with `synapse update` (always the newest).
Each release also has its own Docker image, `ghcr.io/stevy2191/synapse:<version>` (e.g. `:v1.1.0`),
so you can go back to a known version if you ever need to.

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
