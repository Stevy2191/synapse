// Extra blocks for the note editor:
//   Callout          — a coloured box (Note / Tip / Warning / Danger). Markdown: GitHub alerts, "> [!NOTE]"
//   TableOfContents  — a live list of the note's headings; click one to jump to it. Markdown: "[TOC]"
//   Toggle           — a collapsible section (from @tiptap/extension-details). Markdown: <details>
//   Task list        — a toggle holding a checklist; its title shows “3 of 5 remaining” (TaskCounter)
import { useEffect, useRef, useState } from 'react';
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Info, Lightbulb, TriangleAlert, OctagonAlert, ListTree, Trash2 } from 'lucide-react';

export const CALLOUTS = {
  info: { label: 'Note', icon: Info, md: 'NOTE' },
  tip: { label: 'Tip', icon: Lightbulb, md: 'TIP' },
  warning: { label: 'Warning', icon: TriangleAlert, md: 'WARNING' },
  danger: { label: 'Danger', icon: OctagonAlert, md: 'CAUTION' },
};
// GitHub alert name → callout type (IMPORTANT has no colour of its own here)
export const CALLOUT_FROM_MD = { NOTE: 'info', IMPORTANT: 'info', TIP: 'tip', WARNING: 'warning', CAUTION: 'danger', DANGER: 'danger' };

function CalloutView({ node, updateAttributes, editor }) {
  const type = CALLOUTS[node.attrs.type] ? node.attrs.type : 'info';
  const { icon: Icon, label } = CALLOUTS[type];
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <NodeViewWrapper className="callout" data-callout={type}>
      <div className="callout-icon" contentEditable={false} ref={box}>
        <button type="button" title={editor.isEditable ? `${label} — click to change` : label}
          onMouseDown={e => e.preventDefault()} onClick={() => editor.isEditable && setOpen(o => !o)}>
          <Icon size={17} />
        </button>
        {open && (
          <div className="callout-menu">
            {Object.entries(CALLOUTS).map(([key, c]) => (
              <button key={key} type="button" data-callout={key} className={key === type ? 'on' : ''}
                onMouseDown={e => e.preventDefault()} onClick={() => { updateAttributes({ type: key }); setOpen(false); }}>
                <c.icon size={14} /> {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: el => (CALLOUTS[el.getAttribute('data-callout')] ? el.getAttribute('data-callout') : 'info'),
        renderHTML: attrs => ({ 'data-callout': attrs.type }),
      },
    };
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of a callout turns it back into normal text.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            if ($from.index(d) !== 0 || $from.start(d + 1) !== $from.start($from.depth)) return false;
            return editor.commands.lift(this.name);
          }
        }
        return false;
      },
    };
  },
});

function headingsOf(editor) {
  const list = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) list.push({ level: node.attrs.level, text: node.textContent, pos });
  });
  return list;
}

function TocView({ editor, deleteNode, selected }) {
  const [items, setItems] = useState(() => headingsOf(editor));
  useEffect(() => {
    const update = () => setItems(headingsOf(editor));
    editor.on('update', update);
    return () => editor.off('update', update);
  }, [editor]);
  const jump = pos => {
    const dom = editor.view.nodeDOM(pos);
    dom?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    editor.chain().setTextSelection(pos + 1).run();
  };
  const top = Math.min(...items.map(i => i.level), 3);
  return (
    <NodeViewWrapper className={`toc-block${selected ? ' selected' : ''}`} contentEditable={false} data-toc="">
      <div className="toc-head">
        <ListTree size={14} /> Contents
        {editor.isEditable && <button type="button" className="toc-remove" title="Remove" onClick={deleteNode}><Trash2 size={13} /></button>}
      </div>
      {items.length === 0
        ? <div className="toc-empty">Add headings (# Heading) and they'll be listed here.</div>
        : items.map((h, i) => (
          <button key={i} type="button" className="toc-item" style={{ paddingLeft: 8 + (h.level - top) * 16 }} onClick={() => jump(h.pos)}>
            {h.text}
          </button>
        ))}
    </NodeViewWrapper>
  );
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: 'div[data-toc]' }]; },
  renderHTML() { return ['div', { 'data-toc': '' }]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
});

/** Checklist items directly in a toggle (not in a toggle nested inside it): { done, total }. */
export function countTasks(details) {
  let done = 0;
  let total = 0;
  details.descendants(node => {
    if (node.type.name === 'details') return false; // a nested toggle counts its own
    if (node.type.name === 'taskItem') {
      if (node.textContent.trim()) { total++; if (node.attrs.checked) done++; }
    }
    return true;
  });
  return { done, total };
}

export const taskCountLabel = ({ done, total }) => (done === total ? `All ${total} done` : `${total - done} of ${total} remaining`);

// Toggles that hold a checklist show how many tasks are left, after their title. Nothing is stored:
// the count is drawn from the checkboxes every time the note changes.
const TaskCounter = Extension.create({
  name: 'taskCounter',
  priority: 1000, // before the toggle's own Enter key
  addKeyboardShortcuts() {
    return {
      // Enter in a task list's name goes to its first task (a new one if the first isn't empty).
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== 'detailsSummary') return false;
        const details = $from.node($from.depth - 1);
        const content = details.childCount > 1 ? details.child(1) : null;
        const list = content?.firstChild;
        if (list?.type.name !== 'taskList') return false;
        const detailsPos = $from.before($from.depth - 1);
        const contentPos = detailsPos + 1 + details.child(0).nodeSize;
        const { tr, schema } = state;
        if (!details.attrs.open) tr.setNodeMarkup(detailsPos, null, { ...details.attrs, open: true });
        const firstItem = list.firstChild;
        if (!firstItem || firstItem.textContent) {
          tr.insert(contentPos + 2, schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create()));
        }
        tr.setSelection(TextSelection.create(tr.doc, contentPos + 4)).scrollIntoView();
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const build = doc => {
      const decos = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== 'details') return true;
        const summary = node.firstChild;
        const counts = countTasks(node);
        if (summary?.type.name === 'detailsSummary' && counts.total) {
          const at = pos + 1 + summary.nodeSize - 1; // end of the title
          const label = taskCountLabel(counts);
          decos.push(Decoration.widget(at, () => {
            const el = document.createElement('span');
            el.className = `task-count${counts.done === counts.total ? ' all-done' : ''}`;
            el.contentEditable = 'false';
            el.textContent = label;
            return el;
          }, { side: 1, key: `tc-${pos}-${label}`, ignoreSelection: true }));
        }
        return true;
      });
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: new PluginKey('taskCounter'),
      state: {
        init: (_, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleDOMEvents: {
          // Work around @tiptap/extension-details: for a toggle that is the very first block of the
          // note (position 0) its click handler gives up ("if (!pos)"), so open/closed was never
          // saved and the toggle got stuck. Its own listener has already flipped the display; we
          // save the matching state.
          click(view, event) {
            const btn = event.target?.closest?.('[data-type="details"] > button');
            if (!btn || !view.editable || btn.parentElement !== view.nodeDOM(0)) return false;
            const node = view.state.doc.firstChild;
            if (node?.type.name !== 'details') return false;
            view.dispatch(view.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, open: !node.attrs.open }));
            return false;
          },
        },
      },
    })];
  },
});

export const ToggleBlocks = [
  Details.configure({ persist: true, HTMLAttributes: { class: 'toggle-block' } }),
  DetailsSummary,
  DetailsContent,
  TaskCounter,
];
