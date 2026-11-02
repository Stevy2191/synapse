// When a task is due, when to be reminded, and how it repeats — written in the task's own text so it
// survives Markdown, copying and exporting:
//   Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month
// 📅 = due date, ⏰ = reminder time on that day (needs a date), 🔁 = repeats. Ticking a repeating
// task moves it to its next date and leaves it unticked (offline/tasks.js, editor/recurring.js).
// The server reads the same tokens for reminders — keep backend/src/taskWhen.js in sync.

export const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
export const TIME = /\s*⏰\s*(\d{1,2}):(\d{2})/u;
const DAYN = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?';
export const REPEAT = new RegExp(`\\s*🔁\\s*(every\\s+(?:(?:\\d+\\s+)?(?:day|week|month|year)s?|weekdays?|weekends?|other\\s+(?:day|week|month|year)|${DAYN}(?:\\s*(?:,|and|&)\\s*${DAYN})*))`, 'iu');

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
  const d = s.match(DUE); const t = s.match(TIME); const r = s.match(REPEAT);
  const text = s.replace(DUE, ' ').replace(TIME, ' ').replace(REPEAT, ' ').replace(/\s+/g, ' ').trim();
  const h = t ? Number(t[1]) : null;
  return {
    text,
    due: d ? d[1] : null,
    time: t && h < 24 && Number(t[2]) < 60 ? `${pad(h)}:${t[2]}` : null,
    repeat: r ? r[1].toLowerCase().replace(/\s+/g, ' ').trim() : null,
  };
}

/** The tokens for a task, e.g. " 📅 2026-11-20 ⏰ 09:00 🔁 every month" (empty if nothing). */
export function whenTokens({ due, time, repeat }) {
  return `${due ? ` 📅 ${due}` : ''}${due && time ? ` ⏰ ${time}` : ''}${repeat ? ` 🔁 ${repeat}` : ''}`;
}

/** Replace any date / time / repeat in `raw` with these. */
export function setWhen(raw, when) {
  const base = (raw || '').replace(DUE, '').replace(TIME, '').replace(REPEAT, '').replace(/\s+$/, '');
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
