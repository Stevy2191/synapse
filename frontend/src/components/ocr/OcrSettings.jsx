// Settings → Server → Text recognition (admin): languages, and reading pictures in notes for search.
import { useEffect, useState } from 'react';
import { ScanText, Check, Loader2, Trash2, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';

const errorText = err => err?.response?.data?.error || (err?.response ? 'Something went wrong' : 'You’re offline');

export default function OcrSettings({ styles }) {
  const { heading, lead, section, labelStyle, hint, field, secondary } = styles;
  const [s, setS] = useState(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api.get('/ocr/settings').then(r => setS(r.data)).catch(err => toast.error(errorText(err)));
  useEffect(() => { load(); }, []);
  if (!s) return <div><h3 style={heading}>Text recognition</h3><p style={lead}>Loading…</p></div>;

  const save = async fields => { try { setS((await api.patch('/ocr/settings', fields)).data); } catch (err) { toast.error(errorText(err)); } };
  const toggleLang = code => {
    const on = s.languages.includes(code);
    const next = on ? s.languages.filter(c => c !== code) : [...s.languages, code];
    if (!next.length) { toast.error('Keep at least one language'); return; }
    save({ languages: next }).then(() => toast.success('Saved — pictures will be read again with these languages'));
  };
  const add = async () => {
    if (!adding) return;
    setBusy(adding);
    try {
      const { data } = await api.post(`/ocr/languages/${adding}`, {}, { timeout: 180_000 });
      setS(data);
      await save({ languages: [...new Set([...s.languages, adding])] });
      toast.success(`${s.available[adding]} added`);
      setAdding('');
    } catch (err) { toast.error(errorText(err)); }
    setBusy('');
  };
  const remove = async code => {
    if (!confirm(`Remove ${s.available[code]}? Pictures will only be read in the other languages.`)) return;
    try { setS((await api.delete(`/ocr/languages/${code}`)).data); } catch (err) { toast.error(errorText(err)); }
  };
  const notInstalled = Object.entries(s.available).filter(([c]) => !s.installed.includes(c));

  return (
    <div className="ocr-settings">
      <h3 style={heading}>Text recognition</h3>
      <p style={lead}>Synapse can read the text in pictures, screenshots, photos of documents and scanned PDFs — click a picture in a note and choose <b>Read text</b>, or type <code>/text</code>. It runs on this server (and on each device when it’s offline), so nothing is sent anywhere else. Handwriting uses each person’s own AI assistant.</p>

      <section style={section}>
        <label style={labelStyle}><ScanText size={14} /> Languages</label>
        <p style={{ ...hint, marginTop: 0 }}>Tick the languages your pictures are in. Fewer languages read faster and more accurately.</p>
        <div className="ocr-langs">
          {s.installed.map(code => (
            <div key={code} className="ocr-lang">
              <label><input type="checkbox" checked={s.languages.includes(code)} onChange={() => toggleLang(code)} /> {s.available[code]}</label>
              {code === 'eng' ? <span className="ocr-builtin">built in</span>
                : <button type="button" className="btn-ghost danger-hover" title="Remove" onClick={() => remove(code)}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <select value={adding} onChange={e => setAdding(e.target.value)} style={{ ...field, flex: '0 1 240px' }} disabled={!!busy}>
            <option value="">Add a language…</option>
            {notInstalled.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <button type="button" style={secondary} disabled={!adding || !!busy} onClick={add}>{busy ? <><Loader2 size={13} className="spin" /> Downloading…</> : <><Plus size={13} /> Add</>}</button>
        </div>
        <p style={hint}>Adding a language downloads it to this server once (a few MB) — the server needs internet access for that.</p>
      </section>

      <section style={{ ...section, display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}><Search size={14} /> Search inside pictures</label>
          <p style={{ ...hint, marginTop: 0 }}>
            {s.index_pictures
              ? <>On — Synapse quietly reads the pictures in everyone’s notes so search finds the words in them. {s.indexed} picture{s.indexed === 1 ? '' : 's'} read, {s.with_text} with text{s.waiting ? `, ${s.waiting} note${s.waiting === 1 ? '' : 's'} waiting` : ''}.</>
              : 'Off — search only looks at the typed text in notes.'}
          </p>
        </div>
        <button role="switch" aria-checked={s.index_pictures} className={`toggle${s.index_pictures ? ' on' : ''}`} onClick={() => save({ index_pictures: !s.index_pictures })}><span /></button>
      </section>
      {s.index_pictures && s.waiting === 0 && s.indexed > 0 && <p style={hint}><Check size={12} style={{ color: 'var(--success)' }} /> All pictures read.</p>}
    </div>
  );
}
