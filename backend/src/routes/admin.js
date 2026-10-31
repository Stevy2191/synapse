import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { createUser, setPassword, deleteUser, adminCount, PUBLIC_USER_FIELDS } from '../users.js';
import { resetMfa, mfaMethods } from '../mfa.js';

const router = Router();
router.use(requireAdmin);

const ROLES = ['admin', 'user'];

function findUser(id) {
  return db.prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id=?`).get(id);
}

router.get('/users', (req, res) => {
  const users = db.prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users ORDER BY created_at`).all()
    .map(u => ({ ...u, mfa: mfaMethods(u.id).filter(m => m !== 'recovery') }));
  res.json({ users });
});

// Turn off someone's two-step verification (lost phone, etc.). Signs them out everywhere.
router.post('/users/:id/reset-mfa', (req, res) => {
  if (!findUser(req.params.id)) return res.status(404).json({ error: 'User not found' });
  resetMfa(req.params.id);
  res.json({ ok: true });
});

router.post('/users', async (req, res, next) => {
  try {
    const role = req.body?.role ?? 'user';
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const created = await createUser(req.body || {}, () => role);
    res.json({ user: findUser(created.id) });
  } catch (err) { next(err); }
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (!findUser(req.params.id)) return res.status(404).json({ error: 'User not found' });
  deleteUser(req.params.id);
  res.json({ ok: true });
});

router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const target = findUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
    return res.status(400).json({ error: 'There must be at least one admin' });
  }
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
  res.json({ user: findUser(target.id) });
});

// Reset another user's password (e.g. they forgot it). Signs them out everywhere.
router.patch('/users/:id/password', async (req, res, next) => {
  try {
    if (!findUser(req.params.id)) return res.status(404).json({ error: 'User not found' });
    await setPassword(req.params.id, req.body?.password);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
