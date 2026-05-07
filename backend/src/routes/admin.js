import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id,username,email,role,theme,created_at FROM users ORDER BY created_at').all();
  res.json({ users });
});

router.post('/users', async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) return res.status(409).json({ error: 'User already exists' });
  const hash = await bcrypt.hash(password, 12);
  const id = uuid();
  db.prepare('INSERT INTO users (id,username,email,password_hash,role) VALUES (?,?,?,?,?)').run(id, username, email, hash, role);
  const wsId = uuid();
  db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(wsId, id, 'Personal', '🧠', '#6366f1');
  const user = db.prepare('SELECT id,username,email,role,theme FROM users WHERE id=?').get(id);
  res.json({ user });
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  res.json({ ok: true });
});

export default router;
