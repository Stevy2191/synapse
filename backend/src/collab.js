// Live editing together (Google Docs-style) for Write-mode notes in shared workspaces.
//
// Each open note is a Yjs document kept here and saved in note_ydocs; browsers connect over a
// WebSocket at /api/collab?note=<id>&ticket=<one-time pass> and speak the standard y-protocols sync + awareness
// messages (who's here, where their cursor is), plus small JSON "control" messages:
//   server → client  hello {gen, role}   seed (fill the empty document from the note's saved HTML)
//                    external {html}     the note was changed outside the editor (Tasks page, board…):
//                                        apply it in your editor so it becomes part of the shared doc
//                    reset {gen}         the shared doc was thrown away — forget your copy, reconnect
//   client → server  html {html, md}     the current text, saved as the note's rich_content / content
// Devices keep their own copy (IndexedDB) so edits made offline merge in when they reconnect. `gen`
// (generation) changes when the server throws its copy away, so devices know to drop theirs.
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { db } from './db/index.js';
import { noteAccess } from './shares.js';
import { isShared } from './members.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS note_ydocs (
    note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
    gen INTEGER NOT NULL DEFAULT 1,
    state BLOB,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const MSG_SYNC = 0, MSG_AWARENESS = 1, MSG_CONTROL = 3;

// One-time passes for opening the WebSocket, so the sign-in token never goes in a URL (proxies log
// URLs). The app asks for one with its normal sign-in (POST /api/collab/ticket); it works once, for 60 s.
const tickets = new Map(); // ticket → { userId, tv, noteId, at }
setInterval(() => { const t = Date.now(); for (const [k, v] of tickets) if (t - v.at > 60_000) tickets.delete(k); }, 30_000).unref();
export function issueTicket(user, tv, noteId) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, { userId: user.id, tv, noteId, at: Date.now() });
  return ticket;
}
function useTicket(ticket, noteId) {
  const t = tickets.get(String(ticket || ''));
  if (!t) return null;
  tickets.delete(ticket);
  if (Date.now() - t.at > 60_000 || t.noteId !== noteId) return null;
  return t;
}
const userRow = db.prepare('SELECT id, username, role, token_version, display_name FROM users WHERE id=?');
/** Still signed in? (not deleted, and not "signed out everywhere" / password changed since) */
function stillValid(userId, tv) {
  const u = userRow.get(userId);
  return u && (u.token_version ?? 0) === tv ? u : null;
}
const docs = new Map(); // noteId → { ydoc, awareness, conns: Map(ws → { user, role, synced, ids:Set }), gen, seeder, saveTimer }
let saveContent = null; // set by routes/notes.js: (noteId, userId, { rich_content, content }) => void

export function setContentSaver(fn) { saveContent = fn; }

/** Notes edited live: Write-mode notes in a workspace with members. */
export function isCollabNote(note) {
  return !!note && note.editor_mode === 'rich' && (!note.note_type || note.note_type === 'note') && isShared(note.workspace_id);
}

const genOf = noteId => db.prepare('SELECT gen FROM note_ydocs WHERE note_id=?').get(noteId)?.gen || 1;

function loadDoc(noteId) {
  let d = docs.get(noteId);
  if (d) { clearTimeout(d.unloadTimer); return d; }
  const ydoc = new Y.Doc({ gc: true });
  const row = db.prepare('SELECT gen, state FROM note_ydocs WHERE note_id=?').get(noteId);
  if (row?.state) { try { Y.applyUpdate(ydoc, new Uint8Array(row.state)); } catch (err) { console.warn('Collab: bad saved state for', noteId, err.message); } }
  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.setLocalState(null); // the server itself isn't a participant
  d = { noteId, ydoc, awareness, conns: new Map(), gen: row?.gen || 1, seeder: null, saveTimer: null, unloadTimer: null };
  ydoc.on('update', (update, origin) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    for (const ws of d.conns.keys()) if (ws !== origin) send(ws, msg);
    if (d.seeder && origin === d.seeder) d.seeder = null; // seeded
    schedulePersist(d);
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    const c = d.conns.get(origin);
    if (c) { added.forEach(id => c.ids.add(id)); removed.forEach(id => c.ids.delete(id)); }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    for (const ws of d.conns.keys()) send(ws, msg);
  });
  docs.set(noteId, d);
  return d;
}

function schedulePersist(d) {
  clearTimeout(d.saveTimer);
  d.saveTimer = setTimeout(() => persist(d), 1500);
}
function persist(d) {
  clearTimeout(d.saveTimer);
  d.saveTimer = null;
  if (!db.prepare('SELECT 1 FROM notes WHERE id=?').get(d.noteId)) return;
  const state = Buffer.from(Y.encodeStateAsUpdate(d.ydoc));
  db.prepare(`INSERT INTO note_ydocs (note_id, gen, state, updated_at) VALUES (?,?,?,unixepoch())
    ON CONFLICT(note_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at`).run(d.noteId, d.gen, state);
}

function send(ws, msg) {
  if (ws.readyState !== 1) return;
  try { ws.send(msg); } catch { /* closed */ }
}
function control(ws, obj) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_CONTROL);
  encoding.writeVarString(enc, JSON.stringify(obj));
  send(ws, encoding.toUint8Array(enc));
}
const fragmentEmpty = d => d.ydoc.getXmlFragment('default').length === 0;

function maybeSeed(d, ws) {
  const c = d.conns.get(ws);
  if (!c || c.role !== 'edit' || !fragmentEmpty(d)) return;
  if (d.seeder && d.conns.has(d.seeder)) return;
  d.seeder = ws;
  control(ws, { type: 'seed' });
}

function onMessage(d, ws, data) {
  const c = d.conns.get(ws);
  if (!c) return;
  let decoder;
  try { decoder = decoding.createDecoder(new Uint8Array(data)); } catch { return; }
  const type = decoding.readVarUint(decoder);
  if (type === MSG_SYNC) {
    const sub = decoding.readVarUint(decoder);
    if (sub === syncProtocol.messageYjsSyncStep1) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep2(enc, d.ydoc, decoding.readVarUint8Array(decoder));
      send(ws, encoding.toUint8Array(enc));
      return;
    }
    // Step 2 / updates: only people who can edit change the document.
    const update = decoding.readVarUint8Array(decoder);
    if (c.role === 'edit') { try { Y.applyUpdate(d.ydoc, update, ws); } catch (err) { console.warn('Collab: bad update', err.message); } }
    if (sub === syncProtocol.messageYjsSyncStep2 && !c.synced) { c.synced = true; maybeSeed(d, ws); }
  } else if (type === MSG_AWARENESS) {
    try { awarenessProtocol.applyAwarenessUpdate(d.awareness, decoding.readVarUint8Array(decoder), ws); } catch { /* ignore */ }
  } else if (type === MSG_CONTROL) {
    let msg;
    try { msg = JSON.parse(decoding.readVarString(decoder)); } catch { return; }
    if (msg.type === 'html' && c.role === 'edit' && typeof msg.html === 'string' && msg.html.length < 20_000_000 && saveContent) {
      try { saveContent(d.noteId, c.user.id, { rich_content: msg.html, content: typeof msg.md === 'string' ? msg.md : '' }); } catch (err) { console.warn('Collab: save failed', err.message); }
    }
  }
}

function onClose(d, ws) {
  const c = d.conns.get(ws);
  d.conns.delete(ws);
  if (c?.ids.size) awarenessProtocol.removeAwarenessStates(d.awareness, [...c.ids], null);
  if (d.seeder === ws) { d.seeder = null; for (const other of d.conns.keys()) { maybeSeed(d, other); if (d.seeder) break; } }
  if (!d.conns.size) {
    persist(d);
    d.unloadTimer = setTimeout(() => { if (!d.conns.size) { docs.delete(d.noteId); d.ydoc.destroy(); } }, 30_000);
  }
}

/**
 * The note's HTML was changed outside the editor. If someone has it open, their editor folds the
 * change into the shared document; otherwise the shared document is dropped and rebuilt from the
 * saved HTML the next time someone opens it.
 */
export function externalChange(noteId, html) {
  const d = docs.get(noteId);
  const editor = d && [...d.conns.entries()].find(([, c]) => c.role === 'edit' && c.synced)?.[0];
  if (editor) { control(editor, { type: 'external', html }); return; }
  resetDoc(noteId);
}

/** Throw the shared document away (new generation); open editors reload. */
export function resetDoc(noteId) {
  const gen = genOf(noteId) + 1;
  db.prepare(`INSERT INTO note_ydocs (note_id, gen, state) VALUES (?,?,NULL)
    ON CONFLICT(note_id) DO UPDATE SET gen=excluded.gen, state=NULL, updated_at=unixepoch()`).run(noteId, gen);
  const d = docs.get(noteId);
  if (d) {
    clearTimeout(d.saveTimer);
    for (const ws of d.conns.keys()) { control(ws, { type: 'reset', gen }); try { ws.close(4000, 'reset'); } catch { /* ignore */ } }
    docs.delete(noteId);
    d.ydoc.destroy();
  }
}

/**
 * Check everyone connected still may be here: signed in (not signed out everywhere / deleted) and
 * still allowed to see the note (not removed from the workspace), with their current role.
 * Runs every minute, and straight away when workspace membership changes.
 */
export function recheckCollab() {
  for (const d of docs.values()) {
    for (const [ws, c] of d.conns) {
      const user = stillValid(c.user.id, c.tv);
      const access = user && noteAccess(d.noteId, user.id);
      if (!access || !isCollabNote(access.note)) { try { ws.close(4003, 'access'); } catch { /* ignore */ } continue; }
      c.role = access.role === 'view' ? 'view' : 'edit';
    }
  }
}

export function attachCollab(server) {
  setInterval(recheckCollab, 60_000).unref();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/api/collab') return; // not ours (nothing else uses WebSockets)
    const noteId = url.searchParams.get('note') || '';
    const t = useTicket(url.searchParams.get('ticket'), noteId);
    const user = t && stillValid(t.userId, t.tv);
    const access = user && noteAccess(noteId, user.id);
    if (!access || !isCollabNote(access.note)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const d = loadDoc(noteId);
      const role = access.role === 'view' ? 'view' : 'edit';
      d.conns.set(ws, { user, role, synced: false, ids: new Set(), tv: t.tv });
      ws.binaryType = 'arraybuffer';
      ws.on('message', data => onMessage(d, ws, data));
      ws.on('close', () => onClose(d, ws));
      ws.on('error', () => {});
      // Keep proxies from closing quiet connections.
      const ping = setInterval(() => { if (ws.readyState === 1) ws.ping(); else clearInterval(ping); }, 25_000);
      ws.on('close', () => clearInterval(ping));
      control(ws, { type: 'hello', gen: d.gen, role });
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, d.ydoc);
      send(ws, encoding.toUint8Array(enc));
      const states = d.awareness.getStates();
      if (states.size) {
        const a = encoding.createEncoder();
        encoding.writeVarUint(a, MSG_AWARENESS);
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(d.awareness, [...states.keys()]));
        send(ws, encoding.toUint8Array(a));
      }
    });
  });
  // Save everything on shutdown.
  process.prependListener('SIGTERM', () => { for (const d of docs.values()) { try { persist(d); } catch { /* ignore */ } } });
}
