import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { kindInfo } from '../noteKinds';

import { useStore } from '../../stores/useStore';
import { searchNotes, openNote } from '../../offline/sync';

export default function SearchModal() {
  const { searchOpen, setSearchOpen, activeWorkspace } = useStore(s => ({
    searchOpen: s.searchOpen, setSearchOpen: s.setSearchOpen,
    activeWorkspace: s.activeWorkspace
  }));
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (searchOpen) { setQ(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [searchOpen]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim() || !activeWorkspace) { setResults([]); return; }
    setLoading(true);
    // Searches this device's copy, so it works offline too.
    timer.current = setTimeout(async () => {
      try { setResults(await searchNotes(activeWorkspace.id, q)); }
      finally { setLoading(false); }
    }, 150);
  }, [q, activeWorkspace]);

  const select = async (id) => {
    await openNote(id);
    setSearchOpen(false);
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSearchOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!searchOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh',
      backdropFilter: 'blur(4px)'
    }} onClick={() => setSearchOpen(false)}>
      <div style={{
        width: 'min(580px, calc(100vw - 24px))', background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)',
        overflow: 'hidden', boxShadow: 'var(--shadow)'
      }} onClick={e => e.stopPropagation()} className="fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search notes..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 16, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}
          />
          {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>searching...</span>}
          <button onClick={() => setSearchOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {results.length === 0 && q && !loading && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 14 }}>No results for "{q}"</p>
          )}
          {!q && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 14 }}>
              Type to search across all notes in {activeWorkspace?.name || 'your workspace'}
            </p>
          )}
          {results.map(r => (
            <div key={r.id} onClick={() => select(r.id)} style={{
              padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', transition: 'all 0.1s'
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                {(() => { const k = kindInfo(r); const Icon = k.icon; return <Icon size={14} style={{ color: k.color || 'var(--accent)' }} aria-label={k.label} />; })()}
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}
                dangerouslySetInnerHTML={{ __html: r.excerpt || '' }}
              />
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 16 }}>
          {[['↵', 'Open'], ['Esc', 'Close']].map(([key, label]) => (
            <span key={key} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <kbd style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)', marginRight: 4 }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
