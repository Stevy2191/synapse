// New → Import notes: bring notes in from Obsidian, Notion, Evernote or OneNote. Everything goes
// into one new folder ("Imported from … – date") in the workspace that's open (import/*.js).
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, CheckCircle2, AlertTriangle, FolderOpen, FileArchive, Upload, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import { useStore } from '../../stores/useStore';
import { myRole } from '../../team/team';
import { openNote } from '../../offline/sync';

const SOURCES = [
  { id: 'obsidian', name: 'Obsidian', logo: '🟣', desc: 'Your vault folder, or a .zip of it' },
  { id: 'notion', name: 'Notion', logo: '⬛', desc: 'The .zip from Notion’s “Export” (Markdown & CSV)' },
  { id: 'evernote', name: 'Evernote', logo: '🟢', desc: '.enex files exported from Evernote' },
  { id: 'onenote', name: 'OneNote', logo: '🟪', desc: 'Straight from your Microsoft account' },
];

export default function ImportDialog({ onClose }) {
  const ws = useStore(s => s.activeWorkspace);
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(null);   // progress text while importing
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const close = () => { if (!busy) onClose(); };
  const viewOnly = myRole(ws) === 'view';

  const run = async (fn) => {
    setError(''); setBusy('Starting…');
    try {
      const r = await fn(msg => setBusy(msg));
      setResult(r);
    } catch (err) {
      console.error(err);
      setError(err.message || 'The import failed');
    } finally { setBusy(null); }
  };

  return (
    <Modal title={result ? 'Import finished' : source ? `Import from ${SOURCES.find(s => s.id === source).name}` : 'Import notes'} onClose={close} width={560}>
      {busy ? (
        <div className="imp-busy"><Loader2 size={22} className="spin" /><p>{busy}</p><small>Keep this window open until it’s done.</small></div>
      ) : result ? (
        <Done result={result} onOpen={() => { openNote(result.rootId); onClose(); }} />
      ) : viewOnly ? (
        <p className="imp-hint">You can only view the workspace “{ws?.name}”, so notes can’t be imported into it. Switch to one of your own workspaces first.</p>
      ) : !source ? (
        <>
          <p className="imp-hint">Notes go into a new folder in <b>{ws?.name}</b>, keeping their folders, pictures, files and links. You can move them afterwards, or delete the folder to undo it.</p>
          <div className="imp-sources">
            {SOURCES.map(s => (
              <button key={s.id} type="button" className="imp-source" onClick={() => { setSource(s.id); setError(''); }}>
                <span className="imp-logo">{s.logo}</span>
                <span><b>{s.name}</b><small>{s.desc}</small></span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="btn-ghost imp-back" onClick={() => { setSource(null); setError(''); }}><ChevronLeft size={15} /> Other apps</button>
          {source === 'obsidian' && <FilesStep kind="obsidian" ws={ws} run={run} />}
          {source === 'notion' && <FilesStep kind="notion" ws={ws} run={run} />}
          {source === 'evernote' && <FilesStep kind="evernote" ws={ws} run={run} />}
          {source === 'onenote' && <OneNoteStep ws={ws} run={run} />}
        </>
      )}
      {error && <p className="imp-error"><AlertTriangle size={14} /> <span>{error}</span></p>}
    </Modal>
  );
}

const HOWTO = {
  obsidian: <>Choose your <b>vault folder</b> (the folder with your notes), or a <b>.zip</b> of it. Folders, pictures, PDFs, tags and <code>[[links]]</code> come along.</>,
  notion: <>In Notion open <b>Settings → Export all workspace content</b> (or <b>⋯ → Export</b> on one page), choose <b>Markdown &amp; CSV</b> with <b>Include subpages</b>, then pick the <b>.zip</b> file here. Pages keep their sub-pages, pictures and links; databases become tables.</>,
  evernote: <>In Evernote, right-click a notebook → <b>Export notebook</b> and save the <b>.enex</b> file. Pick one or several files here (one per notebook). Pictures, attachments, checklists and tags come along.</>,
};

function FilesStep({ kind, ws, run }) {
  const zipRef = useRef(null);
  const dirRef = useRef(null);
  const go = files => {
    if (!files?.length) return;
    const list = [...files];
    run(async progress => {
      if (kind === 'evernote') return (await import('../../import/evernote')).importEvernote(list, ws.id, progress);
      return (await import('../../import/markdownVault')).importVault(list, kind, ws.id, progress);
    });
  };
  return (
    <>
      <p className="imp-hint">{HOWTO[kind]}</p>
      <input ref={zipRef} type="file" hidden multiple={kind === 'evernote'} accept={kind === 'evernote' ? '.enex' : '.zip,application/zip'} onChange={e => go(e.target.files)} />
      <input ref={dirRef} type="file" hidden webkitdirectory="" directory="" onChange={e => go(e.target.files)} />
      <div className="imp-actions">
        {kind === 'obsidian' && <button type="button" className="export-go" onClick={() => dirRef.current?.click()}><FolderOpen size={15} /> Choose vault folder</button>}
        <button type="button" className={kind === 'obsidian' ? 'btn-ghost imp-alt' : 'export-go'} onClick={() => zipRef.current?.click()}>
          {kind === 'evernote' ? <><Upload size={15} /> Choose .enex files</> : <><FileArchive size={15} /> Choose a .zip file</>}
        </button>
      </div>
      <p className="imp-small">Files are read in this browser — nothing is sent anywhere except your own Synapse server.</p>
    </>
  );
}

function OneNoteStep({ ws, run }) {
  const [status, setStatus] = useState(null);
  const [books, setBooks] = useState(null);
  const [picked, setPicked] = useState(new Set()); // section ids
  const [loadErr, setLoadErr] = useState('');
  const mod = useRef(null);
  const load = async () => {
    mod.current ||= await import('../../import/onenote');
    const st = await mod.current.oneNoteStatus().catch(() => null);
    setStatus(st);
    if (st?.access === 'yes') {
      setLoadErr('');
      try { setBooks(await mod.current.oneNoteNotebooks()); } catch (err) { setLoadErr(err.response?.data?.error || err.message); }
    }
  };
  useEffect(() => { load(); }, []);
  const connect = async () => {
    try { await mod.current.connectOneNote(); await load(); } catch (err) { toast.error(err.message); }
  };

  // Flatten notebooks → [{ notebook, path, section }]
  const all = [];
  const walk = (nb, path, node) => {
    for (const s of node.sections || []) all.push({ notebook: nb, path, section: s });
    for (const g of node.groups || []) walk(nb, [...path, g.name], g);
  };
  for (const b of books || []) walk(b.name, [], b);
  const toggle = ids => setPicked(p => { const n = new Set(p); const on = ids.every(id => n.has(id)); for (const id of ids) on ? n.delete(id) : n.add(id); return n; });

  if (!status) return <p className="imp-hint"><Loader2 size={14} className="spin" /> Checking your Microsoft account…</p>;
  if (!status.configured) return <p className="imp-hint">OneNote import uses the Microsoft (OneDrive) connection, which isn’t set up on this server yet. An admin adds it in <b>Settings → Server → Files</b>.</p>;
  if (status.access !== 'yes') {
    return (
      <>
        <p className="imp-hint">{status.access === 'none' ? 'Sign in with your Microsoft account' : 'Allow Synapse to read your notebooks'} — a Microsoft window opens and asks for permission to <b>read your OneNote notebooks</b> (Synapse never changes them).</p>
        <div className="imp-actions"><button type="button" className="export-go" onClick={connect}><LogIn size={15} /> Connect OneNote</button></div>
        <p className="imp-small">Work or school account and it says an administrator must approve? Your Microsoft 365 admin needs to allow the “Notes.Read” permission for this app (in Microsoft Entra: App registrations → your Synapse app → API permissions → add Microsoft Graph → Notes.Read → Grant admin consent).</p>
      </>
    );
  }
  if (loadErr) return <><p className="imp-error"><AlertTriangle size={14} /> <span>{loadErr}</span></p><div className="imp-actions"><button type="button" className="btn-ghost" onClick={connect}>Connect OneNote again</button></div></>;
  if (!books) return <p className="imp-hint"><Loader2 size={14} className="spin" /> Loading your notebooks…</p>;
  if (!all.length) return <p className="imp-hint">No notebooks with sections were found in this Microsoft account.</p>;
  return (
    <>
      <p className="imp-hint">Choose what to bring in. Each section becomes a folder of its pages (sub-pages stay under their page).</p>
      <div className="imp-tree">
        {books.map(b => {
          const mine = all.filter(x => x.notebook === b.name);
          if (!mine.length) return null;
          const ids = mine.map(x => x.section.id);
          return (
            <div key={b.id} className="imp-book">
              <label className="imp-check"><input type="checkbox" checked={ids.every(id => picked.has(id))} onChange={() => toggle(ids)} /> <b>📓 {b.name}</b></label>
              {mine.map(x => (
                <label key={x.section.id} className="imp-check imp-section">
                  <input type="checkbox" checked={picked.has(x.section.id)} onChange={() => toggle([x.section.id])} /> {[...x.path, x.section.name].join(' › ')}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="imp-actions">
        <button type="button" className="export-go" disabled={!picked.size} onClick={() => run(p => mod.current.importOneNote(all.filter(x => picked.has(x.section.id)), ws.id, p))}>
          Import {picked.size || ''} section{picked.size === 1 ? '' : 's'}
        </button>
      </div>
      <p className="imp-small">Large notebooks take a while — Microsoft limits how fast pages can be read.</p>
    </>
  );
}

function Done({ result, onOpen }) {
  const parts = [`${result.count} note${result.count === 1 ? '' : 's'}`];
  if (result.pictures) parts.push(`${result.pictures} picture${result.pictures === 1 ? '' : 's'}`);
  if (result.pdfs) parts.push(`${result.pdfs} PDF${result.pdfs === 1 ? '' : 's'}`);
  if (result.files) parts.push(`${result.files} other file${result.files === 1 ? '' : 's'}`);
  return (
    <>
      <p className="imp-done"><CheckCircle2 size={18} /> <span>Imported {parts.join(', ')} into <b>{result.rootTitle}</b>.</span></p>
      {(result.pdfs > 0 || result.files > 0) && <p className="imp-small">Files upload in the background{navigator.onLine ? '' : ' when you’re back online'} — you can keep working.</p>}
      {result.skipped.length > 0 && (
        <details className="imp-skipped">
          <summary>{result.skipped.length} thing{result.skipped.length === 1 ? '' : 's'} left out or changed</summary>
          <ul>{result.skipped.slice(0, 100).map((s, i) => <li key={i}><b>{s.what}</b> — {s.why}</li>)}</ul>
        </details>
      )}
      <div className="imp-actions"><button type="button" className="export-go" onClick={onOpen}>Open the imported notes</button></div>
    </>
  );
}
