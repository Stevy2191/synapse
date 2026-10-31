import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db, removeUploadFiles } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const COLOR = /^#[0-9a-fA-F]{6}$/;

function clean(str, max) {
  return typeof str === 'string' ? str.trim().slice(0, max) : '';
}

router.get('/', (req, res) => {
  const workspaces = db.prepare('SELECT * FROM workspaces WHERE user_id=? ORDER BY created_at').all(req.user.id);
  res.json({ workspaces });
});

router.post('/', (req, res) => {
  const name = clean(req.body?.name, 60);
  const icon = clean(req.body?.icon, 16) || '📁';
  const color = COLOR.test(req.body?.color) ? req.body.color : '#6366f1';
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(id, req.user.id, name, icon, color);
  res.json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) });
});

router.patch('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const name = clean(req.body?.name, 60) || ws.name;
  const icon = clean(req.body?.icon, 16) || ws.icon;
  const color = COLOR.test(req.body?.color) ? req.body.color : ws.color;
  db.prepare('UPDATE workspaces SET name=?, icon=?, color=? WHERE id=?').run(name, icon, color, ws.id);
  res.json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws.id) });
});

router.delete('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM workspaces WHERE user_id=?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete last workspace' });
  const files = db.prepare('SELECT a.filename FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.workspace_id=?').all(ws.id).map(r => r.filename);
  db.prepare('DELETE FROM workspaces WHERE id=?').run(ws.id);
  removeUploadFiles(files);
  res.json({ ok: true });
});

export default router;
