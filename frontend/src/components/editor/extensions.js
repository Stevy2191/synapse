// Editor extensions for the default (Outline-style) note editor:
//   SlashCommand — type "/" for a menu of blocks to insert
//   WikiLinkSuggest — type "[[" to search notes and insert a [[link]]
//   WikiLinkDecorations — show [[links]] in the text as links; click one to open that note
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useStore } from '../../stores/useStore';
import { openNoteByTitle, createNote } from '../../offline/sync';
import { nextInNewTab } from '../../tabs/tabs';
import { fitImage } from '../../utils/image';
import toast from 'react-hot-toast';
import { videoSource, MERMAID_SAMPLE } from './embeds';

// `getUi` returns the React side's handlers ({ open, keyDown, close }), so the menus can be
// drawn by React while ProseMirror keeps track of what's being typed.
function renderer(kind, getUi) {
  return () => ({
    onStart: props => getUi().open(kind, props),
    onUpdate: props => getUi().open(kind, props),
    onKeyDown: ({ event }) => getUi().keyDown(event),
    onExit: () => getUi().close(kind),
  });
}

function notInCode({ state }) {
  return !state.selection.$from.parent.type.spec.code;
}

// The "/" menu, in groups. `id` also picks the icon (RichEditor's SLASH_ICONS).
export const SLASH_GROUPS = ['Basic', 'Lists', 'Callouts', 'Media', 'Math', 'Diagrams', 'Notes & links', 'Date & time'];

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const now = () => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function pickImageFile(editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const src = await fitImage(file);
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, '') }).run();
    } catch (err) { toast.error(err.message); }
  };
  input.click();
}

const callout = type => (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'callout', attrs: { type }, content: [{ type: 'paragraph' }] }).run();

// Is the AI assistant allowed in the current workspace? (Workspace → Preferences)
function aiAllowed() {
  try { return JSON.parse(useStore.getState().activeWorkspace?.settings || '{}').ai !== 'off'; } catch { return true; }
}

export const SLASH_ITEMS = [
  // AI
  { id: 'ai', group: 'AI', title: 'Ask AI', desc: 'Write, rewrite, translate or find action items', keywords: 'ai assistant write generate gpt claude chatgpt gemini grok summarise summarize translate tasks', when: aiAllowed,
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.emit('synapse:ai', { fromSlash: true }); } },
  // Basic
  { id: 'text', group: 'Basic', title: 'Text', desc: 'Plain paragraph', keywords: 'paragraph p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: 'h1', group: 'Basic', title: 'Heading 1', desc: 'Big section heading', keywords: 'title #', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: 'h2', group: 'Basic', title: 'Heading 2', desc: 'Medium heading', keywords: 'subtitle ##', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: 'h3', group: 'Basic', title: 'Heading 3', desc: 'Small heading', keywords: '###', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: 'quote', group: 'Basic', title: 'Quote', desc: 'Highlight a quotation', keywords: 'blockquote >', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: 'divider', group: 'Basic', title: 'Divider', desc: 'Horizontal line', keywords: 'hr rule --- separator line', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  // Lists
  { id: 'ul', group: 'Lists', title: 'Bulleted list', desc: 'Simple bulleted list', keywords: 'unordered bullet -', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'ol', group: 'Lists', title: 'Numbered list', desc: 'List with numbers', keywords: 'ordered 1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'todo', group: 'Lists', title: 'Checklist', desc: 'Track tasks with checkboxes', keywords: 'todo task checkbox [ ]', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'toggle', group: 'Lists', title: 'Toggle section', desc: 'Collapsible section: click to show or hide', keywords: 'collapse collapsible details expand accordion fold dropdown',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'details', attrs: { open: true }, content: [
      { type: 'detailsSummary' }, { type: 'detailsContent', content: [{ type: 'paragraph' }] }] })
      // Put the cursor in the title, ready to type it.
      .command(({ tr, state }) => {
        const $from = tr.selection.$from;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'details') {
            tr.setSelection(state.selection.constructor.near(tr.doc.resolve($from.start(d) + 1)));
            return true;
          }
        }
        return true;
      }).run() },
  { id: 'tasklist', group: 'Lists', title: 'Task list', desc: 'A named, collapsible checklist that counts what’s left', keywords: 'tasks todo checklist project progress remaining count toggle group',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'details', attrs: { open: true }, content: [
      { type: 'detailsSummary' },
      { type: 'detailsContent', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] }] })
      // Cursor in the name, ready to type it.
      .command(({ tr, state }) => {
        const $from = tr.selection.$from;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'details') {
            tr.setSelection(state.selection.constructor.near(tr.doc.resolve($from.start(d) + 1)));
            return true;
          }
        }
        return true;
      }).run() },
  // Callouts
  { id: 'callout-info', group: 'Callouts', title: 'Note', desc: 'Blue box for useful information', keywords: 'callout info information admonition box', run: callout('info') },
  { id: 'callout-tip', group: 'Callouts', title: 'Tip', desc: 'Green box for advice', keywords: 'callout success hint idea box', run: callout('tip') },
  { id: 'callout-warning', group: 'Callouts', title: 'Warning', desc: 'Yellow box: be careful', keywords: 'callout caution attention box', run: callout('warning') },
  { id: 'callout-danger', group: 'Callouts', title: 'Danger', desc: 'Red box: don’t do this', keywords: 'callout error critical important box', run: callout('danger') },
  // Media
  { id: 'upload', group: 'Media', title: 'Image', desc: 'Upload a picture from this device', keywords: 'picture photo upload file screenshot',
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); pickImageFile(e); } },
  { id: 'image', group: 'Media', title: 'Image from link', desc: 'Embed an image from a web address', keywords: 'picture photo url',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const src = window.prompt('Image address (URL):');
      if (src) e.chain().focus().setImage({ src }).run();
    } },
  { id: 'video', group: 'Media', title: 'Video', desc: 'YouTube, Vimeo, Loom or a video file link', keywords: 'youtube vimeo loom embed movie mp4 film',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const url = window.prompt('Video link (YouTube, Vimeo, Loom, or a .mp4 / .webm file):')?.trim();
      if (!url) return;
      if (!videoSource(url)) { toast.error('That link isn’t a YouTube, Vimeo or Loom video, or a video file.'); return; }
      e.chain().focus().insertContent([{ type: 'video', attrs: { url } }, { type: 'paragraph' }]).run();
    } },
  { id: 'file', group: 'Media', title: 'File from a folder or drive', desc: 'Network folders, OneDrive, Google Drive — attach a copy or link it', keywords: 'file attach attachment upload onedrive google drive nas share folder document pdf',
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.emit('synapse:pickFile'); } },
  { id: 'table', group: 'Media', title: 'Table', desc: '3 × 3 table', keywords: 'grid spreadsheet', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'code', group: 'Media', title: 'Code block', desc: 'Code with syntax colors', keywords: '``` script snippet', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  // Math
  { id: 'math', group: 'Math', title: 'Math equation', desc: 'A formula on its own line', keywords: 'latex katex formula equation tex block $$',
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.emit('synapse:math', { inline: false }); } },
  { id: 'math-inline', group: 'Math', title: 'Inline math', desc: 'A formula inside a sentence', keywords: 'latex katex formula equation tex $',
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.emit('synapse:math', { inline: true }); } },
  // Diagrams
  { id: 'drawio', group: 'Diagrams', title: 'draw.io diagram', desc: 'Flowcharts, network & org diagrams', keywords: 'diagram flowchart drawio diagrams.net chart network uml',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'diagram', attrs: { kind: 'drawio' } }).run() },
  { id: 'excalidraw', group: 'Diagrams', title: 'Excalidraw drawing', desc: 'Hand-drawn style sketches & whiteboard', keywords: 'excalidraw sketch draw whiteboard drawing',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'diagram', attrs: { kind: 'excalidraw' } }).run() },
  { id: 'drawing', group: 'Diagrams', title: 'Embed a drawing', desc: 'Show a Free Draw note as a picture', keywords: 'free draw sketch handwriting ink embed drawing whiteboard',
    run: (e, r) => { e.chain().focus().deleteRange(r).run(); e.emit('synapse:drawing', {}); } },
  { id: 'mermaid', group: 'Diagrams', title: 'Mermaid chart', desc: 'Flowcharts, sequences, Gantt & more, written as text', keywords: 'mermaid flowchart sequence gantt pie chart graph timeline mindmap text diagram',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: MERMAID_SAMPLE }] }).run() },
  // Notes & links
  { id: 'link', group: 'Notes & links', title: 'Link to note', desc: 'Connect to another note', keywords: 'wiki [[ backlink', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
  { id: 'subnote', group: 'Notes & links', title: 'New sub-note', desc: 'Create a note inside this one and link it', keywords: 'page child subpage nested new',
    run: async (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const { activeWorkspace, activeNote } = useStore.getState();
      if (!activeWorkspace) return;
      const title = window.prompt('Name of the new note:')?.trim();
      if (!title) return;
      await createNote({ workspace_id: activeWorkspace.id, parent_id: activeNote?.note?.id ?? null, title, note_type: 'note' });
      e.chain().focus().insertContent(`[[${title}]] `).run();
    } },
  { id: 'toc', group: 'Notes & links', title: 'Table of contents', desc: 'List of this note’s headings', keywords: 'toc contents outline index headings summary',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: 'tableOfContents' }, { type: 'paragraph' }]).run() },
  // Date & time
  { id: 'date', group: 'Date & time', title: 'Today’s date', desc: today(), keywords: 'date today day calendar', run: (e, r) => e.chain().focus().deleteRange(r).insertContent(today() + ' ').run() },
  { id: 'time', group: 'Date & time', title: 'Current time', desc: now(), keywords: 'time clock now', run: (e, r) => e.chain().focus().deleteRange(r).insertContent(now() + ' ').run() },
  { id: 'datetime', group: 'Date & time', title: 'Date and time', desc: 'Today’s date with the time', keywords: 'timestamp now date time',
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent(`${today()}, ${now()} `).run() },
];

export function filterSlashItems(query) {
  const q = query.toLowerCase().trim();
  const visible = SLASH_ITEMS.filter(i => !i.when || i.when());
  // Best matches first: the name starts with what you typed, then the name contains it, then the rest.
  const rank = i => { const t = i.title.toLowerCase(); return t.startsWith(q) ? 0 : t.includes(q) ? 1 : 2; };
  const items = q ? visible.filter(i => `${i.title} ${i.group} ${i.keywords}`.toLowerCase().includes(q))
    .map((i, n) => [i, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([i]) => i) : visible;
  // Fresh date/time in the descriptions each time the menu opens
  return items.map(i => (i.id === 'date' ? { ...i, desc: today() } : i.id === 'time' ? { ...i, desc: now() } : i));
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() { return { getUi: () => ({}) }; },
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('slashCommand'),
      char: '/',
      allowSpaces: true, // so "/inline math" works
      allow: notInCode,
      items: ({ query }) => filterSlashItems(query),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: renderer('slash', this.options.getUi),
    })];
  },
});

function wikiItems(query) {
  const q = query.trim().toLowerCase();
  const { notes, activeNote } = useStore.getState();
  const matches = notes
    .filter(n => n.id !== activeNote?.note?.id && n.title.toLowerCase().includes(q))
    .sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1))
    .slice(0, 8)
    .map(n => ({ id: n.id, title: n.title, kind: 'note', noteType: n.note_type, noteKind: n.kind }));
  if (q && !notes.some(n => n.title.toLowerCase() === q)) {
    matches.push({ id: '__new', title: query.trim(), kind: 'create' });
  }
  return matches;
}

export const WikiLinkSuggest = Extension.create({
  name: 'wikiLinkSuggest',
  addOptions() { return { getUi: () => ({}) }; },
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('wikiLinkSuggest'),
      char: '[[',
      allow: notInCode,
      // "[[" followed by anything except brackets/newlines, ending at the cursor.
      findSuggestionMatch: ({ $position }) => {
        const before = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = before.match(/\[\[([^\[\]\n]*)$/);
        if (!m) return null;
        return { range: { from: $position.pos - m[0].length, to: $position.pos }, query: m[1], text: m[0] };
      },
      items: ({ query }) => wikiItems(query),
      command: ({ editor, range, props }) => {
        // Eat a "]]" the user may have typed already.
        const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size));
        const to = after === ']]' ? range.to + 2 : range.to;
        editor.chain().focus().insertContentAt({ from: range.from, to }, `[[${props.title}]] `).run();
        if (props.kind === 'create') {
          const ws = useStore.getState().activeWorkspace;
          if (ws) createNote({ workspace_id: ws.id, title: props.title, note_type: 'note' });
        }
      },
      render: renderer('wiki', this.options.getUi),
    })];
  },
});

const WIKI = /\[\[([^\[\]\n]+)\]\]/g;

function wikiDecorations(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.text.matchAll(WIKI)) {
      const from = pos + m.index;
      decos.push(Decoration.inline(from, from + m[0].length, {
        class: 'wiki-link', 'data-link': m[1].split('|')[0].trim(), title: `Open "${m[1]}"`,
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const WikiLinkDecorations = Extension.create({
  name: 'wikiLinkDecorations',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('wikiLinkDecorations'),
      state: {
        init: (_, state) => wikiDecorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? wikiDecorations(tr.doc) : old),
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleClick(view, pos, event) {
          const link = event.target.closest?.('.wiki-link');
          const ws = useStore.getState().activeWorkspace;
          if (!link || !ws) return false;
          if (event.ctrlKey || event.metaKey) nextInNewTab(); // Ctrl/⌘-click: open in a new tab
          openNoteByTitle(ws.id, link.dataset.link);
          return true;
        },
      },
    })];
  },
});
