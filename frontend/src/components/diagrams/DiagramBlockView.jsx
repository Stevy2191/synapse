// How a diagram block looks inside a note: the picture, with Edit / Delete on hover.
// Double-click (or Edit) opens the full-screen editor. A new, empty block opens it straight away.
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper } from '@tiptap/react';
import { Pencil, Trash2, PenTool, Workflow } from 'lucide-react';
import DrawioEditor from './DrawioEditor';

// Excalidraw is large, so it's only downloaded when someone opens a drawing.
const ExcalidrawEditor = lazy(() => import('./ExcalidrawEditor'));

export default function DiagramBlockView({ node, updateAttributes, deleteNode, selected, editor }) {
  const { kind, scene, preview } = node.attrs;
  const [editing, setEditing] = useState(false);
  const isNew = !preview;
  const label = kind === 'excalidraw' ? 'Excalidraw drawing' : 'draw.io diagram';
  const Icon = kind === 'excalidraw' ? PenTool : Workflow;

  useEffect(() => { if (isNew && editor.isEditable) setEditing(true); }, []);

  const close = () => {
    setEditing(false);
    if (isNew) deleteNode(); // cancelled before anything was drawn
  };
  const save = (attrs) => {
    updateAttributes(attrs);
    setEditing(false);
  };

  return (
    <NodeViewWrapper className={`diagram-block${selected ? ' selected' : ''}`} data-drag-handle>
      {preview ? (
        <img src={preview} alt={label} onDoubleClick={() => setEditing(true)} draggable={false} />
      ) : (
        <div className="diagram-empty" onClick={() => setEditing(true)}><Icon size={18} /> {label}: click to draw</div>
      )}
      <div className="diagram-tools" contentEditable={false}>
        <span className="diagram-kind"><Icon size={12} /> {label}</span>
        <button type="button" onClick={() => setEditing(true)} title="Edit"><Pencil size={13} /> Edit</button>
        <button type="button" onClick={deleteNode} title="Delete" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
      </div>

      {editing && createPortal(
        kind === 'excalidraw' ? (
          <Suspense fallback={<div className="diagram-modal"><div className="diagram-loading">Loading Excalidraw…</div></div>}>
            <ExcalidrawEditor scene={scene} onSave={save} onClose={close} />
          </Suspense>
        ) : (
          <DrawioEditor preview={preview} onSave={save} onClose={close} />
        ),
        document.body,
      )}
    </NodeViewWrapper>
  );
}
