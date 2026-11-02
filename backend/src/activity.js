// Team features part 2 — what happened, and what needs you.
//   activity: per-workspace log (created / edited / deleted / restored a note, commented, resolved).
//             Edits by the same person on the same note within 10 minutes are one entry.
//   inbox:    per-person items that need them (mentioned, assigned a to-do, a reply to their comment,
//             a comment on a thread they're in, added to a workspace). A bell in the sidebar shows them.
import { db } from './db/index.js';
import { sendTo } from './chat.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    note_id TEXT,
    user_id TEXT,
    kind TEXT NOT NULL,
    title TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity(workspace_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    note_id TEXT,
    workspace_id TEXT,
    thread_id TEXT,
    by_user TEXT,
    title TEXT NOT NULL,
    body TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    read_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox(user_id, created_at DESC);
`);

const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || null);

/** Log something that happened in a workspace. */
export function logActivity({ workspace_id, note_id = null, user_id = null, kind, title = null, detail = null }) {
  if (!workspace_id || !kind) return;
  if (kind === 'edited') {
    const last = db.prepare(`SELECT id FROM activity WHERE workspace_id=? AND note_id=? AND user_id IS ? AND kind IN ('edited','created')
      AND created_at > unixepoch() - 600 ORDER BY id DESC LIMIT 1`).get(workspace_id, note_id, user_id);
    if (last) { db.prepare('UPDATE activity SET title=? WHERE id=?').run(short(title, 200), last.id); return; }
  }
  db.prepare('INSERT INTO activity (workspace_id, note_id, user_id, kind, title, detail) VALUES (?,?,?,?,?,?)')
    .run(workspace_id, note_id, user_id, kind, short(title, 200), short(detail, 300));
}

export const unreadCount = userId => db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE user_id=? AND read_at IS NULL').get(userId).n;

/** Add an item to someone's inbox (and update their bell live). */
export function addToInbox({ user_id, kind, note_id = null, workspace_id = null, thread_id = null, by_user = null, title, body = null }) {
  if (!user_id || !title || user_id === by_user) return;
  db.prepare('INSERT INTO inbox (user_id, kind, note_id, workspace_id, thread_id, by_user, title, body) VALUES (?,?,?,?,?,?,?,?)')
    .run(user_id, kind, note_id, workspace_id, thread_id, by_user, short(title, 200), short(body, 400));
  sendTo([user_id], 'inbox', { unread: unreadCount(user_id) });
}

/** Keep things tidy: activity for 180 days, read inbox items for 60 days. */
export function pruneActivity() {
  db.prepare('DELETE FROM activity WHERE created_at < unixepoch() - 180*86400').run();
  db.prepare('DELETE FROM inbox WHERE read_at IS NOT NULL AND read_at < unixepoch() - 60*86400').run();
}
