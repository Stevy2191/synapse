import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ChevronRight, Plus, Trash2, FileText, GitFork, Pencil, ChevronsUpDown, Check,
  Search, Network, ListTodo, Trash2 as TrashIcon, Settings2, PanelLeftClose, Cloud, CloudOff, RefreshCw,
} from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import toast from 'react-hot-toast';
import NewNoteModal from '../editor/NewNoteModal';
import Logo from '../Logo';
import { UserAvatar, WorkspaceIcon, displayName } from '../Avatar';
import { EmojiButton } from '../EmojiPicker';
import { openNote, createNote as createLocalNote, deleteNote, moveNote, syncNow, undoDelete, fetchTrash } from '../../offline/sync';
import { listTasks, isoDay } from '../../offline/tasks';
import { kindInfo, datedName } from '../noteKinds';


function countDescendants(id, notes) {
  const kids = notes.filter(n => n.parent_id === id);
  return kids.reduce((sum, k) => sum + 1 + countDescendants(k.id, notes), 0);
}

// ── Drag and drop ──
// The note being dragged. (dataTransfer can't be read during dragover, so keep it here.)
let draggingId = null;

function isWithin(id, ancestorId, notes) {
  const byId = new Map(notes.map(n => [n.id, n]));
  for (let cur = byId.get(id); cur; cur = byId.get(cur.parent_id)) if (cur.id === ancestorId) return true;
  return false;
}

// Top quarter of a row = before, bottom quarter = after, middle = inside.
function dropZone(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
}

async function drop(targetId, where) {
  const id = draggingId;
  draggingId = null;
  if (!id) return;
  const ok = await moveNote(id, targetId, where);
  if (!ok) toast.error("A note can't be moved inside itself");
}

function NoteItem({ note, notes, depth = 0, onSelect, activeId, onAddChild }) {
  const [expanded, setExpanded] = useState(true);
  const [hint, setHint] = useState(null); // 'before' | 'after' | 'inside' while something is dragged over
  const [dragging, setDragging] = useState(false);
  const expandTimer = useRef(null);
  const removeNoteFromTree = useStore(s => s.removeNoteFromTree);

  const children = notes.filter(n => n.parent_id === note.id);
  const hasChildren = children.length > 0;
  const kind = kindInfo(note);
  const Icon = kind.icon;
  const untitled = /^untitled\b/i.test(note.title.trim());
  const active = activeId === note.id;

  // Deleting moves the note (and anything inside it) to the Trash, with an Undo.
  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      const inside = hasChildren ? countDescendants(note.id, notes) : 0;
      removeNoteFromTree(await deleteNote(note.id));
      toast(t => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Moved “{note.title}”{inside ? ` and ${inside} inside it` : ''} to the Trash</span>
          <button className="btn-ghost on" style={{ padding: '0 10px', height: 28 }} onClick={async () => {
            toast.dismiss(t.id);
            try {
              if (await undoDelete(note.id)) toast.success('Restored');
              else toast('You’re offline — restore it from the Trash when you’re back online.', { icon: '🗑️' });
            } catch { toast.error('Couldn’t restore it — try from the Trash'); }
          }}>Undo</button>
        </span>
      ), { icon: '🗑️', duration: 6000 });
      window.dispatchEvent(new Event('synapse:trash-changed'));
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      <div
        className={`tree-row nav-item${active ? ' on' : ''}${hint ? ` drop-${hint}` : ''}`}
        onClick={() => onSelect(note.id)}
        style={{ paddingLeft: 6 + depth * 14, gap: 4, opacity: dragging ? 0.4 : 1 }}
        role="button"
        draggable
        onDragStart={e => {
          draggingId = note.id;
          setDragging(true);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', note.title);
        }}
        onDragEnd={() => { draggingId = null; setDragging(false); setHint(null); }}
        onDragOver={e => {
          if (!draggingId || isWithin(note.id, draggingId, notes)) return; // can't drop into itself
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const zone = dropZone(e);
          if (zone !== hint) setHint(zone);
          // Hovering over a collapsed note opens it, so you can drop deeper.
          if (zone === 'inside' && hasChildren && !expanded && !expandTimer.current) {
            expandTimer.current = setTimeout(() => { setExpanded(true); expandTimer.current = null; }, 600);
          }
        }}
        onDragLeave={() => { setHint(null); clearTimeout(expandTimer.current); expandTimer.current = null; }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const zone = dropZone(e);
          setHint(null);
          if (zone === 'inside') setExpanded(true);
          drop(note.id, zone);
        }}
      >
        <span
          onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
          style={{ display: 'flex', width: 16, justifyContent: 'center', color: 'var(--text-muted)', visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          <ChevronRight size={13} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        </span>
        <Icon size={14} style={{ flexShrink: 0, color: kind.color || (active ? 'var(--accent)' : 'var(--text-muted)') }} aria-label={kind.label} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4 }}
          title={kind.key === 'note' ? note.title : `${note.title} — ${kind.key === 'drawio' || kind.key === 'excalidraw' ? `note with a ${kind.label}` : kind.label}`}>
          {note.title}
          {/* "Untitled" says nothing about what's inside, so say what kind it is */}
          {untitled && kind.key !== 'note' && <span className="tree-kind"> · {kind.label}</span>}
        </span>
        <span className="note-actions" style={{ display: 'flex', gap: 1 }}>
          <button onClick={e => { e.stopPropagation(); onAddChild(note.id); }} className="btn-ghost" style={miniBtn} title="Add a note inside"><Plus size={13} /></button>
          <button onClick={handleDelete} className="btn-ghost" style={{ ...miniBtn, color: 'var(--danger)' }} title="Move to Trash"><Trash2 size={12} /></button>
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
        <WorkspaceIcon workspace={activeWorkspace} size={22} />
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeWorkspace?.name || 'Workspace'}
        </span>
        <ChevronsUpDown size={13} style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div className="card fade-in" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, padding: 5, boxShadow: 'var(--shadow)', background: 'var(--bg-elevated)' }}>
          {workspaces.map(ws => (
            <button key={ws.id} className="nav-item" onClick={() => { setActiveWorkspace(ws); setOpen(false); }}>
              <WorkspaceIcon workspace={ws} size={18} />
              <span style={{ flex: 1 }}>{ws.name}</span>
              {activeWorkspace?.id === ws.id && <Check size={13} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
          <button className="nav-item" onClick={() => { setOpen(false); useStore.getState().setSettingsOpen('ws-general'); }} style={{ color: 'var(--text-secondary)' }}>
            <Settings2 size={14} /> Workspace settings
          </button>
          {creating ? (
            <div style={{ display: 'flex', gap: 5, padding: 3 }}>
              <EmojiButton value={icon} onChange={setIcon} size={32} />
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
  const [rootHint, setRootHint] = useState(false);

  const roots = notes.filter(n => !n.parent_id);

  const selectNote = useCallback(async (id) => {
    await openNote(id);
    if (view === 'graph' || view === 'tasks' || view === 'trash') setView('editor');
    onNavigate?.();
  }, [view, setView, onNavigate]);

  // How many notes are in the Trash (it lives on the server)
  const [trashCount, setTrashCount] = useState(null);
  useEffect(() => {
    if (!activeWorkspace) return undefined;
    let cancelled = false;
    const load = () => fetchTrash(activeWorkspace.id).then(d => { if (!cancelled) setTrashCount(d.items.length); }).catch(() => {});
    load();
    window.addEventListener('synapse:trash-changed', load);
    window.addEventListener('online', load);
    return () => { cancelled = true; window.removeEventListener('synapse:trash-changed', load); window.removeEventListener('online', load); };
  }, [activeWorkspace?.id]);

  // Tasks due today or overdue, for the badge next to "Tasks"
  const [dueCount, setDueCount] = useState(0);
  useEffect(() => {
    if (!activeWorkspace) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      const today = isoDay();
      const n = (await listTasks(activeWorkspace.id)).filter(x => !x.done && x.due && x.due <= today).length;
      if (!cancelled) setDueCount(n);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeWorkspace?.id, notes]);

  const createNote = async (type, parentId = null) => {
    if (!activeWorkspace) return;
    // Flowcharts and Free Draw pages start with a dated name ("Drawing – Nov 4"); text notes are named as you write.
    const word = { diagram: 'Flowchart', draw: 'Drawing' }[type];
    const title = word ? datedName(word, notes.map(n => n.title)) : 'Untitled';
    try {
      const note = await createLocalNote({ workspace_id: activeWorkspace.id, parent_id: parentId, title, note_type: type });
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
        <button className={`nav-item${view === 'tasks' ? ' on' : ''}`} onClick={() => { setView(view === 'tasks' ? 'editor' : 'tasks'); onNavigate?.(); }}>
          <ListTodo size={14} /> Tasks
          {dueCount > 0 && <span className="nav-badge" title="Due today or overdue">{dueCount}</span>}
        </button>
      </div>

      {/* Notes tree */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 12px 6px 19px' }}>
        <span className="section-label">Notes</span>
        <button onClick={() => newNote()} disabled={!activeWorkspace} className="btn-ghost" style={miniBtn} title="New note"><Plus size={14} /></button>
      </div>
      <div
        className={rootHint ? 'drop-root' : ''}
        style={{ flex: 1, overflow: 'auto', padding: '0 10px 10px' }}
        onDragOver={e => { if (!draggingId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setRootHint(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setRootHint(false); }}
        onDrop={e => { e.preventDefault(); setRootHint(false); drop(null, 'root'); }}
      >
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

      {/* Trash, just above the footer */}
      <div style={{ padding: '6px 10px 4px', borderTop: '1px solid var(--border-subtle)' }}>
        <button className={`nav-item${view === 'trash' ? ' on' : ''}`} onClick={() => { setView(view === 'trash' ? 'editor' : 'trash'); onNavigate?.(); }}>
          <TrashIcon size={14} /> Trash
          {trashCount > 0 && <span className="nav-count" title="Notes in the Trash">{trashCount}</span>}
        </button>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px calc(12px + env(safe-area-inset-bottom, 0px))' }}>
        <SyncStatus />
        <div style={{ flex: 1 }} />
        {/* You: opens Settings (account, workspace and, for admins, server) */}
        <button onClick={() => setSettingsOpen('profile')} title="Settings" className="btn-ghost account-button" style={{
          height: 36, padding: '0 6px 0 4px', gap: 8, maxWidth: 150, borderRadius: 99,
        }}>
          <UserAvatar user={user} size={28} style={{ boxShadow: 'var(--glow)' }} />
          <span className="sync-label" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName(user)}
          </span>
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
