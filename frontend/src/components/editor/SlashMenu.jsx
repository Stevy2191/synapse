import { useState, useEffect, useRef } from 'react';

const COMMANDS = [
  { id: 'h1',       label: 'Heading 1',     icon: 'H1', desc: 'Large section heading',    shortcut: '#' },
  { id: 'h2',       label: 'Heading 2',     icon: 'H2', desc: 'Medium section heading',   shortcut: '##' },
  { id: 'h3',       label: 'Heading 3',     icon: 'H3', desc: 'Small section heading',    shortcut: '###' },
  { id: 'bullet',   label: 'Bullet List',   icon: '•',  desc: 'Unordered list',           shortcut: '-' },
  { id: 'numbered', label: 'Numbered List', icon: '1.', desc: 'Ordered list',             shortcut: '1.' },
  { id: 'todo',     label: 'To-do',         icon: '☐',  desc: 'Checkbox task list',       shortcut: '[]' },
  { id: 'quote',    label: 'Quote',         icon: '"',  desc: 'Blockquote',               shortcut: '>' },
  { id: 'code',     label: 'Code Block',    icon: '<>', desc: 'Syntax-highlighted code',  shortcut: '```' },
  { id: 'divider',  label: 'Divider',       icon: '—',  desc: 'Horizontal separator',     shortcut: '---' },
  { id: 'image',    label: 'Image',         icon: '🖼', desc: 'Embed image by URL',       shortcut: '' },
];

export default function SlashMenu({ query, position, onSelect, onClose }) {
  const [active, setActive] = useState(0);
  const ref = useRef(null);

  const filtered = COMMANDS.filter(c =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase())
  );

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); if (filtered[active]) onSelect(filtered[active].id); }
      if (e.key === 'Escape')    { onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, active, onSelect, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (filtered.length === 0) return null;

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: position.y + 8,
      left: position.x,
      width: 280,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      zIndex: 9999,
      overflow: 'hidden',
      maxHeight: 360,
      overflowY: 'auto',
    }}>
      <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
        BLOCKS
      </div>
      {filtered.map((cmd, i) => (
        <div
          key={cmd.id}
          data-idx={i}
          onClick={() => onSelect(cmd.id)}
          onMouseEnter={() => setActive(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            cursor: 'pointer', transition: 'background 0.1s',
            background: i === active ? 'var(--accent-subtle)' : 'transparent',
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: i === active ? 'var(--accent)' : 'var(--bg-hover)',
            color: i === active ? '#fff' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)', flexShrink: 0,
          }}>
            {cmd.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: i === active ? 'var(--accent-hover)' : 'var(--text-primary)' }}>{cmd.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{cmd.desc}</div>
          </div>
          {cmd.shortcut && (
            <kbd style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              {cmd.shortcut}
            </kbd>
          )}
        </div>
      ))}
    </div>
  );
}
