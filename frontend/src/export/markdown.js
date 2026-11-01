// Markdown export: one .md file per note, in folders that follow the sidebar, with pictures saved
// as files in an "attachments" folder. Obsidian-friendly: [[links]], callouts, math, Mermaid and
// tags (as front matter) work there as they are.
import { zipSync, strToU8 } from 'fflate';
import { htmlToMarkdown, DIAGRAM_FENCE } from '../components/editor/convert';
import { drawingSvg, parseTags } from './render';
import { flowchartSvg } from './flowchart';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

export const safeFileName = s => String(s || 'Untitled').replace(/[\\/:*?"<>|#^[\]\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';

function dataUrlToBytes(src) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = (m[1] || '').toLowerCase();
  let bytes;
  if (m[2]) {
    const bin = atob(m[3]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else bytes = strToU8(decodeURIComponent(m[3]));
  return { mime, ext: EXT[mime] || 'bin', bytes };
}

function unique(name, taken) {
  const lower = name.toLowerCase();
  if (!taken.has(lower)) { taken.add(lower); return name; }
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!taken.has(n.toLowerCase())) { taken.add(n.toLowerCase()); return n; }
  }
}

/**
 * Build the Markdown export. Returns { kind: 'file', name, data } for one note with no pictures,
 * otherwise { kind: 'zip', name, data } (data is a Uint8Array).
 */
export function buildMarkdown(notes, all, title) {
  const files = {};
  const attachmentNames = new Set();
  const folderNames = new Map(); // folder path → Set of names in it
  const notePath = new Map(); // note id → folder path ('' at the top)
  const hasChildren = new Set(notes.map(n => n.parent_id));
  const byId = new Map(notes.map(n => [n.id, n]));

  const drawingFiles = new Map(); // drawing note id → its picture (so it's only saved once)
  const drawingFile = (drawing, svg) => {
    if (!drawingFiles.has(drawing.id)) drawingFiles.set(drawing.id, addAttachment(drawing.title, strToU8(svg), 'svg'));
    return drawingFiles.get(drawing.id);
  };
  const addAttachment = (base, bytes, ext) => {
    const name = unique(`${safeFileName(base)}.${ext}`, attachmentNames);
    files[`attachments/${name}`] = bytes;
    return `attachments/${encodeURI(name).replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
  };
  const nameIn = (folder, name) => {
    if (!folderNames.has(folder)) folderNames.set(folder, new Set());
    return unique(name, folderNames.get(folder));
  };

  for (const note of notes) {
    const parentFolder = byId.has(note.parent_id) ? notePath.get(note.parent_id) : '';
    const base = safeFileName(note.title);
    const fileName = nameIn(parentFolder, `${base}.md`);
    // A note with notes inside it gets a folder of the same name for them (Obsidian "folder notes").
    if (hasChildren.has(note.id)) notePath.set(note.id, parentFolder ? `${parentFolder}/${fileName.slice(0, -3)}` : fileName.slice(0, -3));
    const depth = parentFolder ? parentFolder.split('/').length : 0;
    const up = '../'.repeat(depth);

    let md;
    if (note.note_type === 'draw' || note.note_type === 'diagram') {
      const svg = note.note_type === 'draw' ? drawingSvg(note) : flowchartSvg(note.canvas_data);
      md = svg ? `![${note.title}](${up}${note.note_type === 'draw' ? drawingFile(note, svg) : addAttachment(note.title, strToU8(svg), 'svg')})\n` : '';
    } else {
      // Write-mode notes: the formatted text is the original; the stored Markdown is a copy.
      md = note.editor_mode === 'rich' && note.rich_content ? htmlToMarkdown(note.rich_content) : note.content || '';
      // draw.io / Excalidraw blocks → their picture
      let k = 0;
      md = md.replace(DIAGRAM_FENCE, (m, json) => {
        try {
          const d = JSON.parse(json);
          const file = d.preview && dataUrlToBytes(d.preview);
          if (!file) return '';
          k++;
          const label = d.kind === 'excalidraw' ? 'Excalidraw drawing' : 'draw.io diagram';
          return `![${label}](${up}${addAttachment(`${note.title} – diagram ${k}`, file.bytes, file.ext)})`;
        } catch { return ''; }
      });
      // Embedded Free Draw notes
      md = md.replace(/^!\[\[([^\[\]\n]+)\]\]\s*$/gm, (m, t) => {
        const drawing = all.find(n => n.note_type === 'draw' && n.title.toLowerCase() === t.trim().toLowerCase());
        const svg = drawing && drawingSvg(drawing);
        return svg ? `![${t.trim()}](${up}${drawingFile(drawing, svg)})` : m;
      });
      // Pictures pasted into the note (kept inside it as data: URLs)
      let p = 0;
      md = md.replace(/!\[([^\]\n]*)\]\((data:image\/[^)\s]+)\)/g, (m, alt, src) => {
        const file = dataUrlToBytes(src);
        if (!file) return m;
        p++;
        return `![${alt}](${up}${addAttachment(`${note.title} – picture ${p}`, file.bytes, file.ext)})`;
      });
      md = md.replace(/(<img[^>]*\ssrc=")(data:image\/[^"]+)"/g, (m, pre, src) => {
        const file = dataUrlToBytes(src);
        if (!file) return m;
        p++;
        return `${pre}${up}${addAttachment(`${note.title} – picture ${p}`, file.bytes, file.ext)}"`;
      });
    }
    const tags = parseTags(note.tags);
    const front = tags.length ? `---\ntags:\n${tags.map(t => `  - ${JSON.stringify(String(t))}`).join('\n')}\n---\n\n` : '';
    files[parentFolder ? `${parentFolder}/${fileName}` : fileName] = strToU8(`${front}${md.replace(/\s+$/, '')}\n`);
  }

  const paths = Object.keys(files);
  if (paths.length === 1 && paths[0].endsWith('.md') && !paths[0].includes('/')) {
    return { kind: 'file', name: paths[0], data: files[paths[0]], type: 'text/markdown' };
  }
  return { kind: 'zip', name: `${safeFileName(title)}.zip`, data: zipSync(files, { level: 6 }), type: 'application/zip' };
}
