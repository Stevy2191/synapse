import { useEffect } from 'react';
import { FileText, GitFork, Pencil, X } from 'lucide-react';

const NOTE_TYPES = [
  {
    type: 'note',
    icon: <FileText size={32} />,
    emoji: '📄',
    label: 'Note',
    desc: 'Rich text or markdown. Full formatting toolbar, wiki links, tags.',
  },
  {
    type: 'diagram',
    icon: <GitFork size={32} />,
    emoji: '📊',
    label: 'Diagram',
    desc: 'Flowchart canvas with shapes, connectors and arrows. Great for system diagrams.',
  },
  {
    type: 'draw',
    icon: <Pencil size={32} />,
    emoji: '✏️',
    label: 'Free Draw',
    desc: 'Freehand whiteboard with pen, eraser, and sticky notes.',
  },
];

export default function NewNoteModal({ onSelect, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)',
        padding: 32, width: 560, boxShadow: '0 32px 80px rgba(0,0,0,0.6)'
      }} onClick={e => e.stopPropagation()} className="fade-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>New Note</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Choose a note type to get started</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {NOTE_TYPES.map(nt => (
            <button
              key={nt.type}
              onClick={() => onSelect(nt.type)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                padding: '24px 16px', borderRadius: 12, border: '1px solid var(--border)',
                background: 'var(--bg-elevated)', cursor: 'pointer', transition: 'all 0.2s',
                fontFamily: 'var(--font-sans)', textAlign: 'center',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.border = '1px solid var(--accent)';
                e.currentTarget.style.background = 'var(--accent-subtle)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.border = '1px solid var(--border)';
                e.currentTarget.style.background = 'var(--bg-elevated)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{ fontSize: 40 }}>{nt.emoji}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{nt.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{nt.desc}</span>
            </button>
          ))}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 20 }}>
          Press <kbd style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>Esc</kbd> to cancel
        </p>
      </div>
    </div>
  );
}
