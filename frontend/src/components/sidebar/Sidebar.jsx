import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronRight, Plus, Trash2, FileText, GitFork, Pencil, ChevronsUpDown, Check,
  Search, Network, Settings, PanelLeftClose, Cloud, CloudOff, RefreshCw,
} from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';
import NewNoteModal from '../editor/NewNoteModal';
import Logo from '../Logo';
import { openNote, createNote as createLocalNote, deleteNote, syncNow } from '../../offline/sync';

const TYPE_ICONS = { note: FileText, diagram: GitFork, draw: Pencil };

function countDescendants(id, notes) {
  const kids = notes.filter(n => n.parent_id === id);
  return kids.reduce((sum, k) => sum + 1 + countDescendants(k.id, notes), 0);
}

function NoteItem({ note, notes, depth = 0, onSelect, activeId, onAddChild }) {
  const [expanded, setExpanded] = useState(true);
  const removeNoteFromTree = useStore(s => s.removeNoteFromTree);

  const children = notes.filter(n => n.parent_id === note.id);
  const hasChildren = children.length > 0;
  const Icon = TYPE_ICONS[note.note_type] || FileText;
  const active = activeId === note.id;

  const handleDelete = async (e) => {
    e.stopPropagation();
    const message = hasChildren
      ? `Delete "${note.title}" and the ${countDescendants(note.id, notes)} note(s) inside it?`
      : `Delete "${note.title}"?`;
    if (!confirm(message)) return;
    try {
      removeNoteFromTree(await deleteNote(note.id));
      toast.success('Note deleted');
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      <div
        className={`tree-row nav-item${active ? ' on' : ''}`}
        onClick={() => onSelect(note.id)}
        style={{ paddingLeft: 6 + depth * 14, gap: 4 }}
        role="button"
      >
        <span
          onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
          style={{ display: 'flex', width: 16, justifyContent: 'center', color: 'var(--text-muted)', visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        </span>
        <Icon size={14} style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4 }}>{note.title}</span>
        <span className="note-actions" style={{ display: 'flex', gap: 1 }}>
          <button onClick={e => { e.stopPropagation(); onAddChild(note.id); }} className="btn-ghost" style={miniBtn} title="Add a note inside"><Plus size={13} /></button>
          <button onClick={handleDelete} className="btn-ghost" style={{ ...miniBtn, color: 'var(--danger)' }} title="Delete"><Trash2 size={12} /></button>
        </span>
      </div>
      {expanded && children.map(child => (
        <NoteItem key={child.id} note={child} notes={notes} depth={depth + 1} onSelect={onSelect} activeId={activeId} onAddChild={onAddChild} />
      ))}
    </div>
  );
}

function WorkspacePicker() {
  const { workspaces, activeWorkspace, setActiveWorkspace, setWorkspaces } = useStore(s => ({
    workspaces: s.workspaces, activeWorkspace: s.activeWorkspace,
    setActiveWorkspace: s.setActiveWorkspace, setWorkspaces: s.setWorkspaces,
  }));
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setCreating(false); } };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const { data } = await api.post('/workspaces', { name, icon });
      setWorkspaces([...workspaces, data.workspace]);
      setActiveWorkspace(data.workspace);
      setOpen(false); setCreating(false); setName(''); setIcon('📁');
      syncNow();
    } catch (err) {
      toast.error(err.response ? 'Failed to create workspace' : 'Creating a workspace needs a connection');
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} className="card" style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 9px', cursor: 'pointer',
        color: 'var(--text-primary)', font: '500 13px var(--font-sans)', background: 'var(--bg-elevated)',
      }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 13, background: 'var(--accent-subtle)' }}>
          {activeWorkspace?.icon || '📁'}
        </span>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeWorkspace?.name || 'Workspace'}
        </span>
        <ChevronsUpDown size={13} style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div className="card fade-in" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, padding: 5, boxShadow: 'var(--shadow)', background: 'var(--bg-elevated)' }}>
          {workspaces.map(ws => (
            <button key={ws.id} className="nav-item" onClick={() => { setActiveWorkspace(ws); setOpen(false); }}>
              <span style={{ width: 18, textAlign: 'center' }}>{ws.icon}</span>
              <span style={{ flex: 1 }}>{ws.name}</span>
              {activeWorkspace?.id === ws.id && <Check size={13} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
          {creating ? (
            <div style={{ display: 'flex', gap: 5, padding: 3 }}>
              <input value={icon} onChange={e => setIcon(e.target.value)} style={{ ...miniInput, width: 38, textAlign: 'center' }} />
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Workspace name" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
                style={{ ...miniInput, flex: 1, minWidth: 0 }} />
            </div>
          ) : (
            <button className="nav-item" onClick={() => setCreating(true)} style={{ color: 'var(--text-muted)' }}>
              <Plus size={14} /> New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SyncStatus() {
  const sync = useStore(s => s.sync);
  let Icon = Cloud, label = 'Synced', color = 'var(--text-muted)', dot = 'var(--success)';
  let title = sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : 'Synced';
  if (!sync.online) {
    Icon = CloudOff; color = 'var(--warning)'; dot = 'var(--warning)';
    label = sync.pending > 0 ? `Offline · ${sync.pending} waiting` : 'Offline';
    title = 'You can keep working. Changes are saved on this device and upload when you reconnect.';
  } else if (sync.syncing || sync.pending > 0) {
    Icon = RefreshCw; dot = 'var(--accent)';
    label = sync.pending > 0 ? `Syncing ${sync.pending}…` : 'Syncing…';
    title = 'Uploading changes';
  }
  return (
    <button onClick={() => syncNow()} className="btn-ghost" title={`${title}\nClick to sync now.`} style={{ color, padding: '0 6px', gap: 7 }}>
      {Icon === RefreshCw
        ? <RefreshCw size={12} className="spin" />
        : <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, boxShadow: sync.online ? `0 0 6px ${dot}` : 'none' }} />}
      <span className="sync-label">{label}</span>
    </button>
  );
}

export default function Sidebar({ width, onNavigate }) {
  const { notes, activeNote, activeWorkspace, view, setView, setSearchOpen, setSettingsOpen, setSidebarOpen, user } = useStore(s => ({
    notes: s.notes, activeNote: s.activeNote, activeWorkspace: s.activeWorkspace,
    view: s.view, setView: s.setView, setSearchOpen: s.setSearchOpen,
    setSettingsOpen: s.setSettingsOpen, setSidebarOpen: s.setSidebarOpen, user: s.user,
  }));
  const [showNewNote, setShowNewNote] = useState(false);
  const [pendingParent, setPendingParent] = useState(null);

  const roots = notes.filter(n => !n.parent_id);

  const selectNote = useCallback(async (id) => {
    await openNote(id);
    if (view === 'graph') setView('editor');
    onNavigate?.();
  }, [view, setView, onNavigate]);

  const createNote = async (type, parentId = null) => {
    if (!activeWorkspace) return;
    const titles = { note: 'Untitled', diagram: 'New Diagram', draw: 'New Drawing' };
    try {
      const note = await createLocalNote({ workspace_id: activeWorkspace.id, parent_id: parentId, title: titles[type] || 'Untitled', note_type: type });
      selectNote(note.id);
    } catch { toast.error('Failed to create note'); }
  };

  const newNote = (parentId = null) => { setPendingParent(parentId); setShowNewNote(true); };

  return (
    <aside style={{
      width, height: '100%', display: 'flex', flexDirection: 'column', flexShrink: 0,
      background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', overflow: 'hidden',
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 12px 12px 16px' }}>
        <Logo size={26} style={{ filter: 'drop-shadow(var(--glow))' }} />
        <span style={{ font: '700 16px var(--font-display)', letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>Synapse</span>
        <button onClick={() => setSidebarOpen(false)} className="btn-ghost" style={{ marginLeft: 'auto' }} title="Hide sidebar">
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <WorkspacePicker />
        <div style={{ height: 8 }} />
        <button className="nav-item" onClick={() => setSearchOpen(true)}>
          <Search size={14} /> Search <kbd>Ctrl K</kbd>
        </button>
        <button className={`nav-item${view === 'graph' ? ' on' : ''}`} onClick={() => { setView(view === 'graph' ? 'editor' : 'graph'); onNavigate?.(); }}>
          <Network size={14} /> Graph
        </button>
      </div>

      {/* Notes tree */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 12px 6px 19px' }}>
        <span className="section-label">Notes</span>
        <button onClick={() => newNote()} disabled={!activeWorkspace} className="btn-ghost" style={miniBtn} title="New note"><Plus size={14} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 10px 10px' }}>
        {!activeWorkspace ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>Loading…</p>
        ) : roots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 12px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>No notes yet</p>
            <button onClick={() => newNote()} style={primaryBtn}><Plus size={14} /> New note</button>
          </div>
        ) : (
          roots.map(note => (
            <NoteItem key={note.id} note={note} notes={notes} onSelect={selectNote} activeId={activeNote?.note?.id} onAddChild={newNote} />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 10px 12px', borderTop: '1px solid var(--border-subtle)' }}>
        <SyncStatus />
        <div style={{ flex: 1 }} />
        <button onClick={() => setSettingsOpen(true)} className="btn-ghost" title="Settings"><Settings size={15} /></button>
        <button onClick={() => setSettingsOpen(true)} title={user?.username} style={{
          width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', color: '#fff',
          font: '700 12px var(--font-sans)', boxShadow: 'var(--glow)',
        }}>
          {user?.username?.[0]?.toUpperCase()}
        </button>
      </div>

      {showNewNote && (
        <NewNoteModal
          onSelect={(type) => { setShowNewNote(false); createNote(type, pendingParent); }}
          onClose={() => setShowNewNote(false)}
        />
      )}
    </aside>
  );
}

const miniBtn = { height: 22, minWidth: 22, padding: 0, borderRadius: 5 };
const miniInput = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)',
  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none',
};
const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none',
  background: 'var(--accent)', color: '#fff', font: '600 12.5px var(--font-sans)', cursor: 'pointer', boxShadow: 'var(--glow)',
};
