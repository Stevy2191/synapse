import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Code, Link } from 'lucide-react';

export default function FloatingToolbar({ editor }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to || !editor.isFocused) { setPos(null); return; }
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) { setPos(null); return; }
      const range = domSel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) { setPos(null); return; }
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    };
    editor.on('selectionUpdate', update);
    editor.on('blur', () => setTimeout(() => setPos(null), 150));
    return () => { editor.off('selectionUpdate', update); };
  }, [editor]);

  if (!pos || !editor) return null;

  const btn = (active, onClick, icon, title) => (
    <button
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, border: 'none', borderRadius: 6, cursor: 'pointer',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--text-primary)',
        transition: 'all 0.15s',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y - 48,
        left: pos.x,
        transform: 'translateX(-50%)',
        zIndex: 9998,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px',
        animation: 'fadeIn 0.1s ease',
      }}
    >
      {btn(editor.isActive('bold'),   () => editor.chain().focus().toggleBold().run(),   <Bold size={14}/>,   'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={14}/>, 'Italic')}
      {btn(editor.isActive('code'),   () => editor.chain().focus().toggleCode().run(),   <Code size={14}/>,   'Inline code')}
      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          const url = prompt('Enter URL:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--text-primary)' }}
        title="Add link"
      >
        <Link size={14} />
      </button>
    </div>
  );
}
