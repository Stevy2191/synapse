// Sharing API: who a note is shared with (and how), notes shared with me, opening a shared note,
// taking turns editing, and version history.
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  noteAccess, peopleWithAccess, currentLock, takeLock, releaseLock, publicNote, notifyShared,
} from '../shares.js';

const router = Router();
router.use(requireAuth);

const userRow = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE id=?');
const nameOf = id => { const u = userRow.get(id); return u ? (u.display_name || u.username) : 'Someone'; };
const lockInfo = noteId => { const l = currentLock(noteId); return l ? { user_id: l.userId, since: l.since } : null; };

function mustOwn(noteId, userId) {
  const a = noteAccess(noteId, userId);
  if (!a) return [404, 'Note not found'];
  if (a.role !== 'owner') return [403, 'Only the owner can change who a note is shared with'];
  return null;
}

// ───────────────────────── who it's shared with ─────────────────────────

router.get('/note/:noteId', (req, res) => {
  const a = noteAccess(req.params.noteId, req.user.id);
  if (!a) return res.status(404).json({ error: 'Note not found' });
  // Direct shares on this note, plus shares inherited from a note above it
  const direct = db.prepare(`SELECT s.user_id, s.permission, s.include_children, s.created_at, u.username, u.display_name, u.avatar
    FROM note_shares s JOIN users u ON u.id=s.user_id WHERE s.note_id=? ORDER BY s.created_at`).all(a.note.id);
  const inherited = [];
  let parent = a.note.parent_id;
  for (let i = 0; parent && i < 30; i++) {
    const p = db.prepare('SELECT id, title, parent_id FROM notes WHERE id=?').get(parent);
    if (!p) break;
    for (const s of db.prepare(`SELECT s.user_id, s.permission, u.username, u.display_name, u.avatar FROM note_shares s JOIN users u ON u.id=s.user_id
      WHERE s.note_id=? AND s.include_children=1`).all(p.id)) inherited.push({ ...s, from: { id: p.id, title: p.title } });
    parent = p.parent_id;
  }
  const hasChildren = !!db.prepare('SELECT 1 FROM notes WHERE parent_id=? AND deleted_at IS NULL').get(a.note.id);
  res.json({ role: a.role, owner: userRow.get(a.ownerId), shares: direct, inherited, has_children: hasChildren, lock: lockInfo(a.note.id) });
});

router.put('/note/:noteId', (req, res) => {
  const err = mustOwn(req.params.noteId, req.user.id);
  if (err) return res.status(err[0]).json({ error: err[1] });
  const { user_id, permission, include_children } = req.body || {};
  if (!['view', 'edit'].includes(permission)) return res.status(400).json({ error: 'Permission must be view or edit' });
  const target = userRow.get(user_id);
  if (!target || target.id === req.user.id) return res.status(400).json({ error: 'Pick someone to share with' });
  const existed = db.prepare('SELECT 1 FROM note_shares WHERE note_id=? AND user_id=?').get(req.params.noteId, user_id);
  db.prepare(`INSERT INTO note_shares (note_id, user_id, permission, include_children, shared_by) VALUES (?,?,?,?,?)
    ON CONFLICT(note_id, user_id) DO UPDATE SET permission=excluded.permission, include_children=excluded.include_children`)
    .run(req.params.noteId, user_id, permission, include_children === false ? 0 : 1, req.user.id);
  const note = db.prepare('SELECT title FROM notes WHERE id=?').get(req.params.noteId);
  notifyShared(user_id, {
    note_id: req.params.noteId,
    ...(existed ? {} : { title: `${nameOf(req.user.id)} shared a note with you`, body: `“${note.title}” — you can ${permission === 'edit' ? 'view and edit' : 'view'} it` }),
  });
  res.json({ ok: true });
});

router.delete('/note/:noteId/:userId', (req, res) => {
  const self = req.params.userId === req.user.id; // leaving a note shared with me
  if (!self) {
    const err = mustOwn(req.params.noteId, req.user.id);
    if (err) return res.status(err[0]).json({ error: err[1] });
  }
  db.prepare('DELETE FROM note_shares WHERE note_id=? AND user_id=?').run(req.params.noteId, req.params.userId);
  releaseLock(req.params.noteId, req.params.userId);
  notifyShared(req.params.userId, { note_id: req.params.noteId, removed: true });
  res.json({ ok: true });
});

// ───────────────────────── shared with me ─────────────────────────

router.get('/with-me', (req, res) => {
  const rows = db.prepare(`SELECT s.note_id, s.permission, s.include_children, s.created_at, n.title, n.note_type, n.updated_at, n.deleted_at, w.user_id AS owner_id
    FROM note_shares s JOIN notes n ON n.id=s.note_id JOIN workspaces w ON w.id=n.workspace_id
    WHERE s.user_id=? AND n.deleted_at IS NULL ORDER BY n.title COLLATE NOCASE`).all(req.user.id);
  const kids = db.prepare('SELECT id, parent_id, title, note_type, position, updated_at FROM notes WHERE parent_id=? AND deleted_at IS NULL ORDER BY position, created_at');
  const descendants = (id, depth = 0) => (depth > 20 ? [] : kids.all(id).flatMap(c => [c, ...descendants(c.id, depth + 1)]));
  const items = rows.map(r => ({
    id: r.note_id, title: r.title, note_type: r.note_type, permission: r.permission, include_children: !!r.include_children,
    updated_at: r.updated_at, shared_at: r.created_at, owner: userRow.get(r.owner_id),
    children: r.include_children ? descendants(r.note_id) : [],
  }));
  // A note shared on its own that's also inside another shared note: show it once (under its parent).
  const inside = new Set(items.flatMap(i => i.children.map(c => c.id)));
  // Notes I own that I've shared with others (for the "shared" mark in my sidebar)
  const mine = db.prepare(`SELECT DISTINCT s.note_id FROM note_shares s JOIN notes n ON n.id=s.note_id JOIN workspaces w ON w.id=n.workspace_id
    WHERE w.user_id=? AND n.deleted_at IS NULL`).all(req.user.id).map(r => r.note_id);
  res.json({ items: items.filter(i => !inside.has(i.id)), shared_by_me: mine });
});

// ───────────────────────── opening a shared note ─────────────────────────

router.get('/notes/:id', (req, res) => {
  const a = noteAccess(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'This note isn’t shared with you (any more)' });
  res.json({
    note: publicNote(a.note), role: a.role, owner: userRow.get(a.ownerId), lock: lockInfo(a.note.id),
    updated_by: a.note.updated_by ? userRow.get(a.note.updated_by) : null,
    people: peopleWithAccess(a.note.id).map(id => userRow.get(id)).filter(Boolean),
  });
});

// ───────────────────────── editing turns ─────────────────────────

router.post('/notes/:id/lock', (req, res) => {
  const a = noteAccess(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Note not found' });
  if (a.role === 'view') return res.status(403).json({ error: 'You can view this note but not edit it' });
  const r = takeLock(a.note.id, req.user.id, { force: !!req.body?.force });
  const lock = { user_id: r.lock.userId, since: r.lock.since };
  if (!r.ok) return res.status(423).json({ error: `${nameOf(r.lock.userId)} is editing this note right now`, lock });
  res.json({ ok: true, lock, note: publicNote(db.prepare('SELECT * FROM notes WHERE id=?').get(a.note.id)) });
});

router.delete('/notes/:id/lock', (req, res) => {
  releaseLock(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ───────────────────────── history ─────────────────────────

router.get('/notes/:id/versions', (req, res) => {
  const a = noteAccess(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Note not found' });
  const rows = db.prepare(`SELECT id, user_id, title, started_at, created_at, note_version, LENGTH(COALESCE(content,'')) AS size
    FROM note_versions WHERE note_id=? ORDER BY id DESC LIMIT 200`).all(a.note.id);
  res.json({ versions: rows.map(r => ({ ...r, user: r.user_id ? userRow.get(r.user_id) : null })), role: a.role });
});

router.get('/notes/:id/versions/:vid', (req, res) => {
  const a = noteAccess(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Note not found' });
  const v = db.prepare('SELECT * FROM note_versions WHERE id=? AND note_id=?').get(req.params.vid, a.note.id);
  if (!v) return res.status(404).json({ error: 'Version not found' });
  const prev = db.prepare('SELECT id, title, content, created_at, user_id FROM note_versions WHERE note_id=? AND id<? ORDER BY id DESC LIMIT 1').get(a.note.id, v.id);
  res.json({ version: v, previous: prev || null });
});

export default router;
