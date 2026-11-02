// Optional formatting bar fixed at the top of a Write-mode note (like the Markdown toolbar).
// Turned on/off with the button next to Write / Markdown; remembered on this device.
import { useEffect, useReducer } from 'react';
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Code, Highlighter, List, ListOrdered, ListChecks, ListTodo, Quote, Code2,
  Link as LinkIcon, Paperclip, ScanText, Mic, Image as ImageIcon, Table as TableIcon, Minus, AlignLeft, AlignCenter, AlignRight, ListCollapse,
} from 'lucide-react';
import TurnInto from './TurnInto';
import { SLASH_ITEMS } from './extensions';
import { textLevel, setTextLevel } from './blocks';

const slash = (editor, id) => {
  const item = SLASH_ITEMS.find(i => i.id === id);
  const at = editor.state.selection.from;
  item?.run(editor, { from: at, to: at });
};

function setLink(editor) {
  const prev = editor.getAttributes('link').href || '';
  const url = prompt('Link address (leave empty to remove the link):', prev);
  if (url === null) return;
  if (!url.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  const href = /^[a-z]+:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}

export default function RichToolbar({ editor }) {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    editor.on('transaction', rerender);
    editor.on('selectionUpdate', rerender);
    editor.on('focus', rerender);
    return () => { editor.off('transaction', rerender); editor.off('selectionUpdate', rerender); editor.off('focus', rerender); };
  }, [editor]);
  if (!editor || editor.isDestroyed) return <div className="rich-toolbar" />;

  const level = textLevel(editor);
  const btn = (key, icon, title, run, on = false, disabled = false) => (
    <button key={key} type="button" className={`rich-tb-btn${on ? ' on' : ''}`} title={title} disabled={disabled}
      onMouseDown={e => { e.preventDefault(); if (!disabled) run(); }}>{icon}</button>
  );
  const sep = k => <span key={k} className="rich-tb-sep" />;
  const H = n => <b className="rich-tb-h">H{n}</b>;

  return (
    <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
      {btn('undo', <Undo2 size={15} />, 'Undo (Ctrl+Z)', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
      {btn('redo', <Redo2 size={15} />, 'Redo (Ctrl+Shift+Z)', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      {sep('s0')}
      <TurnInto editor={editor} />
      {sep('s1')}
      {btn('b', <Bold size={15} />, 'Bold (Ctrl+B)', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {btn('i', <Italic size={15} />, 'Italic (Ctrl+I)', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {btn('u', <Underline size={15} />, 'Underline (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
      {btn('s', <Strikethrough size={15} />, 'Strikethrough', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
      {btn('code', <Code size={15} />, 'Inline code', () => editor.chain().focus().toggleCode().run(), editor.isActive('code'))}
      {btn('hl', <Highlighter size={15} />, 'Highlight', () => editor.chain().focus().toggleHighlight().run(), editor.isActive('highlight'))}
      {sep('s2')}
      {[1, 2, 3].map(n => btn(`h${n}`, H(n), `Heading ${n} — click again for normal text (works on toggle and task list titles too)`, () => setTextLevel(editor, level === n ? 0 : n), level === n))}
      {sep('s3')}
      {btn('ul', <List size={15} />, 'Bulleted list', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('ol', <ListOrdered size={15} />, 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('todo', <ListChecks size={15} />, 'Checklist', () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'))}
      {btn('tasklist', <ListTodo size={15} />, 'Task list (named checklist that counts what’s left)', () => slash(editor, 'tasklist'))}
      {btn('toggle', <ListCollapse size={15} />, 'Toggle section', () => slash(editor, 'toggle'))}
      {sep('s4')}
      {btn('quote', <Quote size={15} />, 'Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
      {btn('codeblock', <Code2 size={15} />, 'Code block', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
      {sep('s5')}
      {btn('link', <LinkIcon size={15} />, 'Link', () => setLink(editor), editor.isActive('link'))}
      {btn('image', <ImageIcon size={15} />, 'Image from this device', () => slash(editor, 'upload'))}
      {btn('file', <Paperclip size={15} />, 'File from a folder or drive (attach a copy or link)', () => editor.emit('synapse:pickFile'))}
      {btn('meeting', <Mic size={15} />, 'Record a meeting (transcript with speakers)', () => editor.emit('synapse:record'))}
      {btn('ocr', <ScanText size={15} />, 'Text from a picture or PDF (or click a picture → Read text)', () => slash(editor, 'ocr'))}
      {btn('table', <TableIcon size={15} />, 'Table', () => slash(editor, 'table'), false, editor.isActive('table'))}
      {btn('hr', <Minus size={15} />, 'Divider', () => slash(editor, 'divider'))}
      {sep('s6')}
      {btn('al', <AlignLeft size={15} />, 'Align left', () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }))}
      {btn('ac', <AlignCenter size={15} />, 'Align centre', () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }))}
      {btn('ar', <AlignRight size={15} />, 'Align right', () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }))}
    </div>
  );
}
