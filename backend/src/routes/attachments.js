import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { db, UPLOADS_DIR } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const blocked = ['.exe', '.sh', '.bat', '.cmd', '.php'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('File type not allowed'));
    cb(null, true);
  }
});

router.post('/note/:noteId', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(note.workspace_id, req.user.id);
  if (!ws) return res.status(403).json({ error: 'Forbidden' });

  const id = uuid();
  db.prepare('INSERT INTO attachments (id,note_id,filename,original_name,mime_type,size) VALUES (?,?,?,?,?,?)')
    .run(id, note.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);

  const attachment = db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
  res.json({ attachment });
});

router.get('/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(UPLOADS_DIR, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });

  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${att.original_name}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id', (req, res) => {
  const att = db.prepare('SELECT a.*, n.workspace_id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });

  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(att.workspace_id, req.user.id);
  if (!ws) return res.status(403).json({ error: 'Forbidden' });

  const filePath = path.join(UPLOADS_DIR, att.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM attachments WHERE id=?').run(att.id);
  res.json({ ok: true });
});

export default router;
