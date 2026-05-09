import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Verify workspace belongs to user
function getWorkspace(wsId, userId) {
  return db.prepare('SELECT * FROM workspaces WHERE id=? AND user_id=?').get(wsId, userId);
}

// Parse [[links]] from content and sync note_links table
function syncLinks(noteId, content, workspaceId) {
  const pattern = /\[\[([^\]]+)\]\]/g;
  const titles = [];
  let m;
  while ((m = pattern.exec(content)) !== null) titles.push(m[1]);

  db.prepare('DELETE FROM note_links WHERE source_id=?').run(noteId);

  for (const title of titles) {
    const target = db.prepare('SELECT id FROM notes WHERE workspace_id=? AND title=?').get(workspaceId, title);
    if (target && target.id !== noteId) {
      const existing = db.prepare('SELECT id FROM note_links WHERE source_id=? AND target_id=?').get(noteId, target.id);
      if (!existing) {
        db.prepare('INSERT INTO note_links (id,source_id,target_id,workspace_id) VALUES (?,?,?,?)').run(uuid(), noteId, target.id, workspaceId);
      }
    }
  }
}

// Get all notes in workspace (tree structure)
router.get('/workspace/:wsId', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Workspace not found' });
  const notes = db.prepare('SELECT id,parent_id,title,tags,position,created_at,updated_at FROM notes WHERE workspace_id=? ORDER BY position,created_at').all(req.params.wsId);
  res.json({ notes });
});

// Get single note with content
router.get('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (!getWorkspace(note.workspace_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });

  const links = db.prepare(`
    SELECT n.id, n.title, 'outgoing' as direction FROM note_links nl 
    JOIN notes n ON n.id = nl.target_id WHERE nl.source_id=?
    UNION
    SELECT n.id, n.title, 'incoming' as direction FROM note_links nl 
    JOIN notes n ON n.id = nl.source_id WHERE nl.target_id=?
  `).all(note.id, note.id);

  const attachments = db.prepare('SELECT id,filename,original_name,mime_type,size,created_at FROM attachments WHERE note_id=?').all(note.id);

  res.json({ note, links, attachments });
});

// Create note
router.post('/', (req, res) => {
  const { workspace_id, parent_id = null, title = 'Untitled', content = '', note_type = 'note', canvas_data = null } = req.body;
  if (!workspace_id) return res.status(400).json({ error: 'workspace_id required' });
  if (!getWorkspace(workspace_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM notes WHERE workspace_id=? AND parent_id IS ?').get(workspace_id, parent_id);
  const position = (maxPos.m ?? -1) + 1;

  const id = uuid();
  db.prepare('INSERT INTO notes (id,workspace_id,parent_id,title,content,position,note_type,canvas_data) VALUES (?,?,?,?,?,?,?,?)').run(id, workspace_id, parent_id, title, content, position, note_type, canvas_data);
  syncLinks(id, content, workspace_id);

  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
  res.json({ note });
});

// Update note
router.patch('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (!getWorkspace(note.workspace_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });

  const { title, content, parent_id, position, tags, editor_mode, note_type, canvas_data, rich_content } = req.body;
  const newTitle = title !== undefined ? title : note.title;
  const newContent = content !== undefined ? content : note.content;
  const newTags = tags !== undefined ? JSON.stringify(tags) : note.tags;
  const newMode = editor_mode !== undefined ? editor_mode : note.editor_mode;
  const newType = note_type !== undefined ? note_type : note.note_type;
  const newCanvas = canvas_data !== undefined ? canvas_data : note.canvas_data;
  const newRich = rich_content !== undefined ? rich_content : note.rich_content;

  db.prepare(`
    UPDATE notes SET 
      title=?, content=?, 
      parent_id=COALESCE(?,parent_id),
      position=COALESCE(?,position),
      tags=?,
      editor_mode=?,
      note_type=?,
      canvas_data=?,
      rich_content=?,
      updated_at=unixepoch()
    WHERE id=?
  `).run(newTitle, newContent, parent_id !== undefined ? parent_id : null, position !== undefined ? position : null, newTags, newMode, newType, newCanvas, newRich, note.id);

  syncLinks(note.id, newContent, note.workspace_id);
  const updated = db.prepare('SELECT * FROM notes WHERE id=?').get(note.id);
  res.json({ note: updated });
});

// Delete note
router.delete('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  if (!getWorkspace(note.workspace_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM notes WHERE id=?').run(note.id);
  res.json({ ok: true });
});

// Full-text search
router.get('/workspace/:wsId/search', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const q = req.query.q;
  if (!q) return res.json({ results: [] });

  try {
    const results = db.prepare(`
      SELECT n.id, n.title, snippet(notes_fts, 2, '<mark>', '</mark>', '...', 20) as excerpt
      FROM notes_fts 
      JOIN notes n ON n.id = notes_fts.id
      WHERE notes_fts MATCH ? AND n.workspace_id=?
      ORDER BY rank LIMIT 20
    `).all(q + '*', req.params.wsId);
    res.json({ results });
  } catch {
    res.json({ results: [] });
  }
});

// Graph data for workspace
router.get('/workspace/:wsId/graph', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });

  const nodes = db.prepare('SELECT id, title, tags FROM notes WHERE workspace_id=?').all(req.params.wsId);
  const edges = db.prepare('SELECT source_id, target_id FROM note_links WHERE workspace_id=?').all(req.params.wsId);

  res.json({ nodes, edges });
});

// Note title suggestions for [[linking]]
router.get('/workspace/:wsId/titles', (req, res) => {
  if (!getWorkspace(req.params.wsId, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const q = req.query.q || '';
  const titles = db.prepare("SELECT id, title FROM notes WHERE workspace_id=? AND title LIKE ? LIMIT 10").all(req.params.wsId, `%${q}%`);
  res.json({ titles });
});

export default router;
