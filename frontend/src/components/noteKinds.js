// What kind of note something is, for icons and labels: a plain note, a note holding a draw.io
// or Excalidraw diagram, a flowchart, or a Free Draw page.
import { FileText, Workflow, PenTool, GitFork, Pencil, Folder } from 'lucide-react';

export const KINDS = {
  note: { icon: FileText, label: 'Note', color: null },
  drawio: { icon: Workflow, label: 'draw.io diagram', color: '#f08705' },
  excalidraw: { icon: PenTool, label: 'Excalidraw drawing', color: '#8b85ff' },
  flowchart: { icon: GitFork, label: 'Flowchart', color: '#06b6d4' },
  freedraw: { icon: Pencil, label: 'Free Draw', color: '#ec4899' },
  folder: { icon: Folder, label: 'Folder', color: 'var(--folder-color, #e3a33b)' },
};

/** The kind of a full note (with its content). */
export function noteKind(note) {
  if (note.note_type === 'diagram') return 'flowchart';
  if (note.note_type === 'draw') return 'freedraw';
  if (note.note_type === 'folder') return 'folder';
  const text = `${note.rich_content || ''}\n${note.content || ''}`;
  if (/data-diagram="drawio"|"kind":"drawio"/.test(text)) return 'drawio';
  if (/data-diagram="excalidraw"|"kind":"excalidraw"/.test(text)) return 'excalidraw';
  return 'note';
}

/** Icon, colour and label for a tree entry or search result (which carry `kind`). */
export function kindInfo(entry) {
  const k = entry.kind || (entry.note_type === 'diagram' ? 'flowchart' : entry.note_type === 'draw' ? 'freedraw' : entry.note_type === 'folder' ? 'folder' : 'note');
  return { key: k, ...(KINDS[k] || KINDS.note) };
}

const shortDay = (d = new Date()) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** True for names that say nothing about the note ("Untitled", the old "New Diagram"…). */
export function isUntitled(title) {
  return /^(untitled|new diagram|new drawing|)$/i.test(String(title || '').trim());
}

/** A dated name like "Diagram – Nov 4", made unique among `titles` ("Diagram – Nov 4 (2)"). */
export function datedName(word, titles = []) {
  const base = `${word} – ${shortDay()}`;
  const taken = new Set(titles.map(t => String(t).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}

/** What to call a still-untitled note that has just got its first diagram (or null). */
export function nameForDiagramNote(html, titles) {
  // A saved diagram has its picture; a new one still being drawn (or cancelled) doesn't yet.
  if (!/data-diagram="(drawio|excalidraw)"/.test(html || '') || !/src="data:image\//.test(html)) return null;
  // Only when the diagram is all there is: other text means the note is about something else.
  const text = html.replace(/<figure[^>]*data-diagram[\s\S]*?<\/figure>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (text) return null;
  return datedName(/data-diagram="excalidraw"/.test(html) ? 'Drawing' : 'Diagram', titles);
}
