// @mentions and assigned to-dos: when a note's text gains "@username" or a to-do gains "👤 username",
// that person (if they can see the note, and it isn't you) gets a notification — live in the app if it's
// open, otherwise a push notification.
import { db } from './db/index.js';
import { noteAccess } from './shares.js';
import { sendTo, pushTo, isOnScreen } from './chat.js';

const MENTION = /(^|[\s(>])@([a-z0-9][\w.-]{0,39})/gi;
const ASSIGN = /👤\s*@?([a-z0-9][\w.-]{0,39})/gi;

function counts(md, re, pick) {
  const m = new Map();
  for (const x of String(md || '').matchAll(re)) { const k = pick(x).toLowerCase(); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const userByName = db.prepare('SELECT id, username, COALESCE(display_name, username) AS name FROM users WHERE lower(username)=?');

/** Lines of `md` mentioning `name` the way `re` does (for the notification text). */
function lineWith(md, name, kind) {
  const lines = String(md || '').split('\n');
  const want = name.toLowerCase();
  const hit = lines.find(l => (kind === 'assign' ? [...l.matchAll(ASSIGN)].some(x => x[1].toLowerCase() === want) : [...l.matchAll(MENTION)].some(x => x[2].toLowerCase() === want)));
  return (hit || '').replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '').replace(/[📅⏰🔁⏫🔼🔽🔺⏬🗂👤]\S*\s*\S*/gu, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function notifyMentions(note, prevMd, byUserId) {
  const by = db.prepare('SELECT COALESCE(display_name, username) AS n FROM users WHERE id=?').get(byUserId)?.n || 'Someone';
  for (const [kind, re, pick] of [['mention', MENTION, x => x[2]], ['assign', ASSIGN, x => x[1]]]) {
    const before = counts(prevMd, re, pick);
    for (const [name, n] of counts(note.content, re, pick)) {
      if (n <= (before.get(name) || 0)) continue;
      const person = userByName.get(name);
      if (!person || person.id === byUserId || !noteAccess(note.id, person.id)) continue;
      const line = lineWith(note.content, name, kind);
      const payload = {
        kind, note_id: note.id, note_title: note.title, by,
        title: kind === 'assign' ? `${by} assigned you a to-do` : `${by} mentioned you in “${note.title}”`,
        body: line || note.title,
      };
      if (isOnScreen(person.id)) sendTo([person.id], 'mention', payload);
      else pushTo(person.id, { title: payload.title, body: payload.body, tag: `mention-${note.id}`, url: `/?note=${note.id}` }).catch(() => {});
    }
  }
}
