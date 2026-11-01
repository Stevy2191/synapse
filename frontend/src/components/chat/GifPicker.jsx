// Pick a GIF: search GIPHY/Tenor through the server (when an admin has added a key), or paste a
// link to any GIF.
import { useEffect, useRef, useState } from 'react';
import { Search, Link2 } from 'lucide-react';
import { searchGifs } from '../../chat/client';

export default function GifPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: true, enabled: true, results: [], error: '' });
  const [link, setLink] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const away = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('mousedown', away), 0);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: '' }));
    const t = setTimeout(async () => {
      try {
        const data = await searchGifs(q.trim());
        if (!cancelled) setState({ loading: false, enabled: data.enabled, results: data.results || [], error: '' });
      } catch (err) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: err?.response?.data?.error || 'GIF search isn’t reachable right now' }));
      }
    }, q ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const pickLink = () => {
    const url = link.trim();
    if (!/^https:\/\/\S+$/i.test(url)) return;
    onPick({ url, preview: url, title: 'GIF' });
  };

  return (
    <div ref={ref} className="chat-popover chat-gifs fade-in">
      {state.enabled && (
        <div className="chat-pop-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search GIFs" />
        </div>
      )}
      <div className="chat-gif-grid">
        {!state.enabled ? (
          <p className="chat-pop-note">GIF search isn’t set up on this server yet. An admin can add a free GIPHY or Tenor key in <strong>Settings → Server</strong>. Meanwhile, paste a link to a GIF below.</p>
        ) : state.error ? <p className="chat-pop-note">{state.error}</p>
          : state.loading && !state.results.length ? <p className="chat-pop-note">Loading…</p>
            : !state.results.length ? <p className="chat-pop-note">No GIFs found</p>
              : state.results.map(g => (
                <button key={g.url} type="button" className="chat-gif-cell" onClick={() => onPick(g)} title={g.title}>
                  <img src={g.preview} alt={g.title} loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
      </div>
      <div className="chat-pop-search" style={{ marginTop: 8, marginBottom: 0 }}>
        <Link2 size={14} />
        <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pickLink(); } }}
          placeholder="…or paste a GIF link (https://…)" />
        {link.trim() && <button type="button" className="chat-pop-btn" onClick={pickLink}>Send</button>}
      </div>
      {state.enabled && <div className="chat-pop-credit">Powered by GIF search</div>}
    </div>
  );
}
