// Browse network folders, OneDrive and Google Drive.
//   mode "insert" — pick a file for a note: Attach a copy / Link to it
//   mode "save"   — pick a folder + name to save something (exports)
//   mode "browse" — look around: open, download, upload
import { useEffect, useRef, useState } from 'react';
import {
  Folder, FileText, FileImage, FileSpreadsheet, FileArchive, FileVideo, FileAudio, File as FileIcon, HardDrive, Cloud, ChevronRight,
  Loader2, Upload, Download, ExternalLink, Paperclip, Link2, RefreshCw, Settings as SettingsIcon, ArrowUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import { useStore } from '../../stores/useStore';
import { listSources, listFolder, uploadTo, connectCloud, fetchFile, saveBlob, errorText, bytes, fileHref } from '../../files/client';

export function fileIcon(item, size = 16) {
  if (item.type === 'folder') return <Folder size={size} className="fp-ic folder" />;
  const m = item.mime || '';
  if (m.startsWith('image/')) return <FileImage size={size} className="fp-ic" />;
  if (m.startsWith('video/')) return <FileVideo size={size} className="fp-ic" />;
  if (m.startsWith('audio/')) return <FileAudio size={size} className="fp-ic" />;
  if (/sheet|excel|csv/.test(m)) return <FileSpreadsheet size={size} className="fp-ic" />;
  if (/zip|compressed|tar/.test(m)) return <FileArchive size={size} className="fp-ic" />;
  if (/pdf|word|document|text|markdown/.test(m)) return <FileText size={size} className="fp-ic" />;
  return <FileIcon size={size} className="fp-ic" />;
}

const sourceIcon = s => (s.kind === 'folder' ? <HardDrive size={15} /> : <Cloud size={15} />);
const when = s => (s ? new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function FilePicker({ mode = 'insert', onClose, onInsert, onSave, defaultName = '', title }) {
  const isAdmin = useStore(s => s.user?.role === 'admin');
  const [sources, setSources] = useState(null);
  const [source, setSource] = useState(null);
  const [folderId, setFolderId] = useState('');
  const [listing, setListing] = useState(null); // { items, crumbs, can_write }
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState(defaultName);
  const upRef = useRef(null);

  const loadSources = () => listSources().then(list => {
    const usable = mode === 'save' ? list.filter(s => s.can_write) : list;
    setSources(usable);
    setSource(cur => (cur && usable.find(s => s.id === cur.id)) || usable.find(s => s.kind === 'folder' || s.connected) || usable[0] || null);
  }).catch(err => { setSources([]); setError(errorText(err)); });
  useEffect(() => { loadSources(); }, []);

  const load = async (src = source, id = folderId) => {
    if (!src || (src.kind !== 'folder' && !src.connected)) { setListing(null); return; }
    setLoading(true); setError(''); setSelected(null);
    try { setListing(await listFolder(src.id, id)); } catch (err) { setListing(null); setError(errorText(err)); }
    setLoading(false);
  };
  useEffect(() => { setFolderId(''); load(source, ''); }, [source?.id, source?.connected]);

  const open = item => {
    if (item.type === 'folder') { setFolderId(item.id); load(source, item.id); return; }
    if (mode === 'save') return;
    setSelected(item);
  };

  const connect = async () => {
    try {
      const ok = await connectCloud(source.kind);
      if (ok) toast.success(`${source.name} connected`);
      else if (ok === false) toast.error('Couldn’t connect — see the sign-in window for why');
      await loadSources();
    } catch (err) { toast.error(errorText(err)); }
  };

  const insert = async how => {
    if (!selected) return;
    setBusy(how === 'copy' ? 'Copying the file…' : 'Adding the link…');
    try { await onInsert({ item: selected, source, how }); onClose(); } catch (err) { toast.error(errorText(err, err?.message)); setBusy(''); }
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Give the file a name'); return; }
    setBusy('Saving…');
    try { await onSave({ source, parent: folderId, name: name.trim(), setProgress: p => setBusy(typeof p === 'number' ? `Uploading… ${p}%` : p) }); onClose(); } catch (err) { toast.error(errorText(err, err?.message)); setBusy(''); }
  };

  const download = async item => {
    setBusy(`Downloading ${item.name}…`);
    try { const f = await fetchFile({ source: source.id, id: item.id }); saveBlob(f.blob, f.name); } catch (err) { toast.error(errorText(err)); }
    setBusy('');
  };

  const uploadHere = async file => {
    if (!file) return;
    setBusy(`Uploading ${file.name}…`);
    try { await uploadTo(source.id, folderId, file, file.name, p => setBusy(`Uploading ${file.name}… ${p}%`)); toast.success('Uploaded'); load(); } catch (err) { toast.error(errorText(err)); }
    setBusy(''); if (upRef.current) upRef.current.value = '';
  };

  const crumbs = listing?.crumbs || [];
  const parentCrumb = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const canWrite = !!listing?.can_write;
  const heading = title || (mode === 'save' ? 'Save to…' : mode === 'insert' ? 'Add a file to the note' : 'Files');

  return (
    <Modal title={heading} onClose={() => !busy && onClose()} width={760}>
      {sources === null ? <p className="chat-pop-note"><Loader2 size={14} className="spin" /> Loading…</p> : !sources.length ? (
        <div className="fp-empty">
          <p>{error || (mode === 'save' ? 'There’s nowhere to save to yet.' : 'No file locations are set up yet.')}</p>
          <p className="fp-hint">
            {isAdmin
              ? 'Add network folders, OneDrive or Google Drive in Settings → Server → Files.'
              : 'Ask your admin to add network folders, OneDrive or Google Drive.'}
          </p>
          {isAdmin && <button type="button" className="export-go" onClick={() => { onClose(); useStore.getState().setSettingsOpen('server-files'); }}><SettingsIcon size={14} /> Open file settings</button>}
        </div>
      ) : (
        <div className="fp">
          <nav className="fp-sources">
            {sources.map(s => (
              <button key={s.id} type="button" className={`fp-source${source?.id === s.id ? ' on' : ''}`} onClick={() => setSource(s)} title={s.account || s.name}>
                {sourceIcon(s)}
                <span><b>{s.name}</b><small>{s.kind === 'folder' ? (s.can_write ? 'Read & write' : 'Read only') : s.connected ? s.account || 'Connected' : 'Not connected'}</small></span>
              </button>
            ))}
          </nav>
          <div className="fp-main">
            <div className="fp-bar">
              <button type="button" className="btn-ghost" disabled={!parentCrumb || loading} title="Up one folder" onClick={() => { setFolderId(parentCrumb.id); load(source, parentCrumb.id); }}><ArrowUp size={14} /></button>
              <div className="fp-crumbs">
                {crumbs.map((c, i) => (
                  <span key={`${c.id}-${i}`} className="fp-crumb">
                    {i > 0 && <ChevronRight size={12} />}
                    {c.id === null || i === crumbs.length - 1 ? <span>{c.name}</span>
                      : <button type="button" onClick={() => { setFolderId(c.id); load(source, c.id); }}>{c.name}</button>}
                  </span>
                ))}
              </div>
              <button type="button" className="btn-ghost" title="Refresh" onClick={() => load()} disabled={loading}><RefreshCw size={14} /></button>
              {mode === 'browse' && canWrite && (
                <>
                  <input ref={upRef} type="file" style={{ display: 'none' }} onChange={e => uploadHere(e.target.files[0])} />
                  <button type="button" className="btn-ghost" onClick={() => upRef.current?.click()} disabled={!!busy}><Upload size={14} /> Upload</button>
                </>
              )}
            </div>
            <div className="fp-list">
              {source && source.kind !== 'folder' && !source.connected ? (
                <div className="fp-empty">
                  <p>Connect your {source.name} to see your files here. You sign in with {source.kind === 'google' ? 'Google' : 'Microsoft'} — Synapse never sees your password.</p>
                  <button type="button" className="export-go" onClick={connect}><Cloud size={14} /> Connect {source.name}</button>
                </div>
              ) : loading ? <p className="chat-pop-note"><Loader2 size={14} className="spin" /> Loading…</p>
                : error ? <p className="fp-error">{error}</p>
                  : !listing?.items.length ? <p className="chat-pop-note">This folder is empty.</p>
                    : listing.items.map(item => {
                      const disabled = mode === 'save' && item.type !== 'folder';
                      return (
                        <div key={item.id} role="button" tabIndex={0}
                          className={`fp-row${selected?.id === item.id ? ' on' : ''}${disabled ? ' dim' : ''}`}
                          onClick={() => (item.type === 'folder' ? open(item) : !disabled && setSelected(item))}
                          onDoubleClick={() => { if (item.type !== 'folder' && mode === 'insert') { setSelected(item); } }}
                          onKeyDown={e => { if (e.key === 'Enter') open(item); }}>
                          {fileIcon(item)}
                          <span className="fp-name">{item.name}</span>
                          <span className="fp-meta">{item.type === 'folder' ? '' : bytes(item.size)}</span>
                          <span className="fp-meta wide">{when(item.modified)}</span>
                          {mode === 'browse' && item.type !== 'folder' && (
                            <span className="fp-actions">
                              <a className="btn-ghost" href={fileHref({ source: source.id, id: item.id, web_url: item.web_url, name: item.name })} target="_blank" rel="noreferrer" title="Open" onClick={e => e.stopPropagation()}><ExternalLink size={13} /></a>
                              <button type="button" className="btn-ghost" title="Download" onClick={e => { e.stopPropagation(); download(item); }}><Download size={13} /></button>
                            </span>
                          )}
                        </div>
                      );
                    })}
            </div>
          </div>
        </div>
      )}

      {sources?.length > 0 && (
        <div className="fp-foot">
          {busy ? <span className="fp-busy"><Loader2 size={14} className="spin" /> {busy}</span> : <span className="fp-busy">{
            mode === 'insert' ? (selected ? selected.name : 'Choose a file') : mode === 'save' ? (canWrite ? '' : listing ? 'You can only read this folder' : '') : ''
          }</span>}
          {mode === 'save' && (
            <>
              <input className="chat-field" value={name} onChange={e => setName(e.target.value)} placeholder="File name" style={{ flex: '1 1 220px', height: 34 }} onKeyDown={e => e.key === 'Enter' && canWrite && save()} />
              <button type="button" className="export-go" onClick={save} disabled={!canWrite || !!busy || !listing}>Save here</button>
            </>
          )}
          {mode === 'insert' && (
            <>
              <button type="button" className="btn-ghost" disabled={!selected || !!busy} onClick={() => insert('link')}
                title={source?.kind === 'folder' ? 'Opens the file from the folder — always the latest version' : `Opens it in ${source?.name} — always the latest version`}><Link2 size={14} /> Link to it</button>
              <button type="button" className="export-go" disabled={!selected || !!busy} onClick={() => insert('copy')}
                title="Saves a copy in Synapse — works even if the original moves"><Paperclip size={14} /> Attach a copy</button>
            </>
          )}
          {mode === 'browse' && <button type="button" className="btn-ghost" onClick={onClose}>Close</button>}
        </div>
      )}
    </Modal>
  );
}
