import { Router } from 'express';
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

router.get('/', (req, res) => {
  const workspaces = db.prepare('SELECT * FROM workspaces WHERE user_id=? ORDER BY created_at').all(req.user.id);
  res.json({ workspaces });
});

router.post('/', (req, res) => {
  const name = clean(req.body?.name, 60);
  const icon = clean(req.body?.icon, 16) || '📁';
  const color = COLOR.test(req.body?.color) ? req.body.color : '#6366f1';
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuid();
  db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(id, req.user.id, name, icon, color);
  res.json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) });
});

router.patch('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
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
  res.json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws.id) });
});

router.delete('/:id', (req, res) => {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM workspaces WHERE user_id=?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete last workspace' });
  const files = db.prepare('SELECT a.filename FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.workspace_id=?').all(ws.id).map(r => r.filename);
  db.prepare('DELETE FROM workspaces WHERE id=?').run(ws.id);
  removeUploadFiles(files);
  res.json({ ok: true });
});

export default router;
