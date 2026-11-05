// "Move to folder…": pick a folder (or the top level) for a note or folder.
// Opened with useStore.setState({ moveToFolder: noteId }).
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Folder, FolderPlus, Search, CornerLeftUp, Check } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { createNote } from '../../offline/sync';
import { moveToFolder, freeFolderName, setFolderOpen } from '../../folders/folders';

export default function MoveToFolder() {
  const noteId = useStore(s => s.moveToFolder);
  const notes = useStore(s => s.notes);
  const [q, setQ] = useState('');
  const close = () => { useStore.setState({ moveToFolder: null }); setQ(''); };
  const note = notes.find(n => n.id === noteId);

  // Folders as an indented list, leaving out the note itself and anything inside it.
  const rows = useMemo(() => {
    if (!note) return [];
    const inside = new Set([note.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of notes) if (n.parent_id && inside.has(n.parent_id) && !inside.has(n.id)) { inside.add(n.id); grew = true; }
    }
    const folders = notes.filter(n => n.note_type === 'folder' && !inside.has(n.id));
    const byParent = new Map();
    for (const f of folders) {
      const k = folders.some(p => p.id === f.parent_id) ? f.parent_id : null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(f);
    }
    const out = [];
    const walk = (parent, depth, path) => {
      for (const f of (byParent.get(parent) || []).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))) {
        out.push({ ...f, depth, path: [...path, f.title] });
        walk(f.id, depth + 1, [...path, f.title]);
      }
    };
    walk(null, 0, []);
    return out;
  }, [notes, note]);

  useEffect(() => {
    if (!noteId) return undefined;
    const esc = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [noteId]);

  if (!noteId || !note) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter(r => r.path.join(' / ').toLowerCase().includes(needle)) : rows;

  const go = async (folderId, folderTitle) => {
    if ((note.parent_id ?? null) === (folderId ?? null)) { close(); return; }
    const ok = await moveToFolder(note.id, folderId);
    if (!ok) { toast.error('A folder can’t go inside itself'); return; }
    if (folderId) setFolderOpen(folderId, true);
    toast.success(folderId ? `Moved to ${folderTitle}` : 'Moved to the top level');
    close();
  };
  const makeFolder = async () => {
    const ws = useStore.getState().activeWorkspace;
    if (!ws) return;
    const name = (q.trim() || window.prompt('Name of the new folder:', freeFolderName(notes.filter(n => !n.parent_id))) || '').trim();
    if (!name) return;
    const f = await createNote({ workspace_id: ws.id, parent_id: null, title: name, note_type: 'folder', editor_mode: 'markdown' });
    await go(f.id, name);
  };

  return (
    <div className="math-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="math-dialog move-dialog" role="dialog" aria-label="Move to folder">
        <div className="math-dialog-head"><b>Move “{note.title}”</b></div>
        <div className="drawing-picker-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a folder…"
            onKeyDown={e => { if (e.key === 'Enter') { if (shown[0]) go(shown[0].id, shown[0].title); else if (q.trim()) makeFolder(); } }} />
        </div>
        <div className="drawing-picker-list">
          {!needle && (
            <button type="button" onClick={() => go(null)} className={!note.parent_id ? 'here' : ''}>
              <CornerLeftUp size={14} /> Top level (no folder) {!note.parent_id && <Check size={14} className="move-here" />}
            </button>
          )}
          {shown.map(f => (
            <button key={f.id} type="button" onClick={() => go(f.id, f.title)} className={note.parent_id === f.id ? 'here' : ''}
              style={{ paddingLeft: 10 + (needle ? 0 : f.depth * 16) }} title={f.path.join(' / ')}>
              <Folder size={14} style={{ color: '#e3a33b' }} /> {needle ? f.path.join(' / ') : f.title}
              {note.parent_id === f.id && <Check size={14} className="move-here" />}
            </button>
          ))}
          {rows.length === 0 && <div className="drawing-picker-empty">No folders yet.</div>}
          {needle && shown.length === 0 && <div className="drawing-picker-empty">No folder called that.</div>}
          <button type="button" className="new" onClick={makeFolder}><FolderPlus size={14} /> New folder{q.trim() ? ` “${q.trim()}”` : '…'}</button>
        </div>
      </div>
    </div>
  );
}

