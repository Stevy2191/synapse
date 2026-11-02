// Sharing notes with other people on this server, with a permission each ("view" or "edit"),
// optionally including every note inside the shared one. Plus:
//   • the editing turn ("lock") — one person edits a shared note at a time; others watch live,
//   • version history — who changed what and when, for every note.
import { workspaceRole, workspacePeopleIds } from './members.js';
import { logActivity } from './activity.js';
import { db } from './db/index.js';
import { sendTo, pushTo } from './chat.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS note_shares (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
    include_children INTEGER NOT NULL DEFAULT 1,
    shared_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (note_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_note_shares_user ON note_shares(user_id);

  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT,
    title TEXT,
    content TEXT,
    rich_content TEXT,
    canvas_data TEXT,
    editor_mode TEXT,
    note_version INTEGER,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, id);
`);
try { db.exec('ALTER TABLE notes ADD COLUMN updated_by TEXT'); } catch { /* already there */ }

const MAX_DEPTH = 30;
const ownerOf = db.prepare('SELECT w.user_id FROM notes n JOIN workspaces w ON w.id=n.workspace_id WHERE n.id=?');
const noteRow = db.prepare('SELECT * FROM notes WHERE id=?');
const shareRow = db.prepare('SELECT * FROM note_shares WHERE note_id=? AND user_id=?');

/** The note and its ancestors, nearest first. */
function chain(noteId) {
  const out = [];
  let id = noteId;
  for (let i = 0; id && i < MAX_DEPTH; i++) {
    const n = db.prepare('SELECT id, parent_id FROM notes WHERE id=?').get(id);
    if (!n) break;
    out.push(n);
    id = n.parent_id;
  }
  return out;
}

/**
 * What `userId` may do with a note: { note, role: 'owner'|'edit'|'view', ownerId, via } or null.
 * A share on a note covers the notes inside it when include_children is on.
 */
export function noteAccess(noteId, userId) {
  const note = noteRow.get(noteId);
  if (!note || note.deleted_at) return null;
  const ownerId = ownerOf.get(noteId)?.user_id;
  if (ownerId === userId) return { note, role: 'owner', ownerId, via: null };
  // A member of a shared workspace: 'member' tells callers it comes from the workspace (members.js).
  const wsRole = workspaceRole(note.workspace_id, userId);
  if (wsRole === 'edit' || wsRole === 'view') return { note, role: wsRole, ownerId, via: null, member: true };
  let role = null, via = null;
  chain(noteId).forEach((n, i) => {
    const s = shareRow.get(n.id, userId);
    if (!s || (i > 0 && !s.include_children)) return;
    if (!role || (s.permission === 'edit' && role === 'view')) { role = s.permission; via = n.id; }
  });
  return role ? { note, role, ownerId, via } : null;
}

/** Everyone who can see a note (owner first), for live updates. */
export function peopleWithAccess(noteId) {
  const ownerId = ownerOf.get(noteId)?.user_id;
  const ids = new Set(ownerId ? [ownerId] : []);
  const n0 = noteRow.get(noteId);
  if (n0) for (const id of workspacePeopleIds(n0.workspace_id)) ids.add(id);
  chain(noteId).forEach((n, i) => {
    for (const s of db.prepare('SELECT user_id, include_children FROM note_shares WHERE note_id=?').all(n.id)) {
      if (i === 0 || s.include_children) ids.add(s.user_id);
    }
  });
  return [...ids];
}

export function isShared(noteId) {
  return peopleWithAccess(noteId).length > 1;
}

// ───────────────────────── editing turn ─────────────────────────
// In memory: who is editing which shared note. A turn ends when they leave, or after a minute
// without activity (so nobody can be locked out by a closed laptop).

const LOCK_IDLE_MS = 60_000;
const locks = new Map(); // noteId → { userId, since, at }

export function currentLock(noteId) {
  const l = locks.get(noteId);
  if (!l) return null;
  if (Date.now() - l.at > LOCK_IDLE_MS) { locks.delete(noteId); announceLock(noteId); return null; }
  return l;
}

function announceLock(noteId) {
  const l = locks.get(noteId);
  sendTo(peopleWithAccess(noteId), 'note:lock', { note_id: noteId, user_id: l?.userId || null, since: l?.since || null });
}

/** Take (or refresh) the editing turn. Returns { ok, lock }. */
export function takeLock(noteId, userId, { force = false } = {}) {
  const l = currentLock(noteId);
  if (l && l.userId !== userId && !force) return { ok: false, lock: l };
  const fresh = !l || l.userId !== userId;
  locks.set(noteId, { userId, since: fresh ? Date.now() : l.since, at: Date.now() });
  if (fresh) announceLock(noteId);
  return { ok: true, lock: locks.get(noteId) };
}

export function releaseLock(noteId, userId) {
  const l = locks.get(noteId);
  if (l && l.userId === userId) { locks.delete(noteId); announceLock(noteId); }
}

// Let others know when a turn runs out.
setInterval(() => { for (const id of [...locks.keys()]) currentLock(id); }, 15_000).unref();

// ───────────────────────── history ─────────────────────────
// One entry per editing session: a person's saves within 10 minutes of each other are one entry.

const SESSION_S = 10 * 60;
const KEEP_VERSIONS = 200;

export function recordVersion(note, userId) {
  const last = db.prepare('SELECT * FROM note_versions WHERE note_id=? ORDER BY id DESC LIMIT 1').get(note.id);
  const nowS = Math.floor(Date.now() / 1000);
  if (last && last.user_id === userId && nowS - last.created_at < SESSION_S) {
    db.prepare(`UPDATE note_versions SET title=?, content=?, rich_content=?, canvas_data=?, editor_mode=?, note_version=?, created_at=? WHERE id=?`)
      .run(note.title, note.content, note.rich_content, note.canvas_data, note.editor_mode, note.version, nowS, last.id);
  } else {
    db.prepare(`INSERT INTO note_versions (note_id, user_id, title, content, rich_content, canvas_data, editor_mode, note_version, started_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(note.id, userId, note.title, note.content, note.rich_content, note.canvas_data, note.editor_mode, note.version, nowS, nowS);
    db.prepare(`DELETE FROM note_versions WHERE note_id=? AND id NOT IN (SELECT id FROM note_versions WHERE note_id=? ORDER BY id DESC LIMIT ?)`)
      .run(note.id, note.id, KEEP_VERSIONS);
  }
}

/** Called after any change to a note's content: history, "last edited by", live updates. */
export function afterNoteSaved(note, userId) {
  db.prepare('UPDATE notes SET updated_by=? WHERE id=?').run(userId, note.id);
  logActivity({ workspace_id: note.workspace_id, note_id: note.id, user_id: userId, kind: 'edited', title: note.title });
  note.updated_by = userId;
  recordVersion(note, userId);
  const people = peopleWithAccess(note.id);
  if (people.length > 1) {
    // Keep the editing turn alive while they save
    const l = locks.get(note.id);
    if (l && l.userId === userId) l.at = Date.now();
    sendTo(people, 'note:update', { note: publicNote(note), updated_by: userId });
  }
}

export function publicNote(n) {
  return {
    id: n.id, workspace_id: n.workspace_id, parent_id: n.parent_id, title: n.title, content: n.content, rich_content: n.rich_content,
    canvas_data: n.canvas_data, editor_mode: n.editor_mode, note_type: n.note_type, tags: n.tags, version: n.version,
    position: n.position, created_at: n.created_at, updated_at: n.updated_at, updated_by: n.updated_by || null,
  };
}

export function notifyShared(userId, payload) {
  sendTo([userId], 'share:changed', payload);
  if (payload.title) pushTo(userId, { title: payload.title, body: payload.body || '', url: '/', tag: `share-${payload.note_id}` }).catch(() => {});
}
