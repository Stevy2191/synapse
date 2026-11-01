// What kind of note something is, for icons and labels: a plain note, a note holding a draw.io
// or Excalidraw diagram, a flowchart, or a Free Draw page.
import { FileText, Workflow, PenTool, GitFork, Pencil } from 'lucide-react';

export const KINDS = {
  note: { icon: FileText, label: 'Note', color: null },
  drawio: { icon: Workflow, label: 'draw.io diagram', color: '#f08705' },
  excalidraw: { icon: PenTool, label: 'Excalidraw drawing', color: '#8b85ff' },
  flowchart: { icon: GitFork, label: 'Flowchart', color: '#06b6d4' },
  freedraw: { icon: Pencil, label: 'Free Draw', color: '#ec4899' },
};

/** The kind of a full note (with its content). */
export function noteKind(note) {
  if (note.note_type === 'diagram') return 'flowchart';
  if (note.note_type === 'draw') return 'freedraw';
  const text = `${note.rich_content || ''}\n${note.content || ''}`;
  if (/data-diagram="drawio"|"kind":"drawio"/.test(text)) return 'drawio';
  if (/data-diagram="excalidraw"|"kind":"excalidraw"/.test(text)) return 'excalidraw';
  return 'note';
}

/** Icon, colour and label for a tree entry or search result (which carry `kind`). */
export function kindInfo(entry) {
  const k = entry.kind || (entry.note_type === 'diagram' ? 'flowchart' : entry.note_type === 'draw' ? 'freedraw' : 'note');
  return { key: k, ...(KINDS[k] || KINDS.note) };
}
