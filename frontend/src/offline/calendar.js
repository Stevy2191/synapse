// Calendar events for the side panel: fetched from the server, cached on this device per month.
import api from '../api';
import { db } from './db';

export const pad = n => String(n).padStart(2, '0');
/** Local calendar date as YYYY-MM-DD. */
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Events for the month containing `date` (plus a few days either side). Offline: the cached copy. */
export async function monthEvents(date) {
  const key = monthKey(date);
  const from = new Date(date.getFullYear(), date.getMonth(), 1 - 7);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 1 + 7);
  try {
    const { data } = await api.get(`/calendars/events?from=${dayKey(from)}&to=${dayKey(to)}`);
    (await db()).put('calendar', { events: data.events, at: Date.now() }, key).catch?.(() => {});
    return { events: data.events, cached: false };
  } catch (err) {
    if (err.response) throw err;
    const cached = await (await db()).get('calendar', key);
    return { events: cached?.events || [], cached: true, at: cached?.at };
  }
}

/** The local days (YYYY-MM-DD) an event covers. All-day end dates are exclusive. */
export function eventDays(e) {
  if (e.all_day) {
    const days = [];
    const [y, m, d] = e.start.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    const endKey = e.end || e.start;
    do { days.push(dayKey(cur)); cur.setDate(cur.getDate() + 1); } while (dayKey(cur) < endKey && days.length < 62);
    return days;
  }
  const start = new Date(e.start);
  const end = new Date(e.end || e.start);
  const days = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // An event ending exactly at midnight doesn't spill into the next day.
  const last = new Date(end.getTime() - (end > start ? 1 : 0));
  while (cur <= last && days.length < 62) { days.push(dayKey(cur)); cur.setDate(cur.getDate() + 1); }
  return days.length ? days : [dayKey(start)];
}

export function timeRange(e) {
  if (e.all_day) return 'All day';
  const f = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return e.end ? `${f(e.start)} – ${f(e.end)}` : f(e.start);
}
