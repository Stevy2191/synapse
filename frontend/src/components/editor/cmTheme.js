// CodeMirror styling built from the app's CSS variables, so the markdown editor matches
// whichever theme is active (light or dark) instead of always being One Dark.
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const editorTheme = EditorView.theme({
  '&': { color: 'var(--text-primary)', backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-placeholder': { color: 'var(--text-muted)' },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.45em', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' },
  { tag: t.heading2, fontSize: '1.25em', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--text-primary)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-primary)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: t.monospace, color: 'var(--accent-hover)' },
  { tag: [t.processingInstruction, t.meta, t.punctuation, t.contentSeparator], color: 'var(--text-muted)' },
  { tag: t.list, color: 'var(--text-primary)' },
  { tag: [t.keyword, t.atom, t.bool], color: 'var(--accent)' },
  { tag: [t.string, t.number], color: 'var(--success)' },
  { tag: t.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
]);

export const synapseEditorTheme = [editorTheme, syntaxHighlighting(highlight)];
