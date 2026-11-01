// Publishing notes as links anyone can open (no account needed).
//
// Two kinds of link:
//   • normal — the server shows the note as it is now (always the latest version);
//   • end-to-end encrypted — the note is scrambled in the owner's browser with a key that's only in
//     the link (after the #, which browsers never send to the server). The server stores just the
//     scrambled copy; the owner's app uploads a fresh one whenever they save the note.
// Either kind can have a PIN/password (checked here, with a lockout after wrong tries), an expiry
// date, and "allow downloading".
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { noteAccess } from '../shares.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS note_publications (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('live', 'e2e')),
    pin_hash TEXT,
    expires_at INTEGER,
    allow_download INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    blob TEXT,
    blob_updated_at INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    last_viewed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_publications_note ON note_publications(note_id);
`);

const nowS = () => Math.floor(Date.now() / 1000);
const MAX_BLOB = 20 * 1024 * 1024; // scrambled copy of a note with pictures

function ownerView(p) {
  return {
    id: p.id, note_id: p.note_id, mode: p.mode, has_pin: !!p.pin_hash, expires_at: p.expires_at, allow_download: !!p.allow_download,
    label: p.label || '', views: p.views, last_viewed_at: p.last_viewed_at, created_at: p.created_at,
    blob_updated_at: p.blob_updated_at, expired: !!(p.expires_at && p.expires_at < nowS()),
  };
}

function cleanExpiry(v) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < nowS() - 86400) throw Object.assign(new Error('Pick an expiry date in the future'), { status: 400 });
  return n;
}
function cleanPin(v) {
  const pin = String(v ?? '');
  if (!pin) return null;
  if (pin.length < 4 || pin.length > 100) throw Object.assign(new Error('A PIN or password needs at least 4 characters'), { status: 400 });
  return bcrypt.hashSync(pin, 10);
}

// ───────────────────────── owner: manage links ─────────────────────────

export const ownerRouter = Router();
ownerRouter.use(requireAuth);

function ownedPublication(id, userId) {
  const p = db.prepare('SELECT * FROM note_publications WHERE id=?').get(id);
  if (!p || p.owner_id !== userId) throw Object.assign(new Error('Link not found'), { status: 404 });
  return p;
}

ownerRouter.get('/note/:noteId', (req, res) => {
  const a = noteAccess(req.params.noteId, req.user.id);
  if (!a || a.role !== 'owner') return res.status(404).json({ error: 'Note not found' });
  const rows = db.prepare('SELECT * FROM note_publications WHERE note_id=? ORDER BY created_at').all(req.params.noteId);
  res.json({ links: rows.map(ownerView) });
});

ownerRouter.post('/note/:noteId', (req, res, next) => {
  try {
    const a = noteAccess(req.params.noteId, req.user.id);
    if (!a || a.role !== 'owner') return res.status(404).json({ error: 'Only the owner can publish a note' });
    const b = req.body || {};
    const mode = b.mode === 'e2e' ? 'e2e' : 'live';
    const id = crypto.randomBytes(16).toString('base64url'); // 128-bit, not guessable
    db.prepare(`INSERT INTO note_publications (id, note_id, owner_id, mode, pin_hash, expires_at, allow_download, label) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, req.params.noteId, req.user.id, mode, cleanPin(b.pin), cleanExpiry(b.expires_at), b.allow_download ? 1 : 0, String(b.label || '').slice(0, 80) || null);
    res.json({ link: ownerView(db.prepare('SELECT * FROM note_publications WHERE id=?').get(id)) });
  } catch (err) { next(err); }
});

ownerRouter.patch('/:id', (req, res, next) => {
  try {
    const p = ownedPublication(req.params.id, req.user.id);
    const b = req.body || {};
    const pin = b.pin !== undefined ? cleanPin(b.pin) : p.pin_hash;
    const exp = b.expires_at !== undefined ? cleanExpiry(b.expires_at) : p.expires_at;
    const dl = b.allow_download !== undefined ? (b.allow_download ? 1 : 0) : p.allow_download;
    const label = b.label !== undefined ? (String(b.label || '').slice(0, 80) || null) : p.label;
    db.prepare('UPDATE note_publications SET pin_hash=?, expires_at=?, allow_download=?, label=? WHERE id=?').run(pin, exp, dl, label, p.id);
    res.json({ link: ownerView(db.prepare('SELECT * FROM note_publications WHERE id=?').get(p.id)) });
  } catch (err) { next(err); }
});

ownerRouter.delete('/:id', (req, res, next) => {
  try {
    const p = ownedPublication(req.params.id, req.user.id);
    db.prepare('DELETE FROM note_publications WHERE id=?').run(p.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// The scrambled copy for an end-to-end encrypted link (made in the owner's browser).
ownerRouter.put('/:id/blob', (req, res, next) => {
  try {
    const p = ownedPublication(req.params.id, req.user.id);
    if (p.mode !== 'e2e') return res.status(400).json({ error: 'Not an encrypted link' });
    const blob = req.body?.blob;
    if (!blob || typeof blob.iv !== 'string' || typeof blob.data !== 'string' || blob.data.length > MAX_BLOB) return res.status(400).json({ error: 'Invalid data' });
    db.prepare('UPDATE note_publications SET blob=?, blob_updated_at=unixepoch() WHERE id=?').run(JSON.stringify({ v: 1, iv: blob.iv, data: blob.data }), p.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ───────────────────────── public: open a link ─────────────────────────

export const publicRouter = Router();

// Wrong PIN tries per link + address: 8 per 15 minutes, then a pause.
const attempts = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of attempts) if (v.reset < t) attempts.delete(k); }, 60_000).unref();

function findLink(id) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return null;
  const p = db.prepare('SELECT * FROM note_publications WHERE id=?').get(id);
  if (!p) return null;
  const note = db.prepare('SELECT * FROM notes WHERE id=? AND deleted_at IS NULL').get(p.note_id);
  return note ? { p, note } : null;
}

const GONE = 'This link doesn’t work any more — it may have been unpublished.';

// What the page needs before showing anything (no note content).
publicRouter.get('/:id', (req, res) => {
  const found = findLink(req.params.id);
  if (!found) return res.status(404).json({ error: GONE });
  const { p } = found;
  if (p.expires_at && p.expires_at < nowS()) return res.status(410).json({ error: 'This link has expired.' });
  res.json({ mode: p.mode, needs_pin: !!p.pin_hash, allow_download: !!p.allow_download, expires_at: p.expires_at });
});

publicRouter.post('/:id/open', (req, res) => {
  const found = findLink(req.params.id);
  if (!found) return res.status(404).json({ error: GONE });
  const { p, note } = found;
  if (p.expires_at && p.expires_at < nowS()) return res.status(410).json({ error: 'This link has expired.' });
  if (p.pin_hash) {
    const key = `${p.id}|${req.ip}`;
    const a = attempts.get(key) || { n: 0, reset: Date.now() + 15 * 60_000 };
    if (a.n >= 8) return res.status(429).json({ error: 'Too many wrong tries — wait 15 minutes and try again.' });
    if (!bcrypt.compareSync(String(req.body?.pin ?? ''), p.pin_hash)) {
      a.n++; attempts.set(key, a);
      return res.status(401).json({ error: req.body?.pin ? 'That PIN or password isn’t right.' : 'Enter the PIN or password.', needs_pin: true });
    }
    attempts.delete(key);
  }
  db.prepare('UPDATE note_publications SET views=views+1, last_viewed_at=unixepoch() WHERE id=?').run(p.id);
  res.setHeader('Cache-Control', 'no-store');
  if (p.mode === 'e2e') {
    if (!p.blob) return res.status(404).json({ error: 'This page isn’t ready yet — ask the person who shared it to open the note once.' });
    return res.json({ mode: 'e2e', blob: JSON.parse(p.blob), allow_download: !!p.allow_download });
  }
  // Normal link: the note as it is now, plus any drawings it embeds (![[Drawing]]).
  const embedded = [...`${note.content || ''}${note.rich_content || ''}`.matchAll(/!\[\[([^\[\]\n]+)\]\]|data-drawing="([^"]+)"/g)].map(m => (m[1] || m[2]).trim());
  const drawings = embedded.length
    ? db.prepare(`SELECT id, title, note_type, canvas_data FROM notes WHERE workspace_id=? AND note_type='draw' AND deleted_at IS NULL`).all(note.workspace_id)
      .filter(d => embedded.some(t => t.toLowerCase() === d.title.toLowerCase()))
    : [];
  res.json({
    mode: 'live',
    allow_download: !!p.allow_download,
    note: {
      id: note.id, title: note.title, content: note.content, rich_content: note.rich_content, editor_mode: note.editor_mode,
      note_type: note.note_type, canvas_data: note.canvas_data, tags: note.tags, updated_at: note.updated_at, position: 0, parent_id: null,
    },
    drawings,
  });
});
