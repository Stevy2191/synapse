import { Router } from 'express';
import { workspaceFor, workspacePeople, workspacePeopleIds, MY_WORKSPACES_SQL } from '../members.js';
import { sendTo, pushTo } from '../chat.js';
import { addToInbox } from '../activity.js';
import { v4 as uuid } from 'uuid';
import { db, removeUploadFiles } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { validImage } from '../settings.js';

const router = Router();
router.use(requireAuth);

const COLOR = /^#[0-9a-fA-F]{6}$/;

// Per-workspace preferences, with their allowed values.
const SETTING_RULES = {
  default_editor: v => ['rich', 'markdown'].includes(v),   // how new notes open: Write or Markdown
  default_note_type: v => ['note', 'diagram', 'draw'].includes(v),
  ai: v => ['on', 'off'].includes(v),                      // allow the AI assistant in this workspace
  clusters: validClusters,                                 // saved smart groups of notes (sidebar → Clusters)
  board: validBoard,                                       // Tasks → Board columns
};

// Board: { columns: [{ key, name, color? }] } — keys 'todo' and 'done' must be there; others are written
// into tasks as "🗂 <key>".
function validBoard(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.columns) || b.columns.length > 20) return false;
  const keys = b.columns.map(c => c && c.key);
  return keys.includes('todo') && keys.includes('done') && new Set(keys).size === keys.length
    && b.columns.every(c => c && typeof c === 'object' && typeof c.key === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(c.key)
      && typeof c.name === 'string' && c.name.trim() && c.name.length <= 40 && (c.color === undefined || COLOR.test(c.color)));
}

// Clusters: [{ id, name, icon, color, match: 'all'|'any', rules: [{ field, op, value }], pinned: [noteId], hidden: [noteId] }]
const CLUSTER_FIELDS = new Set(['tag', 'title', 'text', 'kind', 'created', 'updated', 'inside', 'has']);
const shortStr = (v, max) => typeof v === 'string' && v.length <= max;
const idList = v => Array.isArray(v) && v.length <= 1000 && v.every(x => shortStr(x, 64));
function validClusters(list) {
  return Array.isArray(list) && list.length <= 100 && list.every(c => c && typeof c === 'object'
    && shortStr(c.id, 64) && shortStr(c.name, 80) && c.name.trim()
    && (c.icon === undefined || shortStr(c.icon, 16)) && (c.color === undefined || COLOR.test(c.color))
    && ['all', 'any'].includes(c.match)
    && Array.isArray(c.rules) && c.rules.length <= 20
    && c.rules.every(r => r && CLUSTER_FIELDS.has(r.field) && shortStr(r.op, 20) && shortStr(String(r.value ?? ''), 200))
    && (c.pinned === undefined || idList(c.pinned)) && (c.hidden === undefined || idList(c.hidden))
    && (c.created_at === undefined || Number.isFinite(c.created_at)));
}
function cleanSettings(current, incoming) {
  let merged = {};
  try { merged = JSON.parse(current || '{}'); } catch {}
  if (incoming && typeof incoming === 'object') {
    for (const [k, v] of Object.entries(incoming)) {
      if (SETTING_RULES[k]?.(v)) merged[k] = v;
      else if (v === null && SETTING_RULES[k]) delete merged[k];
    }
  }
  return JSON.stringify(merged);
}

function clean(str, max) {
  return typeof str === 'string' ? str.trim().slice(0, max) : '';
}

// Each workspace comes with `role` (owner | edit | view), `owner_name` and `members` (how many besides the owner).
function withTeam(ws, userId) {
  const role = ws.user_id === userId ? 'owner' : (db.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?').get(ws.id, userId)?.role || null);
  const owner = db.prepare('SELECT COALESCE(display_name, username) AS n FROM users WHERE id=?').get(ws.user_id)?.n || '';
  const members = db.prepare('SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id=?').get(ws.id).c;
  return { ...ws, role, owner_name: owner, members };
}

router.get('/', (req, res) => {
  const workspaces = db.prepare(`SELECT w.* FROM workspaces w WHERE ${MY_WORKSPACES_SQL} ORDER BY (w.user_id = ?) DESC, w.created_at`)
    .all(req.user.id, req.user.id, req.user.id).map(w => withTeam(w, req.user.id));
  res.json({ workspaces });
});

// ── Members (shared workspaces) ──
const personOf = id => db.prepare('SELECT id, username, display_name, avatar FROM users WHERE id=?').get(id);
function membersView(wsId) {
  return workspacePeople(wsId).map(p => ({ ...personOf(p.user_id), role: p.role })).filter(p => p.id);
}
router.get('/:id/members', (req, res) => {
  if (!workspaceFor(req.params.id, req.user.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ members: membersView(req.params.id) });
});
router.post('/:id/members', (req, res) => {
  const ws = workspaceFor(req.params.id, req.user.id, 'owner');
  if (!ws) return res.status(403).json({ error: 'Only the workspace’s owner can add people' });
  const { user_id, role } = req.body || {};
  if (!['edit', 'view'].includes(role)) return res.status(400).json({ error: 'Pick Can edit or Can view' });
  const person = personOf(String(user_id || ''));
  if (!person) return res.status(404).json({ error: 'That person isn’t on this server' });
  if (person.id === ws.user_id) return res.status(400).json({ error: 'That’s the owner' });
  db.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, added_by) VALUES (?,?,?,?)
    ON CONFLICT(workspace_id, user_id) DO UPDATE SET role=excluded.role`).run(ws.id, person.id, role, req.user.id);
  const by = personOf(req.user.id);
  const byName = by.display_name || by.username;
  sendTo([person.id], 'workspaces:changed', { workspace_id: ws.id, added: true, name: ws.name, by: byName });
  sendTo(workspacePeopleIds(ws.id), 'members:changed', { workspace_id: ws.id });
  addToInbox({ user_id: person.id, kind: 'added', workspace_id: ws.id, by_user: req.user.id, title: `${byName} added you to the workspace “${ws.name}”`, body: role === 'edit' ? 'You can edit its notes.' : 'You can view its notes.' });
  pushTo(person.id, { title: `${byName} added you to “${ws.name}”`, body: 'Open Synapse to see the shared workspace.', tag: `ws-${ws.id}`, url: '/' }).catch(() => {});
  res.json({ members: membersView(ws.id) });
});
router.patch('/:id/members/:userId', (req, res) => {
  const ws = workspaceFor(req.params.id, req.user.id, 'owner');
  if (!ws) return res.status(403).json({ error: 'Only the workspace’s owner can change this' });
  if (!['edit', 'view'].includes(req.body?.role)) return res.status(400).json({ error: 'Pick Can edit or Can view' });
  db.prepare('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?').run(req.body.role, ws.id, req.params.userId);
  sendTo(workspacePeopleIds(ws.id), 'members:changed', { workspace_id: ws.id });
  sendTo([req.params.userId], 'workspaces:changed', { workspace_id: ws.id });
  res.json({ members: membersView(ws.id) });
});
router.delete('/:id/members/:userId', (req, res) => {
  const self = req.params.userId === req.user.id;
  const ws = workspaceFor(req.params.id, req.user.id, self ? 'view' : 'owner');
  if (!ws) return res.status(403).json({ error: 'Only the workspace’s owner can remove people' });
  if (ws.user_id === req.params.userId) return res.status(400).json({ error: 'The owner can’t leave their own workspace' });
  const before = workspacePeopleIds(ws.id);
  db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(ws.id, req.params.userId);
  sendTo(before, 'members:changed', { workspace_id: ws.id });
  sendTo([req.params.userId], 'workspaces:changed', { workspace_id: ws.id, removed: true });
  res.json({ members: membersView(ws.id) });
});

router.post('/', (req, res) => {
  const name = clean(req.body?.name, 60);
  const icon = clean(req.body?.icon, 16) || '📁';
  const color = COLOR.test(req.body?.color) ? req.body.color : '#6366f1';
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(id, req.user.id, name, icon, color);
  res.json({ workspace: withTeam(db.prepare('SELECT * FROM workspaces WHERE id=?').get(id), req.user.id) });
});

router.patch('/:id', (req, res) => {
  const ws = workspaceFor(req.params.id, req.user.id, 'edit');
  if (!ws) return res.status(404).json({ error: 'Not found' });
  let body = req.body || {};
  // People who can edit a shared workspace can change its shared lists (board, clusters); the rest is the owner's.
  if (ws.role !== 'owner') {
    const allowed = Object.fromEntries(Object.entries(body.settings || {}).filter(([k]) => ['board', 'clusters'].includes(k)));
    body = { settings: allowed };
  }
  const name = clean(body.name, 60) || ws.name;
  const icon = clean(body.icon, 16) || ws.icon;
  const color = COLOR.test(body.color) ? body.color : ws.color;
  let iconImage = ws.icon_image;
  if (body.icon_image !== undefined) {
    if (body.icon_image !== null && !validImage(body.icon_image)) return res.status(400).json({ error: 'Please choose a PNG, JPEG or WebP picture.' });
    iconImage = body.icon_image;
  }
  const settings = cleanSettings(ws.settings, body.settings);
  db.prepare('UPDATE workspaces SET name=?, icon=?, color=?, icon_image=?, settings=? WHERE id=?').run(name, icon, color, iconImage, settings, ws.id);
  sendTo(workspacePeopleIds(ws.id).filter(id => id !== req.user.id), 'workspaces:changed', { workspace_id: ws.id });
  res.json({ workspace: withTeam(db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws.id), req.user.id) });
});

router.delete('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM workspaces WHERE user_id=?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete last workspace' });
  const files = db.prepare('SELECT a.filename FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.workspace_id=?').all(ws.id).map(r => r.filename);
  const people = workspacePeopleIds(ws.id).filter(id => id !== req.user.id);
  db.prepare('DELETE FROM workspaces WHERE id=?').run(ws.id);
  sendTo(people, 'workspaces:changed', { workspace_id: ws.id, removed: true });
  removeUploadFiles(files);
  res.json({ ok: true });
});

export default router;
