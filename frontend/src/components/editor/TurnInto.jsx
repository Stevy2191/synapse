// "Turn into" — in the toolbar over selected text: change the selected block(s) into a heading, list,
// checklist, quote, callout, toggle, code block, equation… (the block types from the "/" menu).
// Renders inline (not in a portal) so clicking it doesn't close the floating toolbar.
import { useEffect, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { setTextLevel } from './blocks';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, ListCollapse, ListTodo, Quote, Info, Lightbulb, TriangleAlert,
  OctagonAlert, Code2, Sigma, Radical, FileText, ChevronDown, Check,
} from 'lucide-react';

// Replace the selected top-level blocks (after unwrapping lists/quotes) with `make(texts)`.
function replaceBlocks(editor, make) {
  return editor.chain().focus().clearNodes().command(({ tr, state }) => {
    const sel = tr.selection;
    const range = sel.$from.blockRange(sel.$to);
    if (!range) return false;
    const texts = [];
    tr.doc.nodesBetween(range.start, range.end, node => {
      if (node.isTextblock) { texts.push(node.textContent); return false; }
      return true;
    });
    const node = make(texts, state.schema);
    if (!node) return false;
    tr.replaceWith(range.start, range.end, node);
    // Keep the cursor in the new block (at the end of its first line). Otherwise it lands in the line
    // after it, and the page scrolls there — to the bottom when the block is near the end of the note.
    const first = TextSelection.findFrom(tr.doc.resolve(range.start), 1, true);
    if (first) tr.setSelection(TextSelection.create(tr.doc, first.$from.end()));
    tr.scrollIntoView();
    return true;
  }).run();
}

/**
 * The toggle (or task list) the selection starts in, turned back into plain lines (title first, then
 * each line inside it, formatting kept) and selected — so any "Turn into" choice can then apply to
 * the whole section. Returns false when the selection isn't in a toggle.
 */
function unwrapToggle(editor) {
  const { state } = editor;
  const { $from } = state.selection;
  let d = $from.depth;
  while (d > 0 && $from.node(d).type.name !== 'details') d--;
  if (d <= 0) return false;
  const node = $from.node(d);
  const start = $from.before(d);
  const { paragraph } = state.schema.nodes;
  const lines = [];
  node.descendants(n => {
    if (n.isTextblock) { lines.push(paragraph.create(null, n.type.name === 'codeBlock' ? (n.textContent ? state.schema.text(n.textContent) : null) : n.content)); return false; }
    return true;
  });
  if (!lines.length) lines.push(paragraph.create());
  const tr = state.tr.replaceWith(start, start + node.nodeSize, lines);
  const size = lines.reduce((n, l) => n + l.nodeSize, 0);
  tr.setSelection(TextSelection.create(tr.doc, start + 1, start + size - 1));
  editor.view.dispatch(tr);
  return true;
}

// Only inside one paragraph/heading: the selected text itself becomes something else.
function replaceText(editor, make) {
  const { state } = editor;
  const { from, to, $from, $to } = state.selection;
  if (!$from.sameParent($to)) return false;
  const text = state.doc.textBetween(from, to, ' ').trim();
  if (!text) return false;
  return editor.chain().focus().insertContentAt({ from, to }, make(text)).run();
}

const ITEMS = [
  { id: 'text', group: 'Basic', title: 'Text', icon: Type, active: e => e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList') && !e.isActive('taskList') && !e.isActive('blockquote') && !e.isActive('callout') && !e.isActive('details'),
    run: e => (inTitle(e) ? setTextLevel(e, 0) : e.chain().focus().clearNodes().setParagraph().run()), titleOk: true },
  { id: 'h1', group: 'Basic', title: 'Heading 1', icon: Heading1, active: e => e.isActive('heading', { level: 1 }), run: e => (inTitle(e) ? setTextLevel(e, 1) : e.chain().focus().clearNodes().setHeading({ level: 1 }).run()), titleOk: true },
  { id: 'h2', group: 'Basic', title: 'Heading 2', icon: Heading2, active: e => e.isActive('heading', { level: 2 }), run: e => (inTitle(e) ? setTextLevel(e, 2) : e.chain().focus().clearNodes().setHeading({ level: 2 }).run()), titleOk: true },
  { id: 'h3', group: 'Basic', title: 'Heading 3', icon: Heading3, active: e => e.isActive('heading', { level: 3 }), run: e => (inTitle(e) ? setTextLevel(e, 3) : e.chain().focus().clearNodes().setHeading({ level: 3 }).run()), titleOk: true },
  { id: 'quote', group: 'Basic', title: 'Quote', icon: Quote, active: e => e.isActive('blockquote'), run: e => e.chain().focus().clearNodes().setBlockquote().run() },
  { id: 'ul', group: 'Lists', title: 'Bulleted list', icon: List, active: e => e.isActive('bulletList'), run: e => e.chain().focus().clearNodes().toggleBulletList().run() },
  { id: 'ol', group: 'Lists', title: 'Numbered list', icon: ListOrdered, active: e => e.isActive('orderedList'), run: e => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { id: 'todo', group: 'Lists', title: 'Checklist', icon: ListChecks, active: e => e.isActive('taskList'), run: e => e.chain().focus().clearNodes().toggleTaskList().run() },
  { id: 'toggle', group: 'Lists', title: 'Toggle section', hint: 'First line becomes the title', icon: ListCollapse, active: e => e.isActive('details'),
    run: e => replaceBlocks(e, (texts, schema) => {
      const t = s => (s ? [schema.text(s)] : []);
      const [title = '', ...rest] = texts;
      const body = rest.length ? rest.map(s => schema.nodes.paragraph.create(null, t(s))) : [schema.nodes.paragraph.create()];
      return schema.nodes.details.create({ open: true }, [
        schema.nodes.detailsSummary.create(null, t(title)),
        schema.nodes.detailsContent.create(null, body),
      ]);
    }) },
  { id: 'tasklist', group: 'Lists', title: 'Task list', hint: 'First line is the name, the rest become tasks', icon: ListTodo,
    run: e => replaceBlocks(e, (texts, schema) => {
      const t = s => (s ? [schema.text(s)] : []);
      const [title = '', ...rest] = texts;
      const items = (rest.length ? rest : ['']).map(s => schema.nodes.taskItem.create({ checked: false }, [schema.nodes.paragraph.create(null, t(s))]));
      return schema.nodes.details.create({ open: true }, [
        schema.nodes.detailsSummary.create(null, t(title)),
        schema.nodes.detailsContent.create(null, [schema.nodes.taskList.create(null, items)]),
      ]);
    }) },
  ...[['info', 'Note', Info], ['tip', 'Tip', Lightbulb], ['warning', 'Warning', TriangleAlert], ['danger', 'Danger', OctagonAlert]].map(([type, title, icon]) => ({
    id: `callout-${type}`, group: 'Callouts', title, icon,
    active: e => e.isActive('callout', { type }),
    run: e => e.chain().focus().clearNodes().wrapIn('callout', { type }).run(),
  })),
  { id: 'code', group: 'Code & math', title: 'Code block', icon: Code2, active: e => e.isActive('codeBlock'),
    run: e => replaceBlocks(e, (texts, schema) => {
      const code = texts.join('\n');
      return schema.nodes.codeBlock.create(null, code ? [schema.text(code)] : []);
    }) },
  { id: 'math', group: 'Code & math', title: 'Math equation', hint: 'The text is the formula (LaTeX)', icon: Sigma,
    run: e => replaceBlocks(e, (texts, schema) => schema.nodes.blockMath?.create({ latex: texts.join(' ').trim() || 'x' })) },
  { id: 'math-inline', group: 'Code & math', title: 'Inline math', hint: 'Within one line', icon: Radical, textOnly: true,
    run: e => replaceText(e, text => ({ type: 'inlineMath', attrs: { latex: text } })) },
  { id: 'link', group: 'Notes & links', title: 'Link to note', hint: 'Links to the note with this title', icon: FileText, textOnly: true,
    run: e => replaceText(e, text => `[[${text.replace(/[[\]]/g, '')}]]`) },
];

// Only the toggle's title line is selected (headings then change the title's size).
const inTitle = e => { const { $from, $to } = e.state.selection; return $from.parent.type.name === 'detailsSummary' && $from.sameParent($to); };
// The selection starts on a toggle's title: the choice applies to the whole toggle / task list.
const fromTitle = e => e.state.selection.$from.parent.type.name === 'detailsSummary';

/** Run a "Turn into" choice. Starting on a toggle's title, everything but heading sizes (title only)
 *  first turns the whole toggle back into lines, then applies the choice to them. */
function runItem(editor, item) {
  if (fromTitle(editor)) {
    if (item.titleOk && inTitle(editor) && item.id !== 'text') return item.run(editor);
    unwrapToggle(editor);
    if (item.id === 'text') return true;
  }
  return item.run(editor);
}

// What the block where the selection starts is (innermost wins: a heading inside a callout is a heading).
function currentId(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    switch (n.type.name) {
      case 'heading': return `h${n.attrs.level}`;
      case 'codeBlock': return 'code';
      case 'taskList': return 'todo';
      case 'bulletList': return 'ul';
      case 'orderedList': return 'ol';
      case 'details': { let t = false; n.descendants(c => { if (c.type.name === 'taskList') t = true; return !t; }); return t ? 'tasklist' : 'toggle'; }
      case 'callout': return `callout-${n.attrs.type}`;
      case 'blockquote': return 'quote';
      default: break;
    }
  }
  return 'text';
}

// On a toggle's title the menu explains what each choice does there.
function titleHint(editor, item) {
  if (!fromTitle(editor)) return item.hint;
  if (inTitle(editor) && item.titleOk && item.id !== 'text') return 'Size of the toggle’s title';
  if (item.id === 'text') return 'Back to plain lines';
  return item.id === 'toggle' || item.id === 'tasklist' ? item.hint : 'The whole section';
}

export default function TurnInto({ editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = ev => { if (!ref.current?.contains(ev.target)) setOpen(false); };
    const onKey = ev => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => {
    const close = () => setOpen(false);
    editor.on('blur', close);
    return () => editor.off('blur', close);
  }, [editor]);

  const current = ITEMS.find(i => i.id === currentId(editor)) || ITEMS[0];
  const { $from, $to } = editor.state.selection;
  const oneLine = $from.sameParent($to);
  let lastGroup = null;

  return (
    <span className="turn-into" ref={ref}>
      <button type="button" className={`turn-into-btn${open ? ' on' : ''}`} title="Turn into…"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}>
        {current.title} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="turn-into-menu" onMouseDown={e => e.preventDefault()}>
          <div className="turn-into-head">Turn into</div>
          {ITEMS.filter(i => (!i.textOnly || (oneLine && !fromTitle(editor)))).map(item => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            const on = item === current;
            return (
              <div key={item.id}>
                {head && <div className="turn-into-group">{head}</div>}
                <button type="button" className={`turn-into-item${on ? ' on' : ''}`}
                  onClick={() => { runItem(editor, item); setOpen(false); }}>
                  <Icon size={15} />
                  <span><span>{item.title}</span>{titleHint(editor, item) && <small>{titleHint(editor, item)}</small>}</span>
                  {on && <Check size={14} className="turn-into-check" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}
