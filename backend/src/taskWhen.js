// Reading tasks for reminders: the same tokens as frontend/src/offline/taskWhen.js (keep in sync).
//   - [ ] Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month
export const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
export const TIME = /\s*⏰\s*(\d{1,2}):(\d{2})/u;
const DAYN = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?';
export const REPEAT = new RegExp(`\\s*🔁\\s*(every\\s+(?:(?:\\d+\\s+)?(?:day|week|month|year)s?|weekdays?|weekends?|other\\s+(?:day|week|month|year)|${DAYN}(?:\\s*(?:,|and|&)\\s*${DAYN})*))`, 'iu');
export const PRIORITY = /\s*(⏫|🔼|🔽|🔺|⏬)\uFE0F?/u;
export const STATUS = /\s*🗂\uFE0F?\s*([a-z0-9][a-z0-9-]{0,39})/u;
export const ASSIGNEE = /\s*👤\s*@?([a-z0-9][\w.-]{0,39})/iu;
const PRI_OF = { '⏫': 'high', '🔺': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'low' };
export const priRank = p => ({ high: 0, medium: 1, low: 2 }[p] ?? 3);
const ALL = [DUE, TIME, REPEAT, PRIORITY, STATUS, ASSIGNEE];
const g = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
const MD_TASK = /^\s*(?:>\s*)*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const pad = n => String(n).padStart(2, '0');

export function splitWhen(raw) {
  const s = raw || '';
  const d = s.match(DUE); const t = s.match(TIME); const r = s.match(REPEAT); const pr = s.match(PRIORITY); const st = s.match(STATUS); const as = s.match(ASSIGNEE);
  const text = ALL.reduce((acc, re) => acc.replace(g(re), ' '), s).replace(/\s+/g, ' ').trim();
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

/** Open (unticked) tasks in a note's Markdown, outside code blocks: [{ text, due, time, repeat }]. */
export function openTasks(md) {
  const out = [];
  let fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = line.match(MD_TASK);
    if (!m || m[1] !== ' ') continue;
    const w = splitWhen(m[2]);
    if (w.text) out.push(w);
  }
  return out;
}
