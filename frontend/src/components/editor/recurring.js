// Task dates in the editor:
//   TaskWhen — shows 📅 dates / ⏰ times / 🔁 repeats in checklist items as small chips (overdue in red);
//              clicking one opens the "Due date & reminder" window (RichEditor listens for synapse:taskWhen).
//   Ticking a repeating task (🔁 every week…) moves it to its next date and unticks it, like a to-do app.
// applyWhen() rewrites a task's tokens; the syntax lives in offline/taskWhen.js.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import toast from 'react-hot-toast';
import { DUE, TIME, REPEAT, splitWhen, whenTokens, nextDue, isoOf, fmtDue } from '../../offline/taskWhen';

const glob = re => new RegExp(re.source.replace(/^\\s\*/, ''), re.flags.includes('g') ? re.flags : `${re.flags}g`);
const DUE_G = glob(DUE); const TIME_G = glob(TIME); const REPEAT_G = glob(REPEAT);
const stripG = re => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);

/** Position of the checklist item around `pos` (or null). */
export function taskItemAt(state, pos) {
  const $p = state.doc.resolve(Math.min(pos, state.doc.content.size));
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'taskItem') return $p.before(d);
  return null;
}

/** The text of a checklist item's own line (its first paragraph). */
export function taskItemText(state, itemPos) {
  const item = state.doc.nodeAt(itemPos);
  return item?.firstChild?.textContent || '';
}

/** In `tr`, replace the date / time / repeat of the checklist item at itemPos with `when`. */
function applyWhenTr(tr, itemPos, when) {
  const item = tr.doc.nodeAt(itemPos);
  const para = item?.firstChild;
  if (!para) return;
  const start = itemPos + 2; // inside the first paragraph
  const ranges = [];
  para.descendants((n, p) => {
    if (!n.isText) return;
    for (const re of [DUE, TIME, REPEAT]) for (const m of n.text.matchAll(stripG(re))) ranges.push([start + p + m.index, start + p + m.index + m[0].length]);
  });
  ranges.sort((a, b) => b[0] - a[0]).forEach(([a, b]) => tr.delete(a, b));
  const para2 = tr.doc.nodeAt(itemPos).firstChild;
  let end = start + para2.content.size;
  const trailing = (para2.textContent.match(/\s+$/) || [''])[0].length;
  if (trailing && para2.lastChild?.isText) { tr.delete(end - trailing, end); end -= trailing; }
  const tokens = whenTokens(when);
  if (tokens) tr.insertText(para2.content.size - trailing > 0 ? tokens : tokens.trimStart(), end);
}

/** Set a checklist item's due date / reminder time / repeat (null values remove them). */
export function applyWhen(editor, itemPos, when) {
  const tr = editor.state.tr;
  applyWhenTr(tr, itemPos, when);
  editor.view.dispatch(tr);
  editor.commands.focus();
}

function decorations(doc) {
  const decos = [];
  const today = isoOf(new Date());
  doc.descendants((node, pos) => {
    if (!node.isText || !/[📅⏰🔁]/u.test(node.text)) return;
    const add = (re, cls) => {
      for (const m of node.text.matchAll(re)) {
        const from = pos + m.index;
        let c = cls;
        if (cls === 'due') { const d = m[0].match(/\d{4}-\d{2}-\d{2}/)[0]; c += d < today ? ' overdue' : d === today ? ' today' : ''; }
        decos.push(Decoration.inline(from, from + m[0].length, { class: `task-when ${c}`, title: 'Change the date, reminder or repeat' }));
      }
    };
    add(DUE_G, 'due'); add(TIME_G, 'time'); add(REPEAT_G, 'repeat');
  });
  return DecorationSet.create(doc, decos);
}

export const TaskWhen = Extension.create({
  name: 'taskWhen',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey('taskWhen'),
      state: {
        init: (_, state) => decorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? decorations(tr.doc) : old),
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleClick(view, pos, event) {
          if (!editor.isEditable || !event.target.closest?.('.task-when')) return false;
          const itemPos = taskItemAt(view.state, pos);
          if (itemPos == null) return false;
          editor.emit('synapse:taskWhen', { pos: itemPos });
          return true;
        },
      },
      // A repeating task was just ticked: move it to its next date and untick it.
      appendTransaction(trs, oldState, newState) {
        if (!trs.some(t => t.docChanged) || trs.some(t => t.getMeta('taskRepeat'))) return null;
        const before = [];
        oldState.doc.descendants((n, pos) => {
          if (n.type.name === 'taskItem' && !n.attrs.checked && REPEAT.test(n.firstChild?.textContent || '')) before.push(pos);
        });
        if (!before.length) return null;
        const mapping = new Mapping();
        trs.forEach(t => mapping.appendMapping(t.mapping));
        const tr = newState.tr;
        let next = null;
        for (const old of before) {
          const r = mapping.mapResult(old, -1);
          if (r.deleted) continue;
          const n = newState.doc.nodeAt(r.pos);
          if (!n || n.type.name !== 'taskItem' || !n.attrs.checked) continue;
          const w = splitWhen(n.firstChild?.textContent || '');
          const nd = w.repeat && nextDue(w.due, w.repeat);
          if (!nd) continue;
          const p = tr.mapping.map(r.pos);
          tr.setNodeMarkup(p, undefined, { ...n.attrs, checked: false });
          applyWhenTr(tr, p, { ...w, due: nd });
          next = nd;
        }
        if (!next) return null;
        tr.setMeta('taskRepeat', true);
        setTimeout(() => toast.success(`Done — it repeats, next on ${fmtDue(next)}`), 0);
        return tr;
      },
    })];
  },
});
