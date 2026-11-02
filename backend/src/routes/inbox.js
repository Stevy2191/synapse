// Inbox (the bell) and the workspace Activity page: /api/team/inbox, /api/team/activity/:wsId.
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { workspaceFor } from '../members.js';
import { unreadCount } from '../activity.js';
import { sendTo } from '../chat.js';

const router = Router();
router.use(requireAuth);

router.get('/inbox', (req, res) => {
  const before = Number(req.query.before) || null;
  const items = db.prepare(`SELECT i.*, COALESCE(u.display_name, u.username) AS by_name, w.name AS workspace_name, n.title AS note_title, n.deleted_at AS note_deleted
    FROM inbox i LEFT JOIN users u ON u.id = i.by_user LEFT JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN notes n ON n.id = i.note_id
    WHERE i.user_id=? ${before ? 'AND i.id < ?' : ''} ORDER BY i.id DESC LIMIT 50`).all(...(before ? [req.user.id, before] : [req.user.id]));
  res.json({ items, unread: unreadCount(req.user.id) });
});

router.get('/inbox/count', (req, res) => res.json({ unread: unreadCount(req.user.id) }));

router.post('/inbox/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger).slice(0, 500) : null;
  if (ids && ids.length) db.prepare(`UPDATE inbox SET read_at=unixepoch() WHERE user_id=? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
  else if (req.body?.all) db.prepare('UPDATE inbox SET read_at=unixepoch() WHERE user_id=? AND read_at IS NULL').run(req.user.id);
  const unread = unreadCount(req.user.id);
  sendTo([req.user.id], 'inbox', { unread });
  res.json({ unread });
});

router.get('/activity/:wsId', (req, res) => {
  if (!workspaceFor(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const before = Number(req.query.before) || null;
  const who = typeof req.query.user === 'string' ? req.query.user : null;
  const params = [req.params.wsId];
  let where = 'a.workspace_id=?';
  if (before) { where += ' AND a.id < ?'; params.push(before); }
  if (who) { where += ' AND a.user_id = ?'; params.push(who); }
  const items = db.prepare(`SELECT a.*, COALESCE(u.display_name, u.username) AS user_name, u.username, n.title AS note_title, n.deleted_at AS note_deleted
    FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN notes n ON n.id = a.note_id
    WHERE ${where} ORDER BY a.id DESC LIMIT 60`).all(...params);
  res.json({ items });
});

export default router;
