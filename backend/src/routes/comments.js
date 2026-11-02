// Comments on notes (team features part 2). A thread is anchored to highlighted text (the editor marks
// it with <span data-comment="<thread id>">) or to the whole note (anchor = null). Anyone who can see
// the note can comment; replies, @mentions and resolving notify the people involved (inbox + live).
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { noteAccess, peopleWithAccess } from '../shares.js';
import { sendTo, pushTo, isOnScreen } from '../chat.js';
import { logActivity, addToInbox } from '../activity.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS note_comments (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    anchored INTEGER NOT NULL DEFAULT 0,
    quote TEXT,
    body TEXT NOT NULL,
    author_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    edited_at INTEGER,
    resolved_at INTEGER,
    resolved_by TEXT,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_comments_note ON note_comments(note_id, thread_id, created_at);
`);

const router = Router();
router.use(requireAuth);

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const nameOf = id => db.prepare('SELECT COALESCE(display_name, username) AS n FROM users WHERE id=?').get(id)?.n || 'Someone';
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function threadsOf(noteId) {
  const rows = db.prepare(`SELECT c.*, u.username, u.display_name, u.avatar FROM note_comments c LEFT JOIN users u ON u.id = c.author_id
    WHERE c.note_id=? ORDER BY c.created_at, c.rowid`).all(noteId);
  const threads = new Map();
  for (const r of rows) {
    const c = { id: r.id, body: r.deleted_at ? null : r.body, deleted: !!r.deleted_at, created_at: r.created_at, edited_at: r.edited_at,
      author: { id: r.author_id, username: r.username, display_name: r.display_name, avatar: r.avatar } };
    if (r.id === r.thread_id) {
      threads.set(r.id, { id: r.id, anchored: !!r.anchored, quote: r.quote, resolved_at: r.resolved_at, resolved_by: r.resolved_by ? nameOf(r.resolved_by) : null, comments: [c] });
    } else threads.get(r.thread_id)?.comments.push(c);
  }
  // A thread whose every comment was deleted disappears.
  return [...threads.values()].filter(t => t.comments.some(c => !c.deleted));
}

function changed(note) { sendTo(peopleWithAccess(note.id), 'comment:changed', { note_id: note.id }); }

/** Tell the people in a thread (and anyone @mentioned) about a new comment. */
function notify(note, threadId, comment, byId, isNew) {
  const by = nameOf(byId);
  const told = new Set([byId]);
  const tell = (uid, kind, title) => {
    if (told.has(uid) || !noteAccess(note.id, uid)) return;
    told.add(uid);
    addToInbox({ user_id: uid, kind, note_id: note.id, workspace_id: note.workspace_id, thread_id: threadId, by_user: byId, title, body: short(comment, 200) });
    if (!isOnScreen(uid)) pushTo(uid, { title, body: short(comment, 140), tag: `comment-${threadId}`, url: `/?note=${note.id}&comment=${threadId}` }).catch(() => {});
  };
  for (const m of comment.matchAll(/(^|[\s(])@([a-z0-9][\w.-]{0,39})/gi)) {
    const u = db.prepare('SELECT id FROM users WHERE lower(username)=?').get(m[2].toLowerCase());
    if (u) tell(u.id, 'mention', `${by} mentioned you in a comment on “${note.title}”`);
  }
  if (!isNew) {
    for (const r of db.prepare('SELECT DISTINCT author_id FROM note_comments WHERE thread_id=? AND deleted_at IS NULL').all(threadId)) {
      tell(r.author_id, 'reply', `${by} replied on “${note.title}”`);
    }
  }
}

router.get('/note/:noteId', (req, res) => {
  const a = noteAccess(req.params.noteId, req.user.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json({ threads: threadsOf(a.note.id), can_anchor: a.role !== 'view' });
});

// New thread ({ id?, anchored, quote, body }) or reply ({ thread_id, body }).
router.post('/note/:noteId', (req, res) => {
  const a = noteAccess(req.params.noteId, req.user.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!body) return res.status(400).json({ error: 'Write something first' });
  const note = a.note;
  let threadId = req.body?.thread_id;
  const isNew = !threadId;
  if (isNew) {
    // The editor picks the id, because it's already in the note's text as the highlight.
    threadId = ID.test(String(req.body?.id || '')) ? req.body.id : uuid();
    if (db.prepare('SELECT 1 FROM note_comments WHERE id=?').get(threadId)) return res.status(409).json({ error: 'That comment already exists' });
    const quote = req.body?.anchored ? String(req.body?.quote || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    db.prepare('INSERT INTO note_comments (id, note_id, thread_id, anchored, quote, body, author_id) VALUES (?,?,?,?,?,?,?)')
      .run(threadId, note.id, threadId, req.body?.anchored ? 1 : 0, quote, body, req.user.id);
  } else {
    const root = db.prepare('SELECT * FROM note_comments WHERE id=? AND thread_id=id AND note_id=?').get(String(threadId), note.id);
    if (!root) return res.status(404).json({ error: 'That thread no longer exists' });
    db.prepare('INSERT INTO note_comments (id, note_id, thread_id, body, author_id) VALUES (?,?,?,?,?)').run(uuid(), note.id, root.id, body, req.user.id);
    if (root.resolved_at) db.prepare('UPDATE note_comments SET resolved_at=NULL, resolved_by=NULL WHERE id=?').run(root.id); // a reply reopens it
  }
  logActivity({ workspace_id: note.workspace_id, note_id: note.id, user_id: req.user.id, kind: 'commented', title: note.title, detail: short(body, 200) });
  notify(note, threadId, body, req.user.id, isNew);
  changed(note);
  res.json({ threads: threadsOf(note.id), thread_id: threadId });
});

function ownComment(req, res) {
  const c = db.prepare('SELECT * FROM note_comments WHERE id=?').get(req.params.id);
  const a = c && noteAccess(c.note_id, req.user.id);
  if (!a) { res.status(404).json({ error: 'Not found' }); return null; }
  return { c, a };
}

router.patch('/:id', (req, res) => {
  const r = ownComment(req, res); if (!r) return;
  if (r.c.author_id !== req.user.id) return res.status(403).json({ error: 'You can only change your own comments' });
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!body) return res.status(400).json({ error: 'Write something first' });
  db.prepare('UPDATE note_comments SET body=?, edited_at=unixepoch() WHERE id=?').run(body, r.c.id);
  changed(r.a.note);
  res.json({ threads: threadsOf(r.a.note.id) });
});

router.delete('/:id', (req, res) => {
  const r = ownComment(req, res); if (!r) return;
  if (r.c.author_id !== req.user.id && r.a.role !== 'owner') return res.status(403).json({ error: 'You can only delete your own comments' });
  db.prepare('UPDATE note_comments SET deleted_at=unixepoch() WHERE id=?').run(r.c.id);
  changed(r.a.note);
  res.json({ threads: threadsOf(r.a.note.id) });
});

router.post('/:id/resolve', (req, res) => {
  const r = ownComment(req, res); if (!r) return;
  if (r.c.id !== r.c.thread_id) return res.status(400).json({ error: 'Resolve the whole thread' });
  const resolved = req.body?.resolved !== false;
  db.prepare('UPDATE note_comments SET resolved_at=?, resolved_by=? WHERE id=?').run(resolved ? Math.floor(Date.now() / 1000) : null, resolved ? req.user.id : null, r.c.id);
  if (resolved) {
    logActivity({ workspace_id: r.a.note.workspace_id, note_id: r.a.note.id, user_id: req.user.id, kind: 'resolved', title: r.a.note.title, detail: r.c.quote || short(r.c.body, 120) });
    if (r.c.author_id !== req.user.id) addToInbox({ user_id: r.c.author_id, kind: 'resolved', note_id: r.a.note.id, workspace_id: r.a.note.workspace_id, thread_id: r.c.id, by_user: req.user.id, title: `${nameOf(req.user.id)} resolved your comment on “${r.a.note.title}”`, body: short(r.c.body, 200) });
  }
  changed(r.a.note);
  res.json({ threads: threadsOf(r.a.note.id) });
});

/** How many open threads each of these notes has (for the Comments button). */
router.post('/counts', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(id => typeof id === 'string').slice(0, 200);
  const out = {};
  for (const id of ids) {
    if (!noteAccess(id, req.user.id)) continue;
    out[id] = db.prepare("SELECT COUNT(*) AS n FROM note_comments WHERE note_id=? AND id=thread_id AND resolved_at IS NULL AND deleted_at IS NULL").get(id).n;
  }
  res.json({ counts: out });
});

export default router;
