// Task reminders: a morning summary of what's due today / overdue, and a reminder at the exact time
// for tasks that have one ("📅 2026-11-20 ⏰ 14:30"). Read from the Markdown copy of each person's
// notes (every note has one), in the person's own time zone (reported by their browser).
// Delivered like chat: a push notification when none of their apps is on screen, else a live
// 'reminder' event that the open app shows. Checked every minute.
import { db } from './db/index.js';
import { pushTo, sendTo, isOnScreen, onlineUserIds } from './chat.js';
import { openTasks } from './taskWhen.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS reminder_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    summary INTEGER NOT NULL DEFAULT 1,
    summary_time TEXT NOT NULL DEFAULT '08:00',
    timed INTEGER NOT NULL DEFAULT 1,
    tz TEXT
  );
  CREATE TABLE IF NOT EXISTS reminders_sent (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sent_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DEFAULTS = { summary: 1, summary_time: '08:00', timed: 1, tz: null };

export function getPrefs(userId) {
  const row = db.prepare('SELECT * FROM reminder_prefs WHERE user_id=?').get(userId);
  const p = { ...DEFAULTS, ...(row || {}) };
  return { summary: !!p.summary, summary_time: p.summary_time, timed: !!p.timed, tz: p.tz || null };
}

export function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function savePrefs(userId, body) {
  const cur = getPrefs(userId);
  const next = { ...cur };
  if ('summary' in body) next.summary = !!body.summary;
  if ('timed' in body) next.timed = !!body.timed;
  if ('summary_time' in body) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.summary_time))) throw Object.assign(new Error('Pick a time like 08:00'), { status: 400 });
    next.summary_time = body.summary_time;
  }
  if ('tz' in body) {
    if (typeof body.tz !== 'string' || body.tz.length > 64 || !validTz(body.tz)) throw Object.assign(new Error('Unknown time zone'), { status: 400 });
    next.tz = body.tz;
  }
  db.prepare(`INSERT INTO reminder_prefs (user_id, summary, summary_time, timed, tz) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET summary=excluded.summary, summary_time=excluded.summary_time, timed=excluded.timed, tz=excluded.tz`)
    .run(userId, next.summary ? 1 : 0, next.summary_time, next.timed ? 1 : 0, next.tz);
  return getPrefs(userId);
}

/** { date: 'YYYY-MM-DD', hm: 'HH:MM', min: minutes since midnight } in a time zone. */
export function localNow(tz, now = new Date()) {
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || SERVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: SERVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  const hm = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, hm, min: Number(p.hour) * 60 + Number(p.minute) };
}
const minutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/** A person's open tasks that have a due date: [{ noteId, noteTitle, text, due, time, repeat }]. */
export function datedTasks(userId) {
  const notes = db.prepare(`SELECT n.id, n.title, n.content, n.tags FROM notes n JOIN workspaces w ON w.id = n.workspace_id
    WHERE w.user_id = ? AND n.deleted_at IS NULL AND (n.note_type IS NULL OR n.note_type = 'note') AND n.content LIKE '%📅%'`).all(userId);
  const out = [];
  for (const n of notes) {
    let tags = [];
    try { tags = JSON.parse(n.tags || '[]').map(t => String(t).toLowerCase().replace(/^#/, '')); } catch { /* none */ }
    if (tags.includes('no-tasks')) continue;
    for (const t of openTasks(n.content)) if (t.due) out.push({ noteId: n.id, noteTitle: n.title, ...t });
  }
  return out;
}

function once(key, userId) {
  return db.prepare('INSERT OR IGNORE INTO reminders_sent (key, user_id) VALUES (?, ?)').run(key, userId).changes > 0;
}

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the morning summary says, or null if there's nothing due. */
export function summaryFor(tasks, today) {
  const due = tasks.filter(t => t.due === today);
  const overdue = tasks.filter(t => t.due < today);
  if (!due.length && !overdue.length) return null;
  const parts = [];
  if (due.length) parts.push(`${due.length} due today`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  const list = [...due.sort((a, b) => (a.time || '99').localeCompare(b.time || '99')), ...overdue.sort((a, b) => a.due.localeCompare(b.due))];
  const lines = list.slice(0, 5).map(t => `• ${short(t.text)}${t.time && t.due === today ? ` (${t.time})` : ''}`);
  if (list.length > 5) lines.push(`…and ${list.length - 5} more`);
  return { title: `📋 Today: ${parts.join(', ')}`, body: lines.join('\n'), count: list.length };
}

/** Deliver: live in the open app if it's on screen, otherwise as a push notification. */
async function deliver(userId, note, { force = false } = {}) {
  const onScreen = isOnScreen(userId);
  if (onScreen) sendTo([userId], 'reminder', note);
  if (!onScreen || force) await pushTo(userId, { title: note.title, body: note.body, tag: note.tag, url: note.url });
}

async function checkUser(userId) {
  const prefs = getPrefs(userId);
  if (!prefs.summary && !prefs.timed) return;
  const now = localNow(prefs.tz);
  let tasks = null;
  const load = () => (tasks ??= datedTasks(userId));

  // Morning summary: once a day, at the chosen time (or up to 4 hours later if the server was off).
  const at = minutes(prefs.summary_time);
  if (prefs.summary && now.min >= at && now.min < at + 240 && !db.prepare('SELECT 1 FROM reminders_sent WHERE key=?').get(`sum:${userId}:${now.date}`)) {
    once(`sum:${userId}:${now.date}`, userId);
    const s = summaryFor(load(), now.date);
    if (s) await deliver(userId, { kind: 'summary', title: s.title, body: s.body, tag: 'synapse-summary', url: '/?open=tasks' });
  }

  // Exact times: tasks due today with ⏰, in the last 20 minutes (a missed minute still counts).
  if (prefs.timed) {
    for (const t of load()) {
      if (t.due !== now.date || !t.time) continue;
      const m = minutes(t.time);
      if (m > now.min || m < now.min - 20) continue;
      if (!once(`t:${userId}:${t.noteId}:${t.due}:${t.time}:${t.text.slice(0, 120)}`, userId)) continue;
      await deliver(userId, { kind: 'task', title: `⏰ ${short(t.text, 80)}`, body: `${t.time} · ${t.noteTitle}`, tag: `synapse-task-${t.noteId}-${t.time}`, url: `/?note=${t.noteId}`, noteId: t.noteId });
    }
  }
}

export async function sendTest(userId) {
  const prefs = getPrefs(userId);
  const now = localNow(prefs.tz);
  const s = summaryFor(datedTasks(userId), now.date);
  const subs = db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?').get(userId).n;
  await deliver(userId, {
    kind: 'summary', tag: 'synapse-test', url: '/?open=tasks',
    title: s ? `🔔 Test — ${s.title.replace(/^📋 /, '')}` : '🔔 Test reminder',
    body: s ? s.body : 'Reminders are working. Nothing is due today.',
  }, { force: true });
  return { devices: subs };
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const users = new Set([
      ...db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all().map(r => r.user_id),
      ...onlineUserIds(),
    ]);
    for (const uid of users) {
      try { await checkUser(uid); } catch (err) { console.warn('Reminders:', err.message); }
    }
    db.prepare('DELETE FROM reminders_sent WHERE sent_at < unixepoch() - 14 * 86400').run();
  } finally { running = false; }
}

export function startReminders() {
  setTimeout(tick, 15 * 1000).unref();
  setInterval(tick, 60 * 1000).unref();
}
