// Shared workspaces (team features). The workspace's owner (workspaces.user_id) adds people on this
// server as members who can edit or only view. Members see and edit the workspace's notes like their
// own; only the owner renames/deletes the workspace or changes who's in it.
import { db } from './db/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('edit','view')),
    added_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ws_members_user ON workspace_members(user_id);
`);

const RANK = { view: 1, edit: 2, owner: 3 };
const wsRow = db.prepare('SELECT * FROM workspaces WHERE id=?');
const memberRow = db.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?');

/** 'owner' | 'edit' | 'view' | null */
export function workspaceRole(wsId, userId) {
  const ws = wsRow.get(wsId);
  if (!ws) return null;
  if (ws.user_id === userId) return 'owner';
  return memberRow.get(wsId, userId)?.role || null;
}

/** The workspace if `userId` has at least `need` ('view' | 'edit' | 'owner'), else null. Adds `role`. */
export function workspaceFor(wsId, userId, need = 'view') {
  const ws = wsRow.get(wsId);
  if (!ws) return null;
  const role = ws.user_id === userId ? 'owner' : memberRow.get(wsId, userId)?.role;
  return role && RANK[role] >= RANK[need] ? { ...ws, role } : null;
}

/** SQL condition (with one `?` for the user id) for "workspace w is mine or I'm a member". */
export const MY_WORKSPACES_SQL = '(w.user_id = ? OR w.id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?))';

/** Everyone in a workspace: owner first, then members. */
export function workspacePeople(wsId) {
  const ws = wsRow.get(wsId);
  if (!ws) return [];
  const people = [{ user_id: ws.user_id, role: 'owner' }];
  for (const m of db.prepare('SELECT user_id, role FROM workspace_members WHERE workspace_id=? ORDER BY created_at').all(wsId)) people.push(m);
  return people;
}
export const workspacePeopleIds = wsId => workspacePeople(wsId).map(p => p.user_id);
export const isShared = wsId => !!db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id=? LIMIT 1').get(wsId);

// Tell the other people in a shared workspace that something changed, so their apps pull now instead of
// waiting for the next sync (bundled: at most one message per workspace per 1.5 s).
const pending = new Map(); // wsId → Set(except user ids)
export function notifyWorkspace(wsId, exceptUserId, sendTo) {
  if (!wsId || !isShared(wsId)) return;
  if (pending.has(wsId)) { pending.get(wsId).add(exceptUserId); return; }
  pending.set(wsId, new Set([exceptUserId]));
  setTimeout(() => {
    const except = pending.get(wsId) || new Set();
    pending.delete(wsId);
    // Everyone but the author(s) of this burst of changes.
    const to = workspacePeopleIds(wsId).filter(id => !(except.size === 1 && except.has(id)));
    sendTo(to, 'ws:changed', { workspace_id: wsId });
  }, 1500).unref?.();
}
