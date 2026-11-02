import { Router } from 'express';
import { db , NETWORK_STORAGE } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { mailView, updateMail, sendMail } from '../mailer.js';
import { createUser, setPassword, deleteUser, adminCount, PUBLIC_USER_FIELDS } from '../users.js';
import { resetMfa, mfaMethods } from '../mfa.js';
import { getSetting, setSetting } from '../settings.js';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const router = Router();
router.use(requireAdmin);

// Email (Settings → Server → Email): the mail account the server sends from.
router.get('/email', (req, res) => res.json(mailView()));
router.patch('/email', (req, res) => {
  try { res.json(updateMail(req.body || {})); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post('/email/test', async (req, res) => {
  const to = String(req.body?.to || db.prepare('SELECT email FROM users WHERE id=?').get(req.user.id)?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter an email address to send the test to' });
  try {
    await sendMail({ to, subject: 'Synapse email works', text: 'This is a test from your Synapse server. Email is set up correctly.',
      html: '<p style="font-family:sans-serif">This is a test from your Synapse server. <b>Email is set up correctly.</b></p>' });
    res.json({ to });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

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

// Server-wide settings
function serverSettings() {
  const key = getSetting('gif_api_key') || '';
  return {
    allow_registration: getSetting('allow_registration') === 'true',
    gif_provider: getSetting('gif_provider') || 'giphy',
    gif_key_set: !!key,
    gif_key_hint: key ? `…${key.slice(-4)}` : '',
  };
}
router.get('/settings', (req, res) => {
  res.json(serverSettings());
});

router.patch('/settings', (req, res) => {
  const body = req.body || {};
  if (body.allow_registration !== undefined) {
    if (typeof body.allow_registration !== 'boolean') return res.status(400).json({ error: 'Invalid value' });
    setSetting('allow_registration', body.allow_registration);
  }
  // GIF search in chat: a GIPHY or Tenor API key (empty string removes it)
  if (body.gif_provider !== undefined) {
    if (!['giphy', 'tenor'].includes(body.gif_provider)) return res.status(400).json({ error: 'Invalid value' });
    setSetting('gif_provider', body.gif_provider);
  }
  if (body.gif_api_key !== undefined) {
    if (typeof body.gif_api_key !== 'string' || body.gif_api_key.length > 200 || /\s/.test(body.gif_api_key.trim())) return res.status(400).json({ error: 'Invalid key' });
    setSetting('gif_api_key', body.gif_api_key.trim());
  }
  res.json(serverSettings());
});

// About this server
function folderSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? folderSize(p) : fs.statSync(p).size;
    }
  } catch {}
  return total;
}
let version = 'unknown';
try { version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version; } catch {}
router.get('/about', (req, res) => {
  const count = t => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  res.json({
    version,
    node: process.version,
    users: count('users'),
    workspaces: count('workspaces'),
    notes: count('notes'),
    attachments: count('attachments'),
    data_bytes: folderSize(DATA_DIR),
    network_storage: NETWORK_STORAGE,
    uptime_seconds: Math.round(process.uptime()),
  });
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
