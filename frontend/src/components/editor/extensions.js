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

export const SLASH_ITEMS = [
  { id: 'text', title: 'Text', desc: 'Plain paragraph', keywords: 'paragraph p', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: 'h1', title: 'Heading 1', desc: 'Big section heading', keywords: 'title #', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: 'h2', title: 'Heading 2', desc: 'Medium heading', keywords: 'subtitle ##', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: 'h3', title: 'Heading 3', desc: 'Small heading', keywords: '###', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: 'todo', title: 'Checklist', desc: 'Track tasks with checkboxes', keywords: 'todo task checkbox [ ]', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'ul', title: 'Bulleted list', desc: 'Simple bulleted list', keywords: 'unordered bullet -', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'ol', title: 'Numbered list', desc: 'List with numbers', keywords: 'ordered 1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'link', title: 'Link to note', desc: 'Connect to another note', keywords: 'wiki [[ backlink', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
  { id: 'quote', title: 'Quote', desc: 'Highlight a quotation', keywords: 'blockquote >', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: 'code', title: 'Code block', desc: 'Code with syntax highlighting', keywords: '```', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { id: 'table', title: 'Table', desc: '3 × 3 table', keywords: 'grid', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'divider', title: 'Divider', desc: 'Horizontal line', keywords: 'hr rule ---', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  {
    id: 'image', title: 'Image', desc: 'Embed an image from a link', keywords: 'picture photo',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const src = window.prompt('Image address (URL):');
      if (src) e.chain().focus().setImage({ src }).run();
    },
  },
];

export function filterSlashItems(query) {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(i => `${i.title} ${i.keywords}`.toLowerCase().includes(q));
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() { return { getUi: () => ({}) }; },
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('slashCommand'),
      char: '/',
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
    .map(n => ({ id: n.id, title: n.title, kind: 'note', noteType: n.note_type }));
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
          openNoteByTitle(ws.id, link.dataset.link);
          return true;
        },
      },
    })];
  },
});
