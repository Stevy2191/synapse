// Calendar subscriptions (ICS links from Outlook, Google, iCloud, Proton, Nextcloud…).
// The server fetches each link, expands recurring events into a window around today, and stores
// the occurrences, refreshing every 15 minutes. Read-only: Synapse never changes your calendar.
import { guardedFetch, mayUseLocal } from './netguard.js';
import ICAL from 'ical.js';
import { db } from './db/index.js';
import { HttpError } from './users.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#7c7bff',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_synced_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    start TEXT NOT NULL,        -- ISO time, or YYYY-MM-DD for all-day events
    end TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    description TEXT,
    attendees TEXT,             -- JSON [{name, email}]
    join_url TEXT,              -- Teams / Zoom / Meet link when one is found
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_cal_events ON calendar_events(calendar_id, start);
`);

const WINDOW_PAST_DAYS = 60;
const WINDOW_FUTURE_DAYS = 400;
const MAX_BYTES = 15 * 1024 * 1024;

/** webcal:// links are https:// links. */
export function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (/^webcals?:\/\//i.test(url)) url = url.replace(/^webcals?:\/\//i, 'https://');
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpError(400, 'That doesn’t look like a calendar link.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'Calendar links start with https:// (or webcal://).');
  // Never fetch cloud-provider metadata addresses.
  if (/^(169\.254\.|0\.|\[?fe80:)/i.test(parsed.hostname)) throw new HttpError(400, 'That address can’t be used.');
  return parsed.toString();
}

async function download(url, allowLocal = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await guardedFetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Synapse calendar sync', Accept: 'text/calendar, */*' },
    }, { allowLocal });
    if (!res.ok) {
      throw new Error(res.status === 404 ? 'The calendar link wasn’t found (404). It may have been unpublished.'
        : res.status === 401 || res.status === 403 ? 'The calendar refused access. Check the link is the public/secret ICS link.'
        : `The calendar server answered ${res.status}.`);
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('That calendar is too large.');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('That calendar is too large.');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link isn’t a calendar (ICS) file. Make sure you copied the ICS link, not the web page link.');
    return text;
  } catch (err) {
    if (err.code === 'EBLOCKED') throw err;
    if (err.name === 'AbortError') throw new Error('The calendar took too long to answer.');
    if (err.cause?.code === 'ENOTFOUND') throw new Error('Couldn’t find that server. Check the link.');
    if (err.cause?.code === 'ECONNREFUSED') throw new Error('The calendar server refused the connection.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const JOIN = /(https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|[\w.-]*zoom\.us|meet\.google\.com|[\w.-]*webex\.com|whereby\.com|meet\.jit\.si)\/[^\s<>"')\]]+)/i;

function plain(value) {
  return typeof value === 'string' ? value.replace(/\r/g, '').trim() : '';
}

function attendeesOf(vevent) {
  return vevent.getAllProperties('attendee').slice(0, 40).map(p => {
    const value = String(p.getFirstValue() || '');
    return { name: p.getParameter('cn') || '', email: value.replace(/^mailto:/i, '') };
  }).filter(a => a.name || a.email);
}

function toStored(time, allDay) {
  if (allDay) return time.toString().slice(0, 10); // YYYY-MM-DD
  return time.toJSDate().toISOString();
}

/** Parse ICS text into event occurrences within the sync window. */
export function expandCalendar(text) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch {}
  }
  const windowStart = ICAL.Time.fromJSDate(new Date(Date.now() - WINDOW_PAST_DAYS * 86400_000), true);
  const windowEnd = ICAL.Time.fromJSDate(new Date(Date.now() + WINDOW_FUTURE_DAYS * 86400_000), true);

  // Group by UID so moved/cancelled single occurrences (RECURRENCE-ID) attach to their series.
  const byUid = new Map();
  for (const v of comp.getAllSubcomponents('vevent')) {
    const uid = v.getFirstPropertyValue('uid') || Math.random().toString(36);
    if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
    const g = byUid.get(uid);
    if (v.hasProperty('recurrence-id')) g.exceptions.push(v); else g.master = v;
  }

  const out = [];
  const push = (uid, ev, start, end) => {
    if (String(ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const allDay = start.isDate;
    const description = plain(ev.description).slice(0, 4000);
    const location = plain(ev.location).slice(0, 500);
    const join = (ev.component.getFirstPropertyValue('x-microsoft-skypeteamsmeetingurl'))
      || (description.match(JOIN) || location.match(JOIN) || [])[1] || null;
    out.push({
      uid, title: plain(ev.summary) || '(No title)', start: toStored(start, allDay),
      end: end ? toStored(end, allDay) : null, all_day: allDay ? 1 : 0,
      location: location || null, description: description || null,
      attendees: JSON.stringify(attendeesOf(ev.component)), join_url: join,
    });
  };

  for (const [uid, g] of byUid) {
    const masterComp = g.master || g.exceptions[0];
    if (!masterComp) continue;
    const ev = new ICAL.Event(masterComp);
    if (g.master) for (const ex of g.exceptions) { try { ev.relateException(ex); } catch {} }
    if (!ev.startDate) continue;

    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next, guard = 0;
      while ((next = it.next()) && guard++ < 5000) {
        if (next.compare(windowEnd) > 0) break;
        const d = ev.getOccurrenceDetails(next);
        if (d.endDate.compare(windowStart) < 0) continue;
        push(uid, d.item, d.startDate, d.endDate);
      }
    } else if (ev.startDate.compare(windowEnd) <= 0 && (ev.endDate || ev.startDate).compare(windowStart) >= 0) {
      push(uid, ev, ev.startDate, ev.endDate);
    }
  }
  return out;
}

export async function syncCalendar(cal) {
  try {
    // Local-network calendar addresses only for admins (or everyone, if an admin allowed it).
    const owner = db.prepare('SELECT role FROM users WHERE id=?').get(cal.user_id);
    const events = expandCalendar(await download(cal.url, mayUseLocal(owner)));
    db.transaction(() => {
      db.prepare('DELETE FROM calendar_events WHERE calendar_id=?').run(cal.id);
      const ins = db.prepare(`INSERT INTO calendar_events (calendar_id, uid, title, start, end, all_day, location, description, attendees, join_url)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const e of events) ins.run(cal.id, e.uid, e.title, e.start, e.end, e.all_day, e.location, e.description, e.attendees, e.join_url);
      db.prepare('UPDATE calendars SET last_synced_at=unixepoch(), last_error=NULL WHERE id=?').run(cal.id);
    })();
    return { ok: true, count: events.length };
  } catch (err) {
    const message = err instanceof HttpError ? err.message : (err.message || 'Couldn’t read the calendar.');
    db.prepare('UPDATE calendars SET last_error=? WHERE id=?').run(message.slice(0, 300), cal.id);
    return { ok: false, error: message };
  }
}

let syncing = false;
export async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    for (const cal of db.prepare('SELECT * FROM calendars WHERE enabled=1').all()) await syncCalendar(cal);
  } finally { syncing = false; }
}

export function startCalendarSync() {
  setTimeout(syncAll, 10_000).unref();
  setInterval(syncAll, 15 * 60_000).unref();
}
