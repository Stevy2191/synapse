// /open-file?att=<attachment id>  or  /open-file?src=<source>&id=<file id> — opened from a file chip
// in a note. Fetches the file with your sign-in, then shows it (pictures, PDFs, text, audio/video)
// or downloads it.
import { useEffect, useState } from 'react';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import Logo from '../components/Logo';
import { fetchFile, saveBlob, errorText, bytes } from '../files/client';

const VIEWABLE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/|video\/(mp4|webm))/;

export default function OpenFilePage() {
  const q = new URLSearchParams(location.search);
  const name = q.get('name') || 'File';
  const [state, setState] = useState({ step: 'loading' });

  useEffect(() => {
    document.title = `${name} · Synapse`;
    let url;
    fetchFile({ att: q.get('att'), source: q.get('src'), id: q.get('id') }).then(f => {
      const viewable = VIEWABLE.test(f.type || '');
      url = URL.createObjectURL(viewable ? new Blob([f.blob], { type: f.type }) : f.blob);
      setState({ step: 'ready', url, file: f, viewable });
      if (!viewable) saveBlob(f.blob, f.name);
    }).catch(err => setState({ step: 'error', error: errorText(err, err?.response?.status === 404 ? 'This file isn’t there any more, or you don’t have access to it.' : 'Couldn’t open the file') }));
    return () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000); };
  }, []);

  const f = state.file;
  return (
    <div className="openfile-page">
      <header className="public-bar">
        <a href="/" className="public-brand" title="Synapse"><Logo size={22} /> <span>Synapse</span></a>
        <span className="public-title">{f?.name || name}{f ? <small> · {bytes(f.blob.size)}</small> : null}</span>
        {state.step === 'ready' && <button type="button" className="btn-ghost" onClick={() => saveBlob(f.blob, f.name)}><Download size={15} /> Download</button>}
      </header>
      {state.step === 'loading' && <div className="public-center"><Loader2 size={20} className="spin" /></div>}
      {state.step === 'error' && <div className="public-center"><p><AlertTriangle size={16} style={{ verticalAlign: -3, color: 'var(--danger)' }} /> {state.error}</p></div>}
      {state.step === 'ready' && !state.viewable && (
        <div className="public-center"><p>“{f.name}” is downloading. If it didn’t, use <b>Download</b> above.</p></div>
      )}
      {state.step === 'ready' && state.viewable && (
        f.type.startsWith('image/') ? <div className="openfile-view"><img src={state.url} alt={f.name} /></div>
          : f.type.startsWith('audio/') ? <div className="public-center"><audio src={state.url} controls autoPlay /></div>
            : f.type.startsWith('video/') ? <div className="openfile-view"><video src={state.url} controls /></div>
              : <iframe className="openfile-frame" title={f.name} src={state.url} sandbox={f.type === 'application/pdf' ? undefined : ''} />
      )}
    </div>
  );
}
