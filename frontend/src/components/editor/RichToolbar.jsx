import { useCallback } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Code, Link, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, List, ListOrdered, ListChecks, Quote, Minus,
  Table, Indent, Outdent, Subscript, Superscript, Highlighter, RemoveFormatting,
  Undo, Redo
} from 'lucide-react';

const FONT_SIZES = ['10', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48'];
const PARA_STYLES = [
  { label: 'Paragraph', value: 'paragraph' },
  { label: 'Heading 1',  value: 'h1' },
  { label: 'Heading 2',  value: 'h2' },
  { label: 'Heading 3',  value: 'h3' },
  { label: 'Heading 4',  value: 'h4' },
];

const TEXT_COLORS = [
  '#e8e8f0','#ef4444','#f97316','#f59e0b','#22c55e','#06b6d4','#6366f1','#a855f7','#ec4899'
];
const HIGHLIGHT_COLORS = [
  '#fef08a','#bbf7d0','#bfdbfe','#ddd6fe','#fce7f3','#fed7aa','#99f6e4'
];

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />;
}

function ToolBtn({ onClick, active, disabled, title, children }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); if (!disabled) onClick(); }}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 26, height: 26, padding: '0 4px', border: 'none', borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: 12, fontWeight: 600, transition: 'all 0.12s',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => { if (!active && !disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function ColorPicker({ colors, onSelect, title, children }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} className="color-picker-wrap">
      <button
        title={title}
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px', height: 26, border: 'none', borderRadius: 5, cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.nextSibling.style.display = 'flex';
        }}
      >
        {children}
        <span style={{ fontSize: 9 }}>▾</span>
      </button>
      <div
        style={{ display: 'none', position: 'absolute', top: 28, left: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, gap: 5, flexWrap: 'wrap', width: 140, zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
        onMouseLeave={e => { e.currentTarget.style.display = 'none'; e.currentTarget.previousSibling.style.background = 'transparent'; }}
      >
        {colors.map(c => (
          <div key={c} onMouseDown={e => { e.preventDefault(); onSelect(c); e.currentTarget.parentElement.style.display = 'none'; }} style={{ width: 20, height: 20, borderRadius: 4, background: c, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }} />
        ))}
      </div>
    </div>
  );
}

export default function RichToolbar({ editor }) {
  if (!editor) return null;

  const currentParaStyle = () => {
    for (let i = 1; i <= 4; i++) if (editor.isActive('heading', { level: i })) return `h${i}`;
    return 'paragraph';
  };

  const setParaStyle = (val) => {
    if (val === 'paragraph') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: parseInt(val[1]) }).run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const setLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = prompt('URL:', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url, target: '_blank' }).run();
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2,
      padding: '4px 8px', background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)', flexShrink: 0, minHeight: 38,
    }}>
      {/* Undo/Redo */}
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo size={13}/></ToolBtn>
      <Divider />

      {/* Paragraph style */}
      <select
        value={currentParaStyle()}
        onChange={e => setParaStyle(e.target.value)}
        style={{ height: 26, padding: '0 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', outline: 'none' }}
      >
        {PARA_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <Divider />

      {/* Font size */}
      <select
        value={editor.getAttributes('textStyle').fontSize?.replace('px','') || '14'}
        onChange={e => editor.chain().focus().setMark('textStyle', { fontSize: e.target.value + 'px' }).run()}
        style={{ height: 26, width: 52, padding: '0 4px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', outline: 'none' }}
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <Divider />

      {/* Text formatting */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)"><Bold size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)"><Italic size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)"><Underline size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code"><Code size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript"><Subscript size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript"><Superscript size={13}/></ToolBtn>
      <Divider />

      {/* Colors */}
      <ColorPicker colors={TEXT_COLORS} onSelect={c => editor.chain().focus().setColor(c).run()} title="Text color">
        <span style={{ fontWeight: 800, fontSize: 13 }}>A</span>
      </ColorPicker>
      <ColorPicker colors={HIGHLIGHT_COLORS} onSelect={c => editor.chain().focus().toggleHighlight({ color: c }).run()} title="Highlight">
        <Highlighter size={13}/>
      </ColorPicker>
      <Divider />

      {/* Alignment */}
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left"><AlignLeft size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center"><AlignCenter size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right"><AlignRight size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify"><AlignJustify size={13}/></ToolBtn>
      <Divider />

      {/* Lists */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist"><ListChecks size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().sinkListItem('listItem').run()} disabled={!editor.can().sinkListItem('listItem')} title="Indent"><Indent size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().liftListItem('listItem').run()} disabled={!editor.can().liftListItem('listItem')} title="Outdent"><Outdent size={13}/></ToolBtn>
      <Divider />

      {/* Blocks */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote"><Quote size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{`</>`}</span></ToolBtn>
      <ToolBtn onClick={insertTable} title="Insert table"><Table size={13}/></ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider"><Minus size={13}/></ToolBtn>
      <ToolBtn onClick={setLink} active={editor.isActive('link')} title="Insert link"><Link size={13}/></ToolBtn>
      <Divider />

      {/* Clear */}
      <ToolBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting"><RemoveFormatting size={13}/></ToolBtn>
    </div>
  );
}
