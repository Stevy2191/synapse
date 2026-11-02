// Task reminders: a morning summary of what's due today / overdue, and a reminder at the exact time
// for tasks that have one ("📅 2026-11-20 ⏰ 14:30"). Read from the Markdown copy of each person's
// notes (every note has one), in the person's own time zone (reported by their browser).
// Delivered like chat: a push notification when none of their apps is on screen, else a live
// 'reminder' event that the open app shows. Checked every minute.
import { db } from './db/index.js';
import { pushTo, sendTo, isOnScreen, onlineUserIds } from './chat.js';
import { openTasks, priRank } from './taskWhen.js';
import { sendMail, mailConfigured, appUrl } from './mailer.js';

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

// Daily email (meetings + to-dos), added later: its own on/off and time.
const cols = db.prepare('PRAGMA table_info(reminder_prefs)').all().map(c => c.name);
if (!cols.includes('email_daily')) db.exec("ALTER TABLE reminder_prefs ADD COLUMN email_daily INTEGER NOT NULL DEFAULT 0");
if (!cols.includes('email_time')) db.exec("ALTER TABLE reminder_prefs ADD COLUMN email_time TEXT NOT NULL DEFAULT '07:00'");
if (!cols.includes('email_skip_empty')) db.exec("ALTER TABLE reminder_prefs ADD COLUMN email_skip_empty INTEGER NOT NULL DEFAULT 0");

const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DEFAULTS = { summary: 1, summary_time: '08:00', timed: 1, tz: null, email_daily: 0, email_time: '07:00', email_skip_empty: 0 };

export function getPrefs(userId) {
  const row = db.prepare('SELECT * FROM reminder_prefs WHERE user_id=?').get(userId);
  const p = { ...DEFAULTS, ...(row || {}) };
  return {
    summary: !!p.summary, summary_time: p.summary_time, timed: !!p.timed, tz: p.tz || null,
    email_daily: !!p.email_daily, email_time: p.email_time, email_skip_empty: !!p.email_skip_empty,
  };
}

export function validTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

export function savePrefs(userId, body) {
  const cur = getPrefs(userId);
  const next = { ...cur };
  for (const k of ['summary', 'timed', 'email_daily', 'email_skip_empty']) if (k in body) next[k] = !!body[k];
  for (const k of ['summary_time', 'email_time']) {
    if (!(k in body)) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body[k]))) throw Object.assign(new Error('Pick a time like 08:00'), { status: 400 });
    next[k] = body[k];
  }
  if ('tz' in body) {
    if (typeof body.tz !== 'string' || body.tz.length > 64 || !validTz(body.tz)) throw Object.assign(new Error('Unknown time zone'), { status: 400 });
    next.tz = body.tz;
  }
  db.prepare(`INSERT INTO reminder_prefs (user_id, summary, summary_time, timed, tz, email_daily, email_time, email_skip_empty) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET summary=excluded.summary, summary_time=excluded.summary_time, timed=excluded.timed, tz=excluded.tz,
      email_daily=excluded.email_daily, email_time=excluded.email_time, email_skip_empty=excluded.email_skip_empty`)
    .run(userId, next.summary ? 1 : 0, next.summary_time, next.timed ? 1 : 0, next.tz, next.email_daily ? 1 : 0, next.email_time, next.email_skip_empty ? 1 : 0);
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
  const byPri = (a, b) => priRank(a.priority) - priRank(b.priority);
  const list = [...due.sort((a, b) => byPri(a, b) || (a.time || '99').localeCompare(b.time || '99')), ...overdue.sort((a, b) => byPri(a, b) || a.due.localeCompare(b.due))];
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

// ───────────────────────── daily email ─────────────────────────

/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffset(tz, at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
}
/** The UTC instant of local midnight starting `date` (YYYY-MM-DD) in `tz`. */
function localMidnight(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffset(tz, new Date(guess));
  t = guess - tzOffset(tz, new Date(t)); // once more, for days when the clocks change
  return new Date(t);
}
const nextDay = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };

/** A person's calendar events on `date` in their time zone, in order. */
export function eventsOn(userId, date, tz) {
  const zone = tz && validTz(tz) ? tz : SERVER_TZ;
  const from = localMidnight(date, zone).toISOString();
  const to = localMidnight(nextDay(date), zone).toISOString();
  const rows = db.prepare(`SELECT e.title, e.start, e.end, e.all_day, e.location, e.join_url, c.name AS calendar
    FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id
    WHERE c.user_id = ? AND c.enabled = 1 AND e.start < ? AND COALESCE(e.end, e.start) >= ?
    ORDER BY e.all_day DESC, e.start LIMIT 200`).all(userId, to, date);
  const time = iso => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const seen = new Set();
  return rows.filter(e => {
    if (e.all_day) return e.start <= date && (e.end ? e.end > date : e.start === date);
    return e.start < to && (e.end || e.start) > from;
  }).filter(e => { const k = `${e.title}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(e => ({ title: e.title, all_day: !!e.all_day, start: e.all_day ? null : time(e.start), end: e.all_day || !e.end ? null : time(e.end), location: e.location, join_url: e.join_url, calendar: e.calendar }));
}

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

/** The daily email for a person, or null if there's nothing and they skip empty days. */
export function dailyEmail(userId, prefs = getPrefs(userId), now = localNow(prefs.tz)) {
  const user = db.prepare('SELECT username, display_name, email FROM users WHERE id=?').get(userId);
  if (!user?.email) return null;
  const events = eventsOn(userId, now.date, prefs.tz);
  const tasks = datedTasks(userId);
  const due = tasks.filter(t => t.due === now.date).sort((a, b) => priRank(a.priority) - priRank(b.priority) || (a.time || '99').localeCompare(b.time || '99'));
  const overdue = tasks.filter(t => t.due < now.date).sort((a, b) => priRank(a.priority) - priRank(b.priority) || a.due.localeCompare(b.due));
  if (prefs.email_skip_empty && !events.length && !due.length && !overdue.length) return null;

  const dayName = new Date(`${now.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const base = appUrl();
  const link = path => (base ? `${base}${path}` : null);
  const bits = [];
  if (events.length) bits.push(`${events.length} meeting${events.length === 1 ? '' : 's'}`);
  if (due.length) bits.push(`${due.length} due`);
  if (overdue.length) bits.push(`${overdue.length} overdue`);
  const subject = `Your day — ${dayName}${bits.length ? ` · ${bits.join(', ')}` : ''}`;
  const name = user.display_name || user.username;
  const greeting = now.min < 720 ? 'Good morning' : now.min < 1080 ? 'Good afternoon' : 'Good evening';

  // Plain text
  const txt = [`${greeting}, ${name}. Here's ${dayName}.`, ''];
  txt.push('MEETINGS');
  if (events.length) for (const e of events) txt.push(`  ${e.all_day ? 'All day' : `${e.start}${e.end ? `–${e.end}` : ''}`}  ${e.title}${e.location ? ` (${e.location})` : ''}`);
  else txt.push('  Nothing on the calendar.');
  const PRI_TXT = { high: '(High) ', medium: '(Medium) ', low: '(Low) ' };
  const taskLine = t => `  [ ] ${PRI_TXT[t.priority] || ''}${t.text}${t.time ? ` at ${t.time}` : ''} — ${t.noteTitle}${link(`/?note=${t.noteId}`) ? ` ${link(`/?note=${t.noteId}`)}` : ''}`;
  txt.push('', 'DUE TODAY');
  if (due.length) due.forEach(t => txt.push(taskLine(t))); else txt.push('  Nothing due today.');
  if (overdue.length) { txt.push('', 'OVERDUE'); overdue.forEach(t => txt.push(`${taskLine(t)} (was due ${t.due})`)); }
  if (base) txt.push('', `All tasks: ${link('/?open=tasks')}`);
  txt.push('', '—', 'Sent by Synapse. Change or turn off this email in Settings → Reminders.');

  // HTML (inline styles: email apps ignore stylesheets)
  const section = (title, inner) => `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b80;margin:24px 0 8px">${title}</h2>${inner}`;
  const row = inner => `<tr><td style="padding:8px 0;border-bottom:1px solid #ececf3;font-size:15px;color:#1d1d29;vertical-align:top">${inner}</td></tr>`;
  const table = rows => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
  const empty = msg => `<p style="color:#8a8aa0;font-size:14px;margin:4px 0">${msg}</p>`;
  const cell = 'padding:8px 0;border-bottom:1px solid #ececf3;font-size:15px;color:#1d1d29;vertical-align:top';
  const evHtml = events.length ? table(events.map(e => `<tr>`
    + `<td style="${cell};width:1%;white-space:nowrap;padding-right:16px;color:#5b5bd6;font-weight:600">${e.all_day ? 'All day' : `${escHtml(e.start)}${e.end ? `<br><span style="font-weight:400;color:#8a8aa0;font-size:13px">to ${escHtml(e.end)}</span>` : ''}`}</td>`
    + `<td style="${cell}"><b>${escHtml(e.title)}</b>${e.location || safeUrl(e.join_url) ? `<br><span style="color:#8a8aa0;font-size:13px">${escHtml(e.location || '')}</span>` : ''}`
    + `${safeUrl(e.join_url) ? ` <a href="${escHtml(e.join_url)}" style="font-size:13px;color:#5b5bd6">Join</a>` : ''}</td></tr>`).join('')) : empty('Nothing on the calendar.');
  const PRI_HTML = { high: ['High', '#e5534b'], medium: ['Medium', '#f2a93b'], low: ['Low', '#2fb67c'] };
  const priTag = t => (PRI_HTML[t.priority] ? `<span style="display:inline-block;background:${PRI_HTML[t.priority][1]};color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:0 6px;margin-right:6px">${PRI_HTML[t.priority][0]}</span>` : '');
  const tHtml = (t, late) => row(`☐ ${priTag(t)}${link(`/?note=${t.noteId}`) ? `<a href="${escHtml(link(`/?note=${t.noteId}`))}" style="color:#1d1d29;text-decoration:none">${escHtml(t.text)}</a>` : escHtml(t.text)}`
    + `${t.time ? ` <span style="color:#5b5bd6;font-size:13px">⏰ ${t.time}</span>` : ''}`
    + `${late ? ` <span style="color:#d33;font-size:13px">was due ${t.due}</span>` : ''}`
    + `<br><span style="color:#8a8aa0;font-size:13px">${escHtml(t.noteTitle)}</span>`);
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td>
<p style="margin:0;color:#8a8aa0;font-size:13px">Synapse</p>
<h1 style="margin:4px 0 0;font-size:22px;color:#1d1d29">${greeting}, ${escHtml(name)}</h1>
<p style="margin:4px 0 0;color:#6b6b80;font-size:15px">${dayName}</p>
${section(`Meetings${events.length ? ` · ${events.length}` : ''}`, evHtml)}
${section(`Due today${due.length ? ` · ${due.length}` : ''}`, due.length ? table(due.map(t => tHtml(t, false)).join('')) : empty('Nothing due today.'))}
${overdue.length ? section(`<span style="color:#d33">Overdue · ${overdue.length}</span>`, table(overdue.map(t => tHtml(t, true)).join(''))) : ''}
${base ? `<p style="margin:24px 0 0"><a href="${escHtml(link('/?open=tasks'))}" style="display:inline-block;background:#5b5bd6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Open Tasks</a></p>` : ''}
</td></tr></table>
<p style="color:#9a9ab0;font-size:12px;margin:16px 0 0">Change or turn off this email in Synapse → Settings → Reminders.</p>
</td></tr></table></body></html>`;
  return { to: user.email, subject, text: txt.join('\n'), html };
}

export async function sendDailyEmail(userId) {
  const mail = dailyEmail(userId, { ...getPrefs(userId), email_skip_empty: false });
  if (!mail) throw Object.assign(new Error('Your account has no email address — add one in Settings → Profile'), { status: 400 });
  await sendMail(mail);
  return { to: mail.to };
}

const mailRetry = new Map(); // userId → don't retry the daily email before this time

async function checkUser(userId) {
  const prefs = getPrefs(userId);
  const now = localNow(prefs.tz);

  // Daily email at its own time (up to 4 hours late if the server was off).
  const et = minutes(prefs.email_time);
  if (prefs.email_daily && mailConfigured() && now.min >= et && now.min < et + 240 && (mailRetry.get(userId) || 0) <= Date.now()
    && once(`mail:${userId}:${now.date}`, userId)) {
    const mail = dailyEmail(userId, prefs, now);
    if (mail) {
      try { await sendMail(mail); mailRetry.delete(userId); } catch (err) {
        // Mail server down or misconfigured: try again in 15 minutes (within the 4-hour window).
        console.warn('Daily email failed:', err.message);
        db.prepare('DELETE FROM reminders_sent WHERE key=?').run(`mail:${userId}:${now.date}`);
        mailRetry.set(userId, Date.now() + 15 * 60 * 1000);
      }
    }
  }

  if (!prefs.summary && !prefs.timed) return;
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
      ...db.prepare('SELECT user_id FROM reminder_prefs WHERE email_daily = 1').all().map(r => r.user_id),
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
