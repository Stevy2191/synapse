// "New": what kind of note to make — a note, a pen drawing, a diagram (draw.io) or a whiteboard
// (Excalidraw) — or start from one of the workspace's templates, or open today's daily note.
import { useEffect, useState } from 'react';
import { FileText, PenLine, Workflow, PenTool, CalendarDays, LayoutTemplate, ChevronRight, Import } from 'lucide-react';
import { Modal } from '../chat/ChatDialogs';
import { useStore } from '../../stores/useStore';
import { STARTERS, listTemplates } from '../../templates/templates';

export const NEW_KINDS = [
  { type: 'note', icon: FileText, label: 'Note', desc: 'Text, checklists, tables, tasks, meetings, pictures…', key: '1' },
  { type: 'draw', icon: PenLine, label: 'Drawing', desc: 'A full page for handwriting and sketching with a pen or finger', key: '2' },
  { type: 'drawio', icon: Workflow, label: 'Diagram', desc: 'Flowcharts, network and org charts (draw.io)', key: '3' },
  { type: 'excalidraw', icon: PenTool, label: 'Whiteboard', desc: 'Hand-drawn style sketches and brainstorming (Excalidraw)', key: '4' },
];
const iconFor = title => STARTERS.find(s => s.title.toLowerCase() === title.toLowerCase())?.icon || '📄';

/** onSelect(type) for the kinds above, 'daily', 'import', 'template' (the full picker) or { template } (one of them). */
export default function NewNoteModal({ onSelect, onClose }) {
  const ws = useStore(s => s.activeWorkspace);
  const [templates, setTemplates] = useState(null);
  useEffect(() => {
    if (!ws) return;
    listTemplates(ws.id).then(mine => {
      const have = new Set(mine.map(t => t.title.toLowerCase()));
      const builtins = STARTERS.filter(s => !have.has(s.title.toLowerCase()) && !['Daily note'].includes(s.title))
        .map(s => ({ id: `builtin:${s.title}`, title: s.title, rich_content: s.html, editor_mode: 'rich', tags: '[]', builtin: true }));
      setTemplates([...mine.filter(t => t.title !== 'Daily note'), ...builtins].slice(0, 7));
    });
  }, [ws?.id]);
  // Number keys 1–4 pick a kind.
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest?.('input, textarea')) return;
      const k = NEW_KINDS.find(x => x.key === e.key);
      if (k) { e.preventDefault(); onSelect(k.type); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSelect]);

  return (
    <Modal title="New" onClose={onClose} width={620}>
      <div className="nn-kinds">
        {NEW_KINDS.map(k => {
          const Icon = k.icon;
          return (
            <button key={k.type} type="button" className={`nn-kind nn-${k.type}`} onClick={() => onSelect(k.type)}>
              <span className="nn-icon"><Icon size={20} /></span>
              <span className="nn-text"><b>{k.label}</b><small>{k.desc}</small></span>
              <kbd className="nn-key">{k.key}</kbd>
            </button>
          );
        })}
      </div>

      <div className="nn-section">
        <span className="nn-label"><LayoutTemplate size={13} /> Start from a template</span>
        <div className="nn-chips">
          {(templates || []).map(t => (
            <button key={t.id} type="button" className="nn-chip" onClick={() => onSelect({ template: t })} title={t.builtin ? 'Built-in template' : 'Your template'}>
              <span>{iconFor(t.title)}</span> {t.title}
            </button>
          ))}
          <button type="button" className="nn-chip more" onClick={() => onSelect('template')}>All templates <ChevronRight size={13} /></button>
        </div>
      </div>

      <div className="nn-section nn-row">
        <button type="button" className="nn-daily" onClick={() => onSelect('daily')}>
          <CalendarDays size={16} /> <span><b>Today’s daily note</b><small>Opens it, or makes it with today’s meetings</small></span>
        </button>
        <button type="button" className="nn-daily" onClick={() => onSelect('import')}>
          <Import size={16} /> <span><b>Import notes</b><small>From Obsidian, Notion, Evernote or OneNote</small></span>
        </button>
      </div>
    </Modal>
  );
}
