// A Free Draw note shown as a picture inside another note ("/" → Embed a drawing).
// Stored by the drawing's title: <div data-drawing="Title"> in the editor, ![[Title]] in Markdown.
import { useEffect, useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { PenTool, Trash2, Search, Plus } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { getWorkspaceNotes, openNote, createNote } from '../../offline/sync';

/** The saved preview picture of the drawing called `title` (or null). */
export async function drawingPreview(workspaceId, title) {
  const all = await getWorkspaceNotes(workspaceId);
  const note = all.find(n => n.note_type === 'draw' && n.title.toLowerCase() === String(title).toLowerCase());
  if (!note) return { note: null, preview: null };
  let preview = null;
  try { preview = JSON.parse(note.canvas_data || '{}').preview || null; } catch { /* ignore */ }
  return { note, preview };
}

function EmbedView({ node, deleteNode, selected, editor }) {
  const title = node.attrs.title;
  const ws = useStore(s => s.activeWorkspace);
  const notes = useStore(s => s.notes); // changes when notes are saved or synced
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    if (!ws) return undefined;
    drawingPreview(ws.id, title).then(r => { if (!cancelled) setState({ loading: false, ...r }); });
    return () => { cancelled = true; };
  }, [ws?.id, title, notes]);

  return (
    <NodeViewWrapper className={`drawing-embed${selected ? ' selected' : ''}`} data-drag-handle="">
      <div className="drawing-embed-frame" onDoubleClick={() => state.note && openNote(state.note.id)}>
        {state.preview ? <img src={state.preview} alt={title} draggable={false} />
          : <div className="drawing-embed-empty">{state.loading ? 'Loading…' : state.note ? 'This drawing is empty — open it to start drawing.' : `No drawing called “${title}”.`}</div>}
      </div>
      <div className="drawing-embed-bar" contentEditable={false}>
        <button type="button" onClick={() => state.note && openNote(state.note.id)} disabled={!state.note} title="Open the drawing">
          <PenTool size={12} /> {title}
        </button>
        {editor.isEditable && <button type="button" className="remove" onClick={deleteNode} title="Remove from this note"><Trash2 size={12} /> Remove</button>}
      </div>
    </NodeViewWrapper>
  );
}

export const DrawingEmbed = Node.create({
  name: 'drawingEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { title: { default: '', parseHTML: el => el.getAttribute('data-drawing') || '', renderHTML: a => ({ 'data-drawing': a.title }) } };
  },
  parseHTML() { return [{ tag: 'div[data-drawing]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes]; },
  addNodeView() { return ReactNodeViewRenderer(EmbedView); },
});

/** Pick a drawing to embed, or make a new one. */
export function DrawingPicker({ onPick, onClose }) {
  const notes = useStore(s => s.notes);
  const ws = useStore(s => s.activeWorkspace);
  const [q, setQ] = useState('');
  const drawings = notes.filter(n => n.note_type === 'draw' && n.title.toLowerCase().includes(q.trim().toLowerCase()));
  const create = async () => {
    const title = (q.trim() || window.prompt('Name of the new drawing:') || '').trim();
    if (!title || !ws) return;
    const activeId = useStore.getState().activeNote?.note?.id ?? null;
    await createNote({ workspace_id: ws.id, parent_id: activeId, title, note_type: 'draw' });
    onPick(title);
  };
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="math-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="math-dialog drawing-picker" role="dialog" aria-label="Embed a drawing">
        <div className="math-dialog-head"><b>Embed a drawing</b></div>
        <div className="drawing-picker-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search your Free Draw notes…"
            onKeyDown={e => { if (e.key === 'Enter') { if (drawings[0]) onPick(drawings[0].title); else create(); } }} />
        </div>
        <div className="drawing-picker-list">
          {drawings.map(n => (
            <button key={n.id} type="button" onClick={() => onPick(n.title)}><PenTool size={14} /> {n.title}</button>
          ))}
          {drawings.length === 0 && <div className="drawing-picker-empty">{q ? 'No drawing with that name.' : 'No Free Draw notes yet.'}</div>}
          <button type="button" className="new" onClick={create}><Plus size={14} /> New drawing{q.trim() ? ` “${q.trim()}”` : '…'}</button>
        </div>
        <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>The picture updates when the drawing changes. Click its name to open it.</small>
      </div>
    </div>
  );
}
