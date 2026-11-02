// Comments on notes (team features part 2): API calls, the highlight mark in the editor, and helpers
// to find / remove a thread's highlight. Comments are online-only (they're a conversation).
import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import api from '../api';

export const getThreads = noteId => api.get(`/comments/note/${noteId}`).then(r => r.data);
export const addThread = (noteId, { id, anchored, quote, body }) => api.post(`/comments/note/${noteId}`, { id, anchored, quote, body }).then(r => r.data);
export const reply = (noteId, threadId, body) => api.post(`/comments/note/${noteId}`, { thread_id: threadId, body }).then(r => r.data);
export const editComment = (id, body) => api.patch(`/comments/${id}`, { body }).then(r => r.data);
export const deleteComment = id => api.delete(`/comments/${id}`).then(r => r.data);
export const resolveThread = (id, resolved) => api.post(`/comments/${id}/resolve`, { resolved }).then(r => r.data);

export const newThreadId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Highlighted text a comment thread is about: <span data-comment="<thread id>">. */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { id: { default: null, parseHTML: el => el.getAttribute('data-comment'), renderHTML: a => (a.id ? { 'data-comment': a.id } : {}) } };
  },
  parseHTML() { return [{ tag: 'span[data-comment]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey('commentClick'),
      props: {
        handleClick(view, pos, event) {
          const el = event.target.closest?.('.comment-mark');
          if (!el) return false;
          editor.emit('synapse:comment-open', { id: el.getAttribute('data-comment') });
          return false; // keep the cursor where it was clicked
        },
      },
    })];
  },
});

/** Ranges of a thread's highlight in the editor. */
export function markRanges(editor, id) {
  const ranges = [];
  const type = editor.schema.marks.comment;
  if (!type) return ranges;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.marks.some(m => m.type === type && m.attrs.id === id)) {
      const last = ranges[ranges.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize; else ranges.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  return ranges;
}

export function removeHighlight(editor, id) {
  const ranges = markRanges(editor, id);
  if (!ranges.length) return;
  const tr = editor.state.tr;
  for (const r of ranges) tr.removeMark(r.from, r.to, editor.schema.marks.comment);
  editor.view.dispatch(tr);
}

export function scrollToThread(editor, id) {
  const r = markRanges(editor, id)[0];
  if (!r) return false;
  editor.chain().setTextSelection(r).scrollIntoView().run();
  return true;
}
