// Reminders settings (each person's own): GET/PATCH /api/reminders, POST /api/reminders/test.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { getPrefs, savePrefs, sendTest, datedTasks, localNow, summaryFor } from '../reminders.js';

const router = Router();
router.use(requireAuth);

function view(userId) {
  const prefs = getPrefs(userId);
  const now = localNow(prefs.tz);
  const tasks = datedTasks(userId);
  const today = tasks.filter(t => t.due === now.date);
  return {
    ...prefs,
    devices: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?').get(userId).n,
    today: { due: today.length, overdue: tasks.filter(t => t.due < now.date).length, timed: today.filter(t => t.time && t.time > now.hm).map(t => ({ text: t.text, time: t.time })).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 10) },
    preview: summaryFor(tasks, now.date),
  };
}

router.get('/', (req, res) => res.json(view(req.user.id)));

router.patch('/', (req, res) => {
  try { savePrefs(req.user.id, req.body || {}); res.json(view(req.user.id)); } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/test', async (req, res, next) => {
  try { res.json(await sendTest(req.user.id)); } catch (err) { next(err); }
});

export default router;
