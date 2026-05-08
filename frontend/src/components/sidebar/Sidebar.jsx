import { useState, useCallback } from 'react';
import { ChevronRight, Plus, Trash2, FileText, ChevronDown, FolderOpen, Folder } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';
import NewNoteModal from '../editor/NewNoteModal';

function NoteItem({ note, notes, depth = 0, onSelect, activeId, onAddChild }) {
  const [expanded, setExpanded] = useState(true);
  const { removeNoteFromTree, activeWorkspace } = useStore(s => ({
    removeNoteFromTree: s.removeNoteFromTree,
    activeWorkspace: s.activeWorkspace
  }));
  const addNoteToTree = useStore(s => s.addNoteToTree);
  const setActiveNote = useStore(s => s.setActiveNote);

  const children = notes.filter(n => n.parent_id === note.id);
  const hasChildren = children.length > 0;

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${note.title}"?`)) return;
    try {
      await api.delete(`/notes/${note.id}`);
      removeNoteFromTree(note.id);
      toast.success('Note deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleAddChild = (e) => {
    e.stopPropagation();
    if (onAddChild) onAddChild(note.id);
  };

  return (
    <div>
      <div
        onClick={() => onSelect(note.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: `5px 8px 5px ${8 + depth * 16}px`,
          cursor: 'pointer', borderRadius: 6, margin: '1px 4px', userSelect: 'none',
          background: activeId === note.id ? 'var(--accent-subtle)' : 'transparent',
          color: activeId === note.id ? 'var(--accent-hover)' : 'var(--text-primary)',
          transition: 'all 0.15s', fontSize: 13
        }}
        className="group"
        onMouseEnter={e => { if (activeId !== note.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (activeId !== note.id) e.currentTarget.style.background = 'transparent'; }}
      >
        <span
          onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
          style={{ display: 'flex', alignItems: 'center', width: 14, flexShrink: 0, color: 'var(--text-muted)', opacity: hasChildren ? 1 : 0 }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--text-muted)' }}>
          {hasChildren ? (expanded ? <FolderOpen size={13} /> : <Folder size={13} />) : <FileText size={13} />}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.title}</span>
        <span style={{ display: 'flex', gap: 2, opacity: 0 }} className="note-actions">
          <button onClick={handleAddChild} style={iconBtn} title="Add child note"><Plus size={11} /></button>
          <button onClick={handleDelete} style={{ ...iconBtn, color: 'var(--danger)' }} title="Delete"><Trash2 size={11} /></button>
        </span>
      </div>
      {expanded && children.map(child => (
        <NoteItem key={child.id} note={child} notes={notes} depth={depth + 1} onSelect={onSelect} activeId={activeId} onAddChild={onAddChild} />
      ))}
      <style>{`.group:hover .note-actions { opacity: 1 !important; }`}</style>
    </div>
  );
}

export default function Sidebar({ width }) {
  const { notes, activeNote, activeWorkspace, workspaces, setActiveWorkspace, setActiveNote, addNoteToTree } = useStore(s => ({
    notes: s.notes, activeNote: s.activeNote, activeWorkspace: s.activeWorkspace,
    workspaces: s.workspaces, setActiveWorkspace: s.setActiveWorkspace,
    setActiveNote: s.setActiveNote, addNoteToTree: s.addNoteToTree
  }));

  const [newWs, setNewWs] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsIcon, setWsIcon] = useState('📁');
  const [showNewNote, setShowNewNote] = useState(false);
  const [pendingParent, setPendingParent] = useState(null);
  const setWorkspaces = useStore(s => s.setWorkspaces);

  const roots = notes.filter(n => !n.parent_id);

  const selectNote = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/notes/${id}`);
      setActiveNote(data);
    } catch { toast.error('Failed to load note'); }
  }, [setActiveNote]);

  const createNote = async (type, parentId = null) => {
    if (!activeWorkspace) return;
    const titles = { note: 'Untitled', diagram: 'New Diagram', draw: 'New Drawing' };
    try {
      const { data } = await api.post('/notes', { workspace_id: activeWorkspace.id, parent_id: parentId, title: titles[type] || 'Untitled', note_type: type });
      addNoteToTree(data.note);
      selectNote(data.note.id);
    } catch { toast.error('Failed to create note'); }
  };

  const createRoot = () => { setPendingParent(null); setShowNewNote(true); };

  const createWorkspace = async () => {
    if (!wsName.trim()) return;
    try {
      const { data } = await api.post('/workspaces', { name: wsName, icon: wsIcon });
      setWorkspaces([...workspaces, data.workspace]);
      setActiveWorkspace(data.workspace);
      setNewWs(false); setWsName(''); setWsIcon('📁');
    } catch { toast.error('Failed to create workspace'); }
  };

  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', height: '100%', overflow: 'hidden' }}>
      {/* Workspace switcher */}
      <div style={{ padding: '12px 8px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Workspaces</span>
          <button onClick={() => setNewWs(x => !x)} style={{ ...iconBtn, color: 'var(--text-muted)' }}><Plus size={13} /></button>
        </div>
        {workspaces.map(ws => (
          <div key={ws.id} onClick={() => setActiveWorkspace(ws)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
            background: activeWorkspace?.id === ws.id ? 'var(--accent-subtle)' : 'transparent',
            color: activeWorkspace?.id === ws.id ? 'var(--accent-hover)' : 'var(--text-primary)',
            fontSize: 13, fontWeight: 500, transition: 'all 0.15s', marginBottom: 2
          }}
            onMouseEnter={e => { if (activeWorkspace?.id !== ws.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { if (activeWorkspace?.id !== ws.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <span>{ws.icon}</span>
            <span style={{ flex: 1 }}>{ws.name}</span>
            {activeWorkspace?.id === ws.id && (
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: ws.color || 'var(--accent)' }} />
            )}
          </div>
        ))}
        {newWs && (
          <div style={{ padding: '8px 4px' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={wsIcon} onChange={e => setWsIcon(e.target.value)} style={{ ...miniInput, width: 44, textAlign: 'center' }} placeholder="📁" />
              <input value={wsName} onChange={e => setWsName(e.target.value)} style={{ ...miniInput, flex: 1 }} placeholder="Workspace name" onKeyDown={e => e.key === 'Enter' && createWorkspace()} autoFocus />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={createWorkspace} style={smallBtn}>Create</button>
              <button onClick={() => setNewWs(false)} style={{ ...smallBtn, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Notes tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Notes</span>
          <button onClick={createRoot} disabled={!activeWorkspace} style={{ ...iconBtn, color: 'var(--text-muted)' }} title="New note"><Plus size={13} /></button>
        </div>
        {!activeWorkspace ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>Select a workspace</p>
        ) : roots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>No notes yet</p>
            <button onClick={createRoot} style={smallBtn}>+ New Note</button>
          </div>
        ) : (
          roots.map(note => (
            <NoteItem key={note.id} note={note} notes={notes} onSelect={selectNote} activeId={activeNote?.note?.id} onAddChild={(parentId) => { setPendingParent(parentId); setShowNewNote(true); }} />
          ))
        )}
      </div>
      {showNewNote && (
        <NewNoteModal
          onSelect={(type) => { setShowNewNote(false); createNote(type, pendingParent); }}
          onClose={() => setShowNewNote(false)}
        />
      )}
    </div>
  );
}

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4,
  color: 'var(--text-muted)', display: 'flex', alignItems: 'center', transition: 'color 0.15s'
};
const miniInput = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none'
};
const smallBtn = {
  padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)'
};
