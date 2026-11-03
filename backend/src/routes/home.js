// The Home page's per-person layout (which boxes, in what order, pinned notes, open Home at start).
// Stored per person so it follows them to every device. Everything else on Home comes from data the
// app already has (notes, tasks, calendar, inbox).
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS home_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prefs TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const WIDGETS = ['today', 'tasks', 'pinned', 'recent', 'inbox', 'workspaces'];
const ID = /^[0-9a-f-]{36}$/i;

function clean(p = {}) {
  const order = Array.isArray(p.order) ? [...new Set(p.order.filter(w => WIDGETS.includes(w)))] : [];
  for (const w of WIDGETS) if (!order.includes(w)) order.push(w);
  return {
    order,
    hidden: Array.isArray(p.hidden) ? [...new Set(p.hidden.filter(w => WIDGETS.includes(w)))] : [],
    pinned: Array.isArray(p.pinned) ? [...new Set(p.pinned.filter(id => typeof id === 'string' && ID.test(id)))].slice(0, 50) : [],
    start_home: p.start_home !== false,
  };
}
const read = userId => {
  try { return clean(JSON.parse(db.prepare('SELECT prefs FROM home_prefs WHERE user_id=?').get(userId)?.prefs || '{}')); } catch { return clean(); }
};

const router = Router();
router.use(requireAuth);
router.get('/', (req, res) => res.json({ prefs: read(req.user.id) }));
router.put('/', (req, res) => {
  const prefs = clean({ ...read(req.user.id), ...(req.body || {}) });
  db.prepare(`INSERT INTO home_prefs (user_id, prefs, updated_at) VALUES (?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs, updated_at=excluded.updated_at`).run(req.user.id, JSON.stringify(prefs));
  res.json({ prefs });
});
export default router;
