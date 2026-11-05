// A folder's page: its description, then what's inside (folders first), with buttons to add
// a note or a folder here and to move things in.
import { useEffect, useRef, useState } from 'react';
import { FolderPlus, Plus, FolderInput, ChevronRight } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { openNote } from '../../offline/sync';
import { kindInfo } from '../noteKinds';
import { newFolder } from '../../folders/folders';

function ago(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(ts * 1000).toLocaleDateString();
}

export default function FolderView({ folder, description, onDescription, readOnly, onNewNote }) {
  const notes = useStore(s => s.notes);
  const [desc, setDesc] = useState(description || '');
  const ta = useRef(null);
  useEffect(() => { setDesc(description || ''); }, [folder.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = notes.filter(n => n.parent_id === folder.id)
    .sort((a, b) => (a.note_type === 'folder' ? 0 : 1) - (b.note_type === 'folder' ? 0 : 1) || a.position - b.position || a.title.localeCompare(b.title));
  const count = id => notes.filter(n => n.parent_id === id).length;

  return (
    <div className="folder-view">
      <textarea ref={ta} className="folder-desc" value={desc} readOnly={readOnly} rows={1}
        placeholder={readOnly ? '' : 'Add a description (optional)…'}
        onChange={e => { setDesc(e.target.value); onDescription(e.target.value); }}
        onInput={e => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }} />

      {!readOnly && (
        <div className="folder-actions">
          <button type="button" className="cp-btn primary" onClick={() => onNewNote(folder.id)}><Plus size={14} /> New note here</button>
          <button type="button" className="cp-btn" onClick={() => newFolder(folder.id)}><FolderPlus size={14} /> New folder here</button>
          <span className="folder-tip">Tip: drag notes onto a folder in the sidebar, or use <FolderInput size={12} /> on a note to move it.</span>
        </div>
      )}

      <div className="folder-list">
        {items.length === 0 && <div className="folder-empty">This folder is empty.</div>}
        {items.map(n => {
          const k = kindInfo(n);
          const Icon = k.icon;
          const isFolder = n.note_type === 'folder';
          return (
            <button key={n.id} type="button" className="folder-item" onClick={() => openNote(n.id)}>
              <Icon size={17} style={{ color: k.color || 'var(--text-muted)', flexShrink: 0 }} />
              <span className="folder-item-title">{n.title}</span>
              <span className="folder-item-meta">{isFolder ? `${count(n.id)} item${count(n.id) === 1 ? '' : 's'}` : `Edited ${ago(n.updated_at)}`}</span>
              {isFolder && <ChevronRight size={14} className="folder-item-go" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
