// A published note, as visitors see it at /p/<link> — no account needed.
// Asks for the PIN/password if the link has one; for end-to-end encrypted links, unscrambles the note
// here in the browser with the key from the link (the part after "#", never sent to the server).
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Download, FileText, FileType2, Globe, ShieldCheck, Loader2 } from 'lucide-react';
import Logo from '../components/Logo';
import { decryptPayload } from '../publish/client';

async function call(path, body) {
  const res = await fetch(`/api/public/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, data });
  return data;
}

function download(data, name, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const fileName = s => String(s || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'Note';

export default function PublicNotePage() {
  const { id } = useParams();
  const [state, setState] = useState({ step: 'loading' }); // loading | pin | ready | error
  const [pin, setPin] = useState('');
  const [doc, setDoc] = useState(null);       // { html, body, css, title }
  const [menu, setMenu] = useState(false);
  const pinRef = useRef('');
  const key = new URLSearchParams(location.hash.slice(1)).get('k');

  async function open(withPin) {
    try {
      const r = await call(`${id}/open`, { pin: withPin });
      pinRef.current = withPin;
      let payload = r;
      if (r.mode === 'e2e') {
        if (!key) throw new Error('This link is missing its secret part (everything after “#”). Ask for the full link.');
        try { payload = await decryptPayload(r.blob, key); } catch { throw new Error('This link’s secret part is wrong or incomplete — ask for the full link again.'); }
      }
      const { buildDocument } = await import('../export/render');
      const note = { ...payload.note, depth: 0 };
      const built = await buildDocument([note], [note, ...(payload.drawings || [])], { title: note.title, pageBreaks: false });
      document.title = `${note.title} · Synapse`;
      setDoc({ ...built, title: note.title });
      setState({ step: 'ready', mode: r.mode, allowDownload: r.allow_download });
    } catch (err) {
      if (err.status === 401) setState({ step: 'pin', error: withPin ? err.message : '' });
      else setState({ step: 'error', error: err.message });
    }
  }

  useEffect(() => {
    call(id).then(meta => {
      if (meta.needs_pin) setState({ step: 'pin', mode: meta.mode });
      else open('');
    }).catch(err => setState({ step: 'error', error: err.message }));
  }, [id]);

  // Normal links show the latest version: refresh when the visitor comes back to the tab.
  useEffect(() => {
    if (state.step !== 'ready' || state.mode !== 'live') return undefined;
    const onFocus = () => { if (document.visibilityState === 'visible') open(pinRef.current); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [state.step, state.mode]);

  const print = () => {
    const frame = document.querySelector('.public-frame');
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* ignore */ }
    setMenu(false);
  };
  const word = async () => {
    setMenu(false);
    const { htmlToDocx } = await import('../export/docx');
    download(await htmlToDocx(doc, { title: doc.title }), `${fileName(doc.title)}.docx`);
  };

  return (
    <div className="public-page">
      <header className="public-bar">
        <a href="/" className="public-brand" title="Synapse"><Logo size={22} /> <span>Synapse</span></a>
        <span className="public-title">{doc?.title || ''}</span>
        {state.step === 'ready' && state.mode === 'e2e' && <span className="public-badge" title="This page was unscrambled in your browser; the server only has a scrambled copy."><ShieldCheck size={13} /> End-to-end encrypted</span>}
        {state.step === 'ready' && state.allowDownload && (
          <span style={{ position: 'relative' }}>
            <button className="btn-ghost" onClick={() => setMenu(m => !m)}><Download size={15} /> Download</button>
            {menu && (
              <div className="public-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={print}><FileText size={14} /> PDF (print → Save as PDF)</button>
                <button onClick={word}><FileType2 size={14} /> Word (.docx)</button>
                <button onClick={() => { download(doc.html, `${fileName(doc.title)}.html`, 'text/html'); setMenu(false); }}><Globe size={14} /> Web page (.html)</button>
              </div>
            )}
          </span>
        )}
      </header>
      {state.step === 'loading' && <div className="public-center"><Loader2 size={20} className="spin" /></div>}
      {state.step === 'error' && <div className="public-center"><p>{state.error}</p></div>}
      {state.step === 'pin' && (
        <div className="public-center">
          <form className="public-pin" onSubmit={e => { e.preventDefault(); if (pin) open(pin); }}>
            <Lock size={26} style={{ color: 'var(--accent)' }} />
            <h1>This note is protected</h1>
            <p>Enter the PIN or password you were given.</p>
            <input autoFocus type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN or password" />
            {state.error && <p className="public-error">{state.error}</p>}
            <button className="export-go" type="submit" disabled={!pin}>Open</button>
          </form>
        </div>
      )}
      {state.step === 'ready' && doc && (
        <iframe className="public-frame" title={doc.title} srcDoc={doc.html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals" />
      )}
    </div>
  );
}
