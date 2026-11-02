// Tab / Shift+Tab in Write mode:
//   bullets & checklists → indent / outdent (Tiptap's own list keys run first)
//   code blocks          → insert / ignore (two spaces)
//   plain lines & headings → indent / outdent them (data-indent="1…8"), inside toggles too
// Tab never leaves the note: without this the browser moved the keyboard focus to the next button
// (e.g. a toggle's arrow) and jumped down the page.
import { Extension } from '@tiptap/core';

const MAX = 8;
const INDENTABLE = ['paragraph', 'heading'];

function inside(state, names) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (names.includes($from.node(d).type.name)) return true;
  return false;
}

function shift(editor, delta) {
  const { state } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!INDENTABLE.includes(node.type.name)) return true;
    const cur = node.attrs.indent || 0;
    const next = Math.max(0, Math.min(MAX, cur + delta));
    if (next !== cur) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next }); changed = true; }
    return false;
  });
  if (changed) editor.view.dispatch(tr);
  return true;
}

export const Indent = Extension.create({
  name: 'indent',
  priority: 50, // after lists, tables and menus, which handle Tab themselves
  addGlobalAttributes() {
    return [{
      types: INDENTABLE,
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => Math.max(0, Math.min(MAX, parseInt(el.getAttribute('data-indent') || '0', 10) || 0)),
          renderHTML: a => (a.indent ? { 'data-indent': String(a.indent) } : {}),
        },
      },
    }];
  },
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        if (state.selection.$from.parent.type.name === 'codeBlock') return editor.commands.insertContent('  ');
        if (inside(state, ['listItem', 'taskItem'])) return true; // couldn't indent further — stay put
        if (inside(state, ['table'])) return true;
        return shift(editor, 1);
      },
      'Shift-Tab': ({ editor }) => {
        const { state } = editor;
        if (state.selection.$from.parent.type.name === 'codeBlock') return true;
        if (inside(state, ['listItem', 'taskItem'])) return true;
        if (inside(state, ['table'])) return true;
        return shift(editor, -1);
      },
    };
  },
});
