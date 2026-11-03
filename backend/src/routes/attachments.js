import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { db, UPLOADS_DIR, removeUploadFiles } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { workspaceFor } from '../members.js';
import { noteAccess } from '../shares.js';

const router = Router();
router.use(requireAuth);

// Types the browser may display inline. Everything else (HTML, SVG, scripts...) is
// served as a download so an uploaded file can't run script on this origin.
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'application/pdf', 'text/plain',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg',
]);

// The note's workspace owner, or a member who can edit (shared workspaces, members.js).
function ownedNote(noteId, userId) {
  const n = db.prepare('SELECT id, workspace_id FROM notes WHERE id=?').get(noteId);
  return n && workspaceFor(n.workspace_id, userId, 'edit') ? n : undefined;
}

function ownedAttachment(attId, userId) {
  const a = db.prepare('SELECT a.*, n.workspace_id AS ws FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=?').get(attId);
  if (!a || !workspaceFor(a.ws, userId, 'edit')) return undefined;
  const { ws, ...att } = a;
  return att;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // Keep a short, safe extension only; the original name lives in the DB.
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
      cb(null, uuid() + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50MB
});

// A device may choose the id itself (?id=<uuid>) so a block inserted offline can point at the file
// before it's uploaded (PDF blocks). Re-sending the same id for the same note is a no-op.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ATT_FIELDS = 'id,filename,original_name,mime_type,size,created_at';

router.post('/note/:noteId',
  // Check ownership before accepting the upload, so nothing is written to disk on a 404.
  (req, res, next) => ownedNote(req.params.noteId, req.user.id) ? next() : res.status(404).json({ error: 'Note not found' }),
  (req, res, next) => {
    const want = req.query.id;
    if (want === undefined) return next();
    if (typeof want !== 'string' || !UUID_RE.test(want)) return res.status(400).json({ error: 'Bad id' });
    const had = db.prepare('SELECT note_id FROM attachments WHERE id=?').get(want);
    if (!had) return next();
    if (had.note_id !== req.params.noteId) return res.status(409).json({ error: 'That id is taken' });
    res.json({ attachment: db.prepare(`SELECT ${ATT_FIELDS} FROM attachments WHERE id=?`).get(want) });
  },
  upload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const id = typeof req.query.id === 'string' ? req.query.id : uuid();
    const originalName = req.file.originalname.replace(/[\r\n"\\/]/g, '_').slice(0, 255);
    try {
      db.prepare('INSERT INTO attachments (id,note_id,filename,original_name,mime_type,size) VALUES (?,?,?,?,?,?)')
        .run(id, req.params.noteId, req.file.filename, originalName, req.file.mimetype, req.file.size);
    } catch {
      removeUploadFiles([req.file.filename]); // two uploads raced for the same id
      return res.status(409).json({ error: 'That id is taken' });
    }
    const attachment = db.prepare(`SELECT ${ATT_FIELDS} FROM attachments WHERE id=?`).get(id);
    res.json({ attachment });
  }
);

// Files attached to a note can be opened by anyone the note is shared with, too.
function readableAttachment(attId, userId) {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(attId);
  return att && noteAccess(att.note_id, userId) ? att : null;
}

router.get('/:id', (req, res) => {
  const att = readableAttachment(req.params.id, req.user.id);
  if (!att) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(UPLOADS_DIR, path.basename(att.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  const inline = INLINE_TYPES.has(att.mime_type);
  const encoded = encodeURIComponent(att.original_name);
  res.setHeader('Content-Type', inline ? att.mime_type : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

router.delete('/:id', (req, res) => {
  const att = ownedAttachment(req.params.id, req.user.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM attachments WHERE id=?').run(att.id);
  removeUploadFiles([att.filename]);
  res.json({ ok: true });
});

export default router;
