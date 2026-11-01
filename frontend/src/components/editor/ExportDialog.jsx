// "Export" window: save a note (or a note with everything inside it, or a whole workspace) as
// PDF, Word, Markdown or a web page.
import { useEffect, useState } from 'react';
import { X, FileText, FileType2, FileCode2, Globe, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';

const FORMATS = [
  { key: 'pdf', label: 'PDF', icon: FileText, desc: 'For printing and sharing. Looks exactly like the note.' },
  { key: 'docx', label: 'Word', icon: FileType2, desc: 'A .docx you can keep editing in Word or Google Docs.' },
  { key: 'markdown', label: 'Markdown', icon: FileCode2, desc: 'Plain .md files with pictures — works with Obsidian.' },
  { key: 'html', label: 'Web page', icon: Globe, desc: 'One .html file that opens in any browser, offline.' },
];

const PREFS_KEY = 'synapse-export-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
const defaultPageSize = () => (/^en-(US|CA)|^es-(MX|US)|^fr-CA/.test(navigator.language || '') ? 'Letter' : 'A4');

export default function ExportDialog({ note, onClose }) {
  const workspace = useStore(s => s.activeWorkspace);
  const tree = useStore(s => s.notes);
  const hasChildren = tree.some(n => n.parent_id === note.id);
  const prefs = loadPrefs();
  const [format, setFormat] = useState(prefs.format || 'pdf');
  const [scope, setScope] = useState('note');
  const [pageSize, setPageSize] = useState(prefs.pageSize || defaultPageSize());
  const [pageBreaks, setPageBreaks] = useState(prefs.pageBreaks ?? true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const count = scope === 'note' ? 1 : scope === 'workspace' ? tree.length : (() => {
    let n = 0;
    const walk = id => { n++; for (const c of tree.filter(x => x.parent_id === id)) walk(c.id); };
    walk(note.id);
    return n;
  })();
  const paged = format === 'pdf' || format === 'docx';

  const go = async () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ format, pageSize, pageBreaks })); } catch { /* private mode */ }
    setBusy('Getting ready…');
    try {
      const { runExport } = await import('../../export');
      const r = await runExport({ format, scope, noteId: note.id, workspace, pageSize, pageBreaks, onProgress: setBusy });
      if (r.printed) toast('The server could not make the PDF, so your browser’s print window opened — choose “Save as PDF”.', { duration: 7000 });
      else toast.success('Exported — check your downloads');
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err?.message || 'Export failed');
      setBusy('');
    }
  };

  const option = (on) => ({
    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    color: 'var(--text-primary)', font: '400 13px var(--font-sans)', width: '100%',
  });
  const label = { font: '600 11px var(--font-sans)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', margin: '18px 0 8px' };

  return (
    <div className="export-backdrop" onClick={() => !busy && onClose()}>
      <div className="export-dialog fade-in" role="dialog" aria-label="Export" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ font: '700 20px var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Export</h2>
          <button className="btn-ghost" onClick={onClose} disabled={!!busy} title="Close" style={{ width: 30, height: 30, padding: 0, justifyContent: 'center' }}><X size={17} /></button>
        </div>

        <div style={label}>Format</div>
        <div className="export-formats">
          {FORMATS.map(f => (
            <button key={f.key} type="button" style={option(format === f.key)} onClick={() => setFormat(f.key)} disabled={!!busy}>
              <f.icon size={20} style={{ color: format === f.key ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
              <span><span style={{ fontWeight: 600, display: 'block' }}>{f.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 }}>{f.desc}</span></span>
            </button>
          ))}
        </div>

        <div style={label}>What to export</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {[
            ['note', `This note — “${note.title || 'Untitled'}”`],
            ...(hasChildren ? [['subtree', 'This note and the notes inside it']] : []),
            ['workspace', `Everything in “${workspace?.name || 'this workspace'}”`],
          ].map(([key, text]) => (
            <label key={key} className="export-radio">
              <input type="radio" name="export-scope" checked={scope === key} onChange={() => setScope(key)} disabled={!!busy} />
              <span>{text}</span>
            </label>
          ))}
        </div>

        {paged && (
          <>
            <div style={label}>Page</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="seg">
                {['A4', 'Letter'].map(s => (
                  <button key={s} type="button" className={pageSize === s ? 'on' : ''} onClick={() => setPageSize(s)} disabled={!!busy}>{s}</button>
                ))}
              </div>
              {count > 1 && (
                <label className="export-radio" style={{ padding: 0, border: 'none', background: 'none' }}>
                  <input type="checkbox" checked={pageBreaks} onChange={e => setPageBreaks(e.target.checked)} disabled={!!busy} />
                  <span>Start each note on a new page</span>
                </label>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          {busy && <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="spin" /> {busy}</span>}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button type="button" className="export-go" onClick={go} disabled={!!busy}>
            {busy ? 'Exporting…' : `Export ${count > 1 ? `${count} notes` : ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
