// Calendars: each person's subscribed calendars and their events.
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { normalizeUrl, syncCalendar } from '../calendars.js';

const router = Router();
router.use(requireAuth);
const limiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 30 });
const COLOR = /^#[0-9a-fA-F]{6}$/;

const owned = (id, userId) => db.prepare('SELECT * FROM calendars WHERE id=? AND user_id=?').get(id, userId);
const shape = c => ({
  id: c.id, name: c.name, url: c.url, color: c.color, enabled: !!c.enabled,
  last_synced_at: c.last_synced_at, last_error: c.last_error,
  events: db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE calendar_id=?').get(c.id).n,
});

router.get('/', (req, res) => {
  res.json({ calendars: db.prepare('SELECT * FROM calendars WHERE user_id=? ORDER BY created_at').all(req.user.id).map(shape) });
});

// Add a calendar. It's only saved if the link can be read.
router.post('/', limiter, async (req, res, next) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const name = (typeof req.body?.name === 'string' && req.body.name.trim().slice(0, 60)) || 'Calendar';
    const color = COLOR.test(req.body?.color) ? req.body.color : '#7c7bff';
    const cal = { id: uuid(), user_id: req.user.id, name, url, color };
    db.prepare('INSERT INTO calendars (id, user_id, name, url, color) VALUES (?,?,?,?,?)').run(cal.id, cal.user_id, name, url, color);
    const result = await syncCalendar(cal);
    if (!result.ok) {
      db.prepare('DELETE FROM calendars WHERE id=?').run(cal.id);
      return res.status(400).json({ error: result.error });
    }
    res.json({ calendar: shape(owned(cal.id, req.user.id)) });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const cal = owned(req.params.id, req.user.id);
    if (!cal) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const name = (typeof b.name === 'string' && b.name.trim().slice(0, 60)) || cal.name;
    const color = COLOR.test(b.color) ? b.color : cal.color;
    const enabled = typeof b.enabled === 'boolean' ? (b.enabled ? 1 : 0) : cal.enabled;
    const url = b.url !== undefined ? normalizeUrl(b.url) : cal.url;
    db.prepare('UPDATE calendars SET name=?, color=?, enabled=?, url=? WHERE id=?').run(name, color, enabled, url, cal.id);
    if (url !== cal.url || (enabled && !cal.enabled)) await syncCalendar({ ...cal, url });
    res.json({ calendar: shape(owned(cal.id, req.user.id)) });
  } catch (err) { next(err); }
});

router.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM calendars WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.post('/:id/refresh', limiter, async (req, res) => {
  const cal = owned(req.params.id, req.user.id);
  if (!cal) return res.status(404).json({ error: 'Not found' });
  const result = await syncCalendar(cal);
  res.status(result.ok ? 200 : 400).json(result.ok ? { calendar: shape(owned(cal.id, req.user.id)) } : { error: result.error });
});

// Events overlapping [from, to) from all enabled calendars. from/to: ISO dates or times.
router.get('/events', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(from) || !/^\d{4}-\d{2}-\d{2}/.test(to)) return res.status(400).json({ error: 'from and to are required' });
  // Times are ISO strings and all-day dates are YYYY-MM-DD, so plain string comparison orders them.
  const events = db.prepare(`
    SELECT e.id, e.uid, e.title, e.start, e.end, e.all_day, e.location, e.description, e.attendees, e.join_url,
           c.id AS calendar_id, c.name AS calendar_name, c.color
    FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id
    WHERE c.user_id=? AND c.enabled=1 AND e.start < ? AND COALESCE(e.end, e.start) >= ?
    ORDER BY e.all_day DESC, e.start
    LIMIT 3000
  `).all(req.user.id, to, from).map(e => ({ ...e, all_day: !!e.all_day, attendees: JSON.parse(e.attendees || '[]') }));
  res.json({ events });
});

export default router;
