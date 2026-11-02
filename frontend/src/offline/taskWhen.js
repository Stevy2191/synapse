// When a task is due, when to be reminded, and how it repeats — written in the task's own text so it
// survives Markdown, copying and exporting:
//   Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month
// 📅 = due date, ⏰ = reminder time on that day (needs a date), 🔁 = repeats,
// ⏫ / 🔼 / 🔽 = high / medium / low priority (same signs as Obsidian's Tasks plugin),
// 🗂 doing = the board column it's in (To do and Done have no sign: Done = ticked),
// 👤 username = who it's assigned to (shared workspaces). Ticking a repeating
// task moves it to its next date and leaves it unticked (offline/tasks.js, editor/recurring.js).
// The server reads the same tokens for reminders — keep backend/src/taskWhen.js in sync.

export const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
export const TIME = /\s*⏰\s*(\d{1,2}):(\d{2})/u;
const DAYN = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?';
export const REPEAT = new RegExp(`\\s*🔁\\s*(every\\s+(?:(?:\\d+\\s+)?(?:day|week|month|year)s?|weekdays?|weekends?|other\\s+(?:day|week|month|year)|${DAYN}(?:\\s*(?:,|and|&)\\s*${DAYN})*))`, 'iu');

export const PRIORITY = /\s*(⏫|🔼|🔽|🔺|⏬)\uFE0F?/u;
export const STATUS = /\s*🗂\uFE0F?\s*([a-z0-9][a-z0-9-]{0,39})/u;
export const ASSIGNEE = /\s*👤\s*@?([a-z0-9][\w.-]{0,39})/iu;
const PRI_OF = { '⏫': 'high', '🔺': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'low' };
export const PRI_SIGN = { high: '⏫', medium: '🔼', low: '🔽' };
export const PRIORITIES = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
export const priRank = p => ({ high: 0, medium: 1, low: 2 }[p] ?? 3);

export const REPEAT_CHOICES = [
  ['', 'Doesn’t repeat'],
  ['every day', 'Every day'],
  ['every weekday', 'Every weekday (Mon–Fri)'],
  ['every week', 'Every week'],
  ['every 2 weeks', 'Every 2 weeks'],
  ['every month', 'Every month'],
  ['every 3 months', 'Every 3 months'],
  ['every year', 'Every year'],
];

const pad = n => String(n).padStart(2, '0');
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12); };

/** Split a task's text into { text, due, time, repeat } (time "HH:MM", repeat e.g. "every week"). */
export function splitWhen(raw) {
  const s = raw || '';
  const d = s.match(DUE); const t = s.match(TIME); const r = s.match(REPEAT); const pr = s.match(PRIORITY); const st = s.match(STATUS); const as = s.match(ASSIGNEE);
  const text = stripWhen(s).replace(/\s+/g, ' ').trim();
  const h = t ? Number(t[1]) : null;
  return {
    text,
    due: d ? d[1] : null,
    time: t && h < 24 && Number(t[2]) < 60 ? `${pad(h)}:${t[2]}` : null,
    repeat: r ? r[1].toLowerCase().replace(/\s+/g, ' ').trim() : null,
    priority: pr ? PRI_OF[pr[1]] : null,
    status: st ? st[1] : null,
    assignee: as ? as[1].toLowerCase() : null,
  };
}

const ALL = [DUE, TIME, REPEAT, PRIORITY, STATUS, ASSIGNEE];
const g = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
/** The text without any of the signs. */
export function stripWhen(s) { return ALL.reduce((acc, re) => acc.replace(g(re), ' '), String(s || '')); }
export const WHEN_REGEXES = ALL;

/** The tokens for a task, e.g. " 📅 2026-11-20 ⏰ 09:00 🔁 every month" (empty if nothing). */
export function whenTokens({ due, time, repeat, priority, status, assignee }) {
  return `${PRI_SIGN[priority] ? ` ${PRI_SIGN[priority]}` : ''}${assignee ? ` 👤 ${assignee}` : ''}${due ? ` 📅 ${due}` : ''}${due && time ? ` ⏰ ${time}` : ''}${repeat ? ` 🔁 ${repeat}` : ''}${status ? ` 🗂 ${status}` : ''}`;
}

/** Replace any date / time / repeat in `raw` with these. */
export function setWhen(raw, when) {
  const base = ALL.reduce((acc, re) => acc.replace(g(re), ''), raw || '').replace(/\s+$/, '');
  return `${base}${whenTokens(when)}`;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Understand "every 2 weeks", "every weekday", "every monday and thursday"… or null. */
export function parseRepeat(text) {
  const s = String(text || '').toLowerCase().replace(/^every\s+/, '').trim();
  if (!s) return null;
  if (/^weekdays?$/.test(s)) return { days: [1, 2, 3, 4, 5] };
  if (/^weekends?$/.test(s)) return { days: [0, 6] };
  let m = s.match(/^other\s+(day|week|month|year)$/);
  if (m) return { n: 2, unit: m[1] };
  m = s.match(/^(?:(\d+)\s+)?(day|week|month|year)s?$/);
  if (m) return { n: Math.max(1, Math.min(366, Number(m[1] || 1))), unit: m[2] };
  const days = [...new Set(s.split(/\s*(?:,|and|&)\s*/).map(w => DAYS.indexOf(w.slice(0, 3))).filter(i => i >= 0))];
  return days.length ? { days } : null;
}

function step(d, rule, dayOfMonth) {
  const x = new Date(d);
  if (rule.days) { do x.setDate(x.getDate() + 1); while (!rule.days.includes(x.getDay())); return x; }
  if (rule.unit === 'day') x.setDate(x.getDate() + rule.n);
  else if (rule.unit === 'week') x.setDate(x.getDate() + 7 * rule.n);
  else {
    // Months and years keep the original day, clamped to the month's length (31st → 30th → 28th…).
    const months = rule.unit === 'month' ? rule.n : 12 * rule.n;
    const target = new Date(x.getFullYear(), x.getMonth() + months, 1, 12);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(dayOfMonth, last));
    return target;
  }
  return x;
}

/**
 * The next date for a repeating task: one step after its due date (or today if it has none),
 * skipping ahead past today if it was overdue — the bins go out next Tuesday, not last Tuesday.
 */
export function nextDue(due, repeat, today = isoOf(new Date())) {
  const rule = parseRepeat(repeat);
  if (!rule) return null;
  const start = dateOf(due || today);
  const dom = start.getDate();
  let d = step(start, rule, dom);
  for (let i = 0; i < 5000 && isoOf(d) <= today; i++) d = step(d, rule, dom);
  return isoOf(d);
}

export const fmtDue = iso => dateOf(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
