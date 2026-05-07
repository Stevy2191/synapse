import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const workspaces = db.prepare('SELECT * FROM workspaces WHERE user_id=? ORDER BY created_at').all(req.user.id);
  res.json({ workspaces });
});

router.post('/', (req, res) => {
  const { name, icon = '📁', color = '#6366f1' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(id, req.user.id, name, icon, color);
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  res.json({ workspace: ws });
});

router.patch('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const { name, icon, color } = req.body;
  db.prepare('UPDATE workspaces SET name=COALESCE(?,name), icon=COALESCE(?,icon), color=COALESCE(?,color) WHERE id=?')
    .run(name || null, icon || null, color || null, ws.id);
  const updated = db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws.id);
  res.json({ workspace: updated });
});

router.delete('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const count = db.prepare('SELECT COUNT(*) as c FROM workspaces WHERE user_id=?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete last workspace' });
  db.prepare('DELETE FROM workspaces WHERE id=?').run(ws.id);
  res.json({ ok: true });
});

export default router;
