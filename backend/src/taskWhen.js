// Reading tasks for reminders: the same tokens as frontend/src/offline/taskWhen.js (keep in sync).
//   - [ ] Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month
export const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
export const TIME = /\s*⏰\s*(\d{1,2}):(\d{2})/u;
const DAYN = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?';
export const REPEAT = new RegExp(`\\s*🔁\\s*(every\\s+(?:(?:\\d+\\s+)?(?:day|week|month|year)s?|weekdays?|weekends?|other\\s+(?:day|week|month|year)|${DAYN}(?:\\s*(?:,|and|&)\\s*${DAYN})*))`, 'iu');
const MD_TASK = /^\s*(?:>\s*)*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const pad = n => String(n).padStart(2, '0');

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
