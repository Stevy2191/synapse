import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db, indexNote, searchableText, removeUploadFiles } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { TRASH_DAYS } from '../config.js';
import { noteAccess, currentLock, takeLock, afterNoteSaved } from '../shares.js';
import { sendTo } from '../chat.js';
import { workspaceFor, MY_WORKSPACES_SQL, workspacePeopleIds, isShared, notifyWorkspace } from '../members.js';
import { isCollabNote, externalChange, setContentSaver } from '../collab.js';
import { notifyMentions } from '../mentions.js';
import { logActivity } from '../activity.js';

const router = Router();
router.use(requireAuth);

// Shared workspaces: after any change, tell the other members' apps to pull now (members.js).
router.use((req, res, next) => {
  if (req.method === 'GET' || req.path === '/batch') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    let ws = typeof req.body?.workspace_id === 'string' ? req.body.workspace_id : null;
    const byNote = req.path.match(/^\/([0-9a-f-]{36})/i);
    if (!ws && byNote) ws = db.prepare('SELECT workspace_id FROM notes WHERE id=?').get(byNote[1])?.workspace_id;
    const byWs = req.path.match(/^\/workspace\/([^/]+)/);
    if (!ws && byWs) ws = byWs[1];
    if (ws) notifyWorkspace(ws, req.user.id, sendTo);
  });
  next();
});

const NOTE_TYPES = ['note', 'diagram', 'draw'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Changing any of these bumps the note's version. Moves (parent/position) don't, so
// reorganising the tree on one device never conflicts with edits on another.
const CONTENT_FIELDS = ['title', 'content', 'rich_content', 'canvas_data', 'tags', 'editor_mode', 'note_type'];
const EDITOR_MODES = ['markdown', 'rich'];

// Access: the workspace's owner, or a member of a shared workspace (members.js). Reading needs
// 'view'; changing anything needs 'edit'.
function getWorkspace(wsId, userId, need = 'view') {
  return workspaceFor(wsId, userId, need);
}

function getOwnedNote(id, userId, need = 'edit') {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
  return note && workspaceFor(note.workspace_id, userId, need) ? note : undefined;
}

// IDs of a note and everything nested under it.
function subtreeIds(noteId) {
  return db.prepare(`
    WITH RECURSIVE sub(id) AS (
      SELECT ? UNION SELECT n.id FROM notes n JOIN sub ON n.parent_id = sub.id
    ) SELECT id FROM sub`).all(noteId).map(r => r.id);
}

// Make sure a parent is in the same workspace and doesn't create a cycle.
function validateParent(parentId, workspaceId, noteId = null) {
  if (parentId === null) return null;
  if (typeof parentId !== 'string') return 'Invalid parent';
  const parent = db.prepare('SELECT id, workspace_id, deleted_at FROM notes WHERE id=?').get(parentId);
  if (!parent || parent.workspace_id !== workspaceId || parent.deleted_at) return 'Parent note not found';
  if (noteId && subtreeIds(noteId).includes(parentId)) return 'A note cannot be moved inside itself';
  return null;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return null;
  return [...new Set(tags.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

// Parse [[links]] from the note's text and sync note_links.
function syncLinks(note) {
  const titles = new Set();
  const pattern = /\[\[([^\[\]\n]+)\]\]/g;
  for (const m of searchableText(note).matchAll(pattern)) {
    titles.add(m[1].split('|')[0].trim());
  }

  db.prepare('DELETE FROM note_links WHERE source_id=?').run(note.id);
  const findTarget = db.prepare('SELECT id FROM notes WHERE workspace_id=? AND title=? COLLATE NOCASE AND deleted_at IS NULL');
  const insert = db.prepare('INSERT INTO note_links (id,source_id,target_id,workspace_id) VALUES (?,?,?,?)');
  const linked = new Set();
  for (const title of titles) {
    const target = findTarget.get(note.workspace_id, title);
    if (target && target.id !== note.id && !linked.has(target.id)) {
      linked.add(target.id);
      insert.run(uuid(), note.id, target.id, note.workspace_id);
    }
  }
}

// Notes whose [[links]] mention a title. Used to re-link when a note is created or renamed.
function relinkNotesMentioning(workspaceId, titles) {
  const others = db.prepare('SELECT * FROM notes WHERE workspace_id=? AND deleted_at IS NULL').all(workspaceId);
  const needles = titles.filter(Boolean).map(t => `[[${t.toLowerCase()}`);
  for (const n of others) {
    const text = searchableText(n).toLowerCase();
    if (needles.some(nd => text.includes(nd))) syncLinks(n);
  }
}

function saveSideEffects(note, previousTitle = null) {
  indexNote(note);
  syncLinks(note);
  if (previousTitle !== note.title) relinkNotesMentioning(note.workspace_id, [note.title, previousTitle]);
}

// All notes in a workspace (tree data, no content)
router.get('/workspace/:wsId', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Workspace not found' });
  const notes = db.prepare('SELECT id,parent_id,title,tags,note_type,position,version,created_at,updated_at FROM notes WHERE workspace_id=? AND deleted_at IS NULL ORDER BY position,created_at').all(req.params.wsId);
  res.json({ notes });
});

// Full notes by id, for devices filling their offline copy.
router.post('/batch', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => typeof id === 'string').slice(0, 200) : [];
  if (ids.length === 0) return res.json({ notes: [] });
  const placeholders = ids.map(() => '?').join(',');
  const notes = db.prepare(`
    SELECT n.* FROM notes n JOIN workspaces w ON w.id=n.workspace_id
    WHERE n.id IN (${placeholders}) AND ${MY_WORKSPACES_SQL} AND n.deleted_at IS NULL`).all(...ids, req.user.id, req.user.id);
  res.json({ notes });
});

// Full-text search
router.get('/workspace/:wsId/search', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  // Quote each word so user input can't break FTS5 query syntax; prefix-match each one.
  const terms = q.match(/[\p{L}\p{N}_]+/gu) || [];
  if (terms.length === 0) return res.json({ results: [] });
  const match = terms.slice(0, 10).map(t => `"${t}"*`).join(' ');

  const results = db.prepare(`
    SELECT n.id, n.title, n.note_type, snippet(notes_fts, 2, '<mark>', '</mark>', '...', 20) AS excerpt
    FROM notes_fts
    JOIN notes n ON n.id = notes_fts.id
    WHERE notes_fts MATCH ? AND n.workspace_id=? AND n.deleted_at IS NULL
    ORDER BY rank LIMIT 30
  `).all(match, req.params.wsId);

  // Snippets come from user content; escape everything except our <mark> tags.
  for (const r of results) {
    r.excerpt = r.excerpt
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
  }
  res.json({ results });
});

// Graph data
router.get('/workspace/:wsId/graph', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const nodes = db.prepare('SELECT id, title, tags, note_type FROM notes WHERE workspace_id=? AND deleted_at IS NULL').all(req.params.wsId);
  const edges = db.prepare(`SELECT l.source_id, l.target_id FROM note_links l
    JOIN notes s ON s.id = l.source_id JOIN notes t ON t.id = l.target_id
    WHERE l.workspace_id=? AND s.deleted_at IS NULL AND t.deleted_at IS NULL`).all(req.params.wsId);
  res.json({ nodes, edges });
});

// Title suggestions for [[linking]]
router.get('/workspace/:wsId/titles', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const escaped = q.replace(/[\\%_]/g, c => '\\' + c);
  const titles = db.prepare("SELECT id, title FROM notes WHERE workspace_id=? AND deleted_at IS NULL AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10").all(req.params.wsId, `%${escaped}%`);
  res.json({ titles });
});

// Single note with content, links and attachments
router.get('/:id', (req, res) => {
  const note = getOwnedNote(req.params.id, req.user.id, 'view');
  if (!note || (note.deleted_at && req.query.trash !== '1')) return res.status(404).json({ error: 'Not found' });

  const links = db.prepare(`
    SELECT n.id, n.title, 'outgoing' AS direction FROM note_links nl
    JOIN notes n ON n.id = nl.target_id WHERE nl.source_id=?
    UNION
    SELECT n.id, n.title, 'incoming' AS direction FROM note_links nl
    JOIN notes n ON n.id = nl.source_id WHERE nl.target_id=?
  `).all(note.id, note.id);

  const attachments = db.prepare('SELECT id,filename,original_name,mime_type,size,created_at FROM attachments WHERE note_id=?').all(note.id);
  res.json({ note, links, attachments });
});

// Create
// Create. Devices may supply their own `id` (notes made offline); repeating a create is harmless.
router.post('/', (req, res) => {
  const body = req.body || {};
  const { workspace_id, title = 'Untitled', content = '', note_type = 'note', canvas_data = null,
    rich_content = null, editor_mode = 'rich', tags = [] } = body;
  let parent_id = body.parent_id ?? null;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  if (!getWorkspace(workspace_id, req.user.id)) return res.status(404).json({ error: 'Workspace not found' });
  if (!getWorkspace(workspace_id, req.user.id, 'edit')) return res.status(403).json({ error: 'You can view this workspace but not change it' });
  if (!NOTE_TYPES.includes(note_type)) return res.status(400).json({ error: 'Invalid note type' });
  if (!EDITOR_MODES.includes(editor_mode)) return res.status(400).json({ error: 'Invalid editor mode' });
  if (typeof title !== 'string' || typeof content !== 'string') return res.status(400).json({ error: 'Invalid note' });
  if (rich_content !== null && typeof rich_content !== 'string') return res.status(400).json({ error: 'Invalid rich_content' });
  if (canvas_data !== null && typeof canvas_data !== 'string') return res.status(400).json({ error: 'Invalid canvas_data' });
  const cleanTags = normalizeTags(tags);
  if (!cleanTags) return res.status(400).json({ error: 'Tags must be a list' });

  let id = uuid();
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return res.status(400).json({ error: 'Invalid id' });
    const existing = db.prepare('SELECT * FROM notes WHERE id=?').get(body.id);
    if (existing) {
      // Already created (e.g. the device retried after losing the response).
      if (getOwnedNote(existing.id, req.user.id)) return res.json({ note: existing });
      return res.status(409).json({ error: 'Note id already in use' });
    }
    id = body.id;
  }

  // A parent deleted on another device while this note was made offline: put it at the top level.
  if (validateParent(parent_id, workspace_id)) {
    if (!body.id) return res.status(400).json({ error: 'Parent note not found' });
    parent_id = null;
  }

  const note = db.transaction(() => {
    const maxPos = db.prepare('SELECT MAX(position) AS m FROM notes WHERE workspace_id=? AND parent_id IS ?').get(workspace_id, parent_id);
    const position = Number.isInteger(body.position) ? body.position : (maxPos.m ?? -1) + 1;
    db.prepare(`INSERT INTO notes (id,workspace_id,parent_id,title,content,position,note_type,canvas_data,rich_content,editor_mode,tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, workspace_id, parent_id, title.trim() || 'Untitled', content, position, note_type, canvas_data,
        rich_content, editor_mode, JSON.stringify(cleanTags));
    const created = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    saveSideEffects(created);
    return created;
  })();
  logActivity({ workspace_id, note_id: note.id, user_id: req.user.id, kind: 'created', title: note.title });
  res.json({ note });
});

// Update. Only fields present in the body change; `parent_id: null` moves the note to the top level.
//
// Offline sync: devices send `base_version` (the version their edit started from) and `op_id`
// (unique per save). If the note changed elsewhere in the meantime, the device's edits are saved
// as a new "(conflict copy)" note next to the original, so nothing is lost; the response then
// has the untouched original in `note` and the copy in `conflict_copy`.
router.patch('/:id', (req, res) => {
  let note = getOwnedNote(req.params.id, req.user.id);
  let guest = null; // someone this note is shared with ("Can edit")
  if (!note) {
    const access = noteAccess(req.params.id, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (access.role !== 'edit') return res.status(403).json({ error: 'You can view this note but not edit it' });
    guest = access;
    note = access.note;
  }
  const body = req.body || {};
  if (guest) {
    // Shared notes are edited one person at a time.
    const lock = currentLock(note.id);
    if (lock && lock.userId !== req.user.id) {
      const who = db.prepare('SELECT COALESCE(display_name, username) AS n FROM users WHERE id=?').get(lock.userId)?.n || 'Someone';
      return res.status(423).json({ error: `${who} is editing this note right now`, lock: { user_id: lock.userId } });
    }
    takeLock(note.id, req.user.id);
    // Moving, retyping or restoring a shared note is up to its owner.
    for (const k of ['parent_id', 'position', 'note_type']) delete body[k];
  }
  const opId = typeof body.op_id === 'string' ? body.op_id.slice(0, 64) : null;
  if (opId && note.last_op_id === opId && !note.deleted_at) return res.json({ note }); // retry of a save already applied
  // Edited on a device that didn't know it was deleted: bring it back rather than lose the edit.
  if (note.deleted_at) {
    restoreFromTrash(note.trash_root === note.id ? note.id : null, note.id, note.id);
    Object.assign(note, db.prepare('SELECT * FROM notes WHERE id=?').get(note.id));
  }
  const next = { ...note };

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return res.status(400).json({ error: 'Invalid title' });
    next.title = body.title.trim() || 'Untitled';
  }
  for (const field of ['content', 'rich_content', 'canvas_data']) {
    if (body[field] !== undefined) {
      if (body[field] !== null && typeof body[field] !== 'string') return res.status(400).json({ error: `Invalid ${field}` });
      next[field] = field === 'content' ? (body[field] ?? '') : body[field];
    }
  }
  if (body.tags !== undefined) {
    const tags = normalizeTags(body.tags);
    if (!tags) return res.status(400).json({ error: 'Tags must be a list' });
    next.tags = JSON.stringify(tags);
  }
  if (body.editor_mode !== undefined) {
    if (!EDITOR_MODES.includes(body.editor_mode)) return res.status(400).json({ error: 'Invalid editor mode' });
    next.editor_mode = body.editor_mode;
  }
  if (body.note_type !== undefined) {
    if (!NOTE_TYPES.includes(body.note_type)) return res.status(400).json({ error: 'Invalid note type' });
    next.note_type = body.note_type;
  }
  if (body.parent_id !== undefined) {
    const parentError = validateParent(body.parent_id, note.workspace_id, note.id);
    if (parentError) return res.status(400).json({ error: parentError });
    next.parent_id = body.parent_id;
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position)) return res.status(400).json({ error: 'Invalid position' });
    next.position = body.position;
  }

  const touchesContent = CONTENT_FIELDS.some(f => body[f] !== undefined);
  const baseVersion = body.base_version;
  // Notes edited live together (collab.js) merge in the shared document, so there's nothing to conflict.
  const live = isCollabNote(note);
  if (touchesContent && !live && Number.isInteger(baseVersion) && baseVersion !== note.version) {
    // Someone with edit rights is online and always has the latest copy: just send it again.
    if (guest) return res.status(409).json({ error: 'This note changed — reloading the latest version', note: db.prepare('SELECT * FROM notes WHERE id=?').get(note.id) });
    const copy = createConflictCopy(note, next, opId);
    return res.json({ note: getOwnedNote(note.id, req.user.id), conflict_copy: copy });
  }

  const updated = db.transaction(() => {
    db.prepare(`
      UPDATE notes SET title=?, content=?, parent_id=?, position=?, tags=?, editor_mode=?,
        note_type=?, canvas_data=?, rich_content=?, version=version+?, last_op_id=?,
        updated_at=CASE WHEN ? THEN unixepoch() ELSE updated_at END
      WHERE id=?
    `).run(next.title, next.content, next.parent_id, next.position, next.tags, next.editor_mode,
      next.note_type, next.canvas_data, next.rich_content, touchesContent ? 1 : 0, opId ?? note.last_op_id,
      touchesContent ? 1 : 0, note.id);
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(note.id);
    if (touchesContent) saveSideEffects(row, note.title);
    return row;
  })();
  // History ("who changed what, when") and live updates for people it's shared with
  if (touchesContent) { afterNoteSaved(updated, req.user.id); notifyMentions(updated, note.content, req.user.id); }
  // A live note's text changed outside the shared editor (Tasks page, board, an offline device…).
  if (live && isCollabNote(updated) && (body.rich_content !== undefined || body.content !== undefined) && updated.rich_content !== note.rich_content) {
    externalChange(note.id, updated.rich_content || '');
  }
  res.json({ note: updated });
});

// Text saved from the live editor (collab.js): the shared document is the truth, this keeps the
// note's HTML / Markdown copies (search, links, offline reading, Tasks) up to date.
setContentSaver((noteId, userId, { rich_content, content }) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=? AND deleted_at IS NULL').get(noteId);
  if (!note || (note.rich_content === rich_content && note.content === content)) return;
  const row = db.transaction(() => {
    db.prepare('UPDATE notes SET rich_content=?, content=?, version=version+1, updated_at=unixepoch() WHERE id=?').run(rich_content, content, noteId);
    const r = db.prepare('SELECT * FROM notes WHERE id=?').get(noteId);
    saveSideEffects(r, note.title);
    return r;
  })();
  afterNoteSaved(row, userId);
  notifyMentions(row, note.content, userId);
  notifyWorkspace(row.workspace_id, userId, sendTo);
});

function createConflictCopy(original, edited, opId) {
  return db.transaction(() => {
    // Retried conflicting save: return the copy made the first time.
    if (opId) {
      const existing = db.prepare('SELECT * FROM notes WHERE last_op_id=? AND id<>?').get(opId, original.id);
      if (existing) return existing;
    }
    const id = uuid();
    const title = `${edited.title} (conflict copy)`;
    db.prepare(`INSERT INTO notes (id,workspace_id,parent_id,title,content,position,tags,editor_mode,note_type,canvas_data,rich_content,last_op_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, original.workspace_id, original.parent_id, title, edited.content, original.position + 1, edited.tags,
        edited.editor_mode, edited.note_type, edited.canvas_data, edited.rich_content, opId);
    const copy = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    saveSideEffects(copy);
    return copy;
  })();
}

// ─────────────────────────────── Trash ───────────────────────────────

const now = () => Math.floor(Date.now() / 1000);

/** Remove notes for good, with their attachment files. */
function destroy(ids) {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const files = db.prepare(`SELECT filename FROM attachments WHERE note_id IN (${placeholders})`).all(...ids).map(r => r.filename);
  db.transaction(() => { db.prepare(`DELETE FROM notes WHERE id IN (${placeholders})`).run(...ids); })();
  removeUploadFiles(files);
}

/**
 * Take notes out of the Trash: the whole group deleted together with `rootId`, or (when rootId
 * is null) just `singleId`. A note whose parent is gone or still in the Trash goes to the top level.
 */
function restoreFromTrash(rootId, singleId = null, keepVersionId = null) {
  return db.transaction(() => {
    const rows = rootId
      ? db.prepare('SELECT * FROM notes WHERE trash_root=?').all(rootId)
      : db.prepare('SELECT * FROM notes WHERE id=?').all(singleId);
    const ids = new Set(rows.map(r => r.id));
    for (const r of rows) {
      let parentId = r.parent_id;
      if (parentId && !ids.has(parentId)) {
        const parent = db.prepare('SELECT deleted_at FROM notes WHERE id=?').get(parentId);
        if (!parent || parent.deleted_at) parentId = null;
      }
      let position = r.position;
      if (parentId !== r.parent_id) {
        position = (db.prepare('SELECT MAX(position) AS m FROM notes WHERE workspace_id=? AND parent_id IS NULL AND deleted_at IS NULL').get(r.workspace_id).m ?? -1) + 1;
      }
      // version+1 so every device downloads it again (except a note being edited right now,
      // whose edit bumps it anyway and must not look like a conflicting change)
      db.prepare('UPDATE notes SET deleted_at=NULL, trash_root=NULL, parent_id=?, position=?, version=version+? WHERE id=?')
        .run(parentId, position, r.id === keepVersionId ? 0 : 1, r.id);
    }
    // Links to and from these notes work again
    for (const r of rows) syncLinks(db.prepare('SELECT * FROM notes WHERE id=?').get(r.id));
    if (rows[0]) relinkNotesMentioning(rows[0].workspace_id, rows.map(r => r.title));
    return [...ids];
  })();
}

// Delete a note: it and everything nested under it go to the Trash for TRASH_DAYS.
router.delete('/:id', (req, res) => {
  const note = getOwnedNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (note.deleted_at) return res.json({ ok: true, deleted: [] });
  const ids = subtreeIds(note.id).filter(id => !db.prepare('SELECT deleted_at FROM notes WHERE id=?').get(id).deleted_at);
  const placeholders = ids.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`UPDATE notes SET deleted_at=?, trash_root=? WHERE id IN (${placeholders})`).run(now(), note.id, ...ids);
    // Links pointing at these notes no longer resolve
    relinkNotesMentioning(note.workspace_id, db.prepare(`SELECT title FROM notes WHERE id IN (${placeholders})`).all(...ids).map(r => r.title));
  })();
  logActivity({ workspace_id: note.workspace_id, note_id: note.id, user_id: req.user.id, kind: 'deleted', title: note.title, detail: ids.length > 1 ? `${ids.length - 1} sub-note${ids.length === 2 ? '' : 's'} too` : null });
  res.json({ ok: true, deleted: ids, trash_days: TRASH_DAYS });
});

// What's in the Trash: one entry per deleted note (its sub-notes are counted with it)
router.get('/workspace/:wsId/trash', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const roots = db.prepare(`SELECT * FROM notes WHERE workspace_id=? AND deleted_at IS NOT NULL AND trash_root=id ORDER BY deleted_at DESC`).all(req.params.wsId);
  const count = db.prepare('SELECT COUNT(*) AS c FROM notes WHERE trash_root=? AND id<>?');
  const items = roots.map(n => ({
    id: n.id, title: n.title, note_type: n.note_type, deleted_at: n.deleted_at,
    purge_at: n.deleted_at + TRASH_DAYS * 86400,
    children: count.get(n.id, n.id).c,
    excerpt: (n.editor_mode === 'rich' && n.rich_content ? n.rich_content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : (n.content || '')).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|[\]-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
  }));
  res.json({ items, trash_days: TRASH_DAYS });
});

// Send a copy of a template to someone else on this server: it lands in the "Templates" folder of
// their first workspace (created if needed), named "<title> (from <sender>)" if they already have one.
router.post('/:id/send-template', (req, res) => {
  const note = getOwnedNote(req.params.id, req.user.id);
  if (!note || note.deleted_at) return res.status(404).json({ error: 'Not found — if you just made this template, wait for it to sync and try again' });
  const to = String(req.body?.user_id || '');
  if (!to || to === req.user.id) return res.status(400).json({ error: 'Pick someone else' });
  const person = db.prepare('SELECT id, COALESCE(display_name, username) AS name FROM users WHERE id=?').get(to);
  if (!person) return res.status(404).json({ error: 'That person isn’t on this server' });
  const ws = db.prepare('SELECT id FROM workspaces WHERE user_id=? ORDER BY created_at LIMIT 1').get(to);
  if (!ws) return res.status(400).json({ error: `${person.name} has no workspace yet` });
  const sender = db.prepare('SELECT COALESCE(display_name, username) AS name FROM users WHERE id=?').get(req.user.id).name;
  const created = db.transaction(() => {
    let folder = db.prepare("SELECT * FROM notes WHERE workspace_id=? AND parent_id IS NULL AND title='Templates' AND deleted_at IS NULL").get(ws.id);
    const insert = (id, parent, title, content, rich, mode, tags) => {
      const pos = (db.prepare('SELECT MAX(position) AS m FROM notes WHERE workspace_id=? AND parent_id IS ?').get(ws.id, parent).m ?? -1) + 1;
      db.prepare(`INSERT INTO notes (id,workspace_id,parent_id,title,content,position,note_type,canvas_data,rich_content,editor_mode,tags)
        VALUES (?,?,?,?,?,?,'note',NULL,?,?,?)`).run(id, ws.id, parent, title, content, pos, rich, mode, JSON.stringify(tags));
      const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
      saveSideEffects(row);
      return row;
    };
    if (!folder) {
      folder = insert(uuid(), null, 'Templates',
        'Templates for new notes. Each note in here is a template: write it like any note, and use fill-in fields like {{date}}, {{time}} or {{title}}. Use a template with + → From a template, or /template inside a note.',
        null, 'markdown', []);
    }
    const taken = new Set(db.prepare('SELECT lower(title) AS t FROM notes WHERE workspace_id=? AND deleted_at IS NULL').all(ws.id).map(r => r.t));
    let title = note.title;
    if (taken.has(title.toLowerCase())) title = `${note.title} (from ${sender})`;
    for (let i = 2; taken.has(title.toLowerCase()); i++) title = `${note.title} (from ${sender} ${i})`;
    let tags = [];
    try { tags = JSON.parse(note.tags || '[]'); } catch { /* none */ }
    if (!tags.includes('template')) tags.unshift('template');
    return insert(uuid(), folder.id, title, note.content || '', note.rich_content, note.editor_mode || 'rich', tags);
  })();
  sendTo([to], 'template:received', { title: created.title, from: sender });
  res.json({ title: created.title, to: person.name });
});

router.post('/:id/restore', (req, res) => {
  const note = getOwnedNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (!note.deleted_at) return res.json({ ok: true, restored: [] });
  const restored = restoreFromTrash(note.trash_root === note.id ? note.id : null, note.id);
  logActivity({ workspace_id: note.workspace_id, note_id: note.id, user_id: req.user.id, kind: 'restored', title: note.title });
  res.json({ ok: true, restored });
});

// Delete forever (only from the Trash)
router.delete('/:id/permanent', (req, res) => {
  const note = getOwnedNote(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (!note.deleted_at) return res.status(400).json({ error: 'Move the note to the Trash first' });
  const ids = note.trash_root === note.id
    ? db.prepare('SELECT id FROM notes WHERE trash_root=?').all(note.id).map(r => r.id)
    : [note.id];
  destroy(ids);
  res.json({ ok: true, deleted: ids });
});

router.delete('/workspace/:wsId/trash', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id, 'edit')) return res.status(404).json({ error: 'Not found' });
  const ids = db.prepare('SELECT id FROM notes WHERE workspace_id=? AND deleted_at IS NOT NULL').all(req.params.wsId).map(r => r.id);
  destroy(ids);
  res.json({ ok: true, deleted: ids.length });
});

/** Delete notes that have been in the Trash longer than TRASH_DAYS. */
export function purgeTrash() {
  const cutoff = now() - TRASH_DAYS * 86400;
  const ids = db.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff).map(r => r.id);
  destroy(ids);
  if (ids.length) console.log(`🗑️  Removed ${ids.length} note(s) that were in the Trash for over ${TRASH_DAYS} days`);
  return ids.length;
}

export default router;
