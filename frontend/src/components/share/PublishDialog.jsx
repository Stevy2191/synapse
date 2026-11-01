// Publish a note as a link anyone can open — no account needed. Each link can be normal (always the
// latest version) or end-to-end encrypted, with an optional PIN/password, an expiry date, and
// "allow downloading". Links can be changed or removed at any time.
import { useEffect, useState } from 'react';
import { Globe, Copy, ExternalLink, Trash2, Lock, KeyRound, Calendar, Download, ShieldCheck, Plus, Eye, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import {
  listLinks, createLink, createEncryptedLink, updateLink, deleteLink, linkUrl, uploadEncrypted, rememberLinks, cryptoAvailable, errorText,
} from '../../publish/client';

const toDate = s => (s ? new Date(s * 1000).toISOString().slice(0, 10) : '');
const fromDate = d => (d ? Math.floor(new Date(`${d}T23:59:59`).getTime() / 1000) : null);
const nice = s => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Links only work for people who can reach this address.
function addressWarning() {
  const h = location.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local') || h.endsWith('.lan')) {
    return `You’re using Synapse at ${location.host}, which only works on your home network — people elsewhere won’t be able to open these links. Publish from your public https address instead.`;
  }
  if (location.protocol !== 'https:') return 'This address isn’t https, so links (and any PIN) travel unprotected. Use your https address if you have one.';
  return null;
}

function NewLink({ note, onCreated, onCancel }) {
  const [mode, setMode] = useState('live');
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState('');
  const [expiry, setExpiry] = useState('');
  const [download, setDownload] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const e2eOk = cryptoAvailable();

  const create = async () => {
    if (usePin && pin.length < 4) { toast.error('A PIN or password needs at least 4 characters'); return; }
    setBusy(true);
    try {
      const opts = { pin: usePin ? pin : '', expires_at: fromDate(expiry), allow_download: download, label };
      const link = mode === 'e2e' ? await createEncryptedLink(note.id, opts) : await createLink(note.id, { ...opts, mode: 'live' });
      const url = linkUrl(link);
      try { await navigator.clipboard.writeText(url); toast.success('Published — link copied'); } catch { toast.success('Published'); }
      onCreated(link);
    } catch (err) { toast.error(errorText(err)); setBusy(false); }
  };

  return (
    <div className="publish-new">
      <div className="publish-modes">
        <button type="button" className={`publish-mode${mode === 'live' ? ' on' : ''}`} onClick={() => setMode('live')}>
          <Globe size={18} />
          <span><b>Normal link</b><small>Always shows the latest version. Your server shows the note to anyone with the link (and the PIN, if you set one).</small></span>
        </button>
        <button type="button" className={`publish-mode${mode === 'e2e' ? ' on' : ''}`} onClick={() => e2eOk && setMode('e2e')} disabled={!e2eOk}>
          <ShieldCheck size={18} />
          <span><b>End-to-end encrypted</b><small>{e2eOk
            ? 'The secret key is part of the link; your server only stores a scrambled copy. Updates when you save the note on this device.'
            : 'Needs Synapse opened over https:// (browsers only allow encryption there).'}</small></span>
        </button>
      </div>
      <input className="chat-field" style={{ width: '100%', marginTop: 10 }} value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="Name for this link (optional, only you see it — e.g. “Grandma”)" />
      <div className="publish-opts">
        <label className="share-children"><input type="checkbox" checked={usePin} onChange={e => setUsePin(e.target.checked)} /> <KeyRound size={13} /> PIN or password</label>
        {usePin && <input className="chat-field" style={{ height: 32 }} value={pin} onChange={e => setPin(e.target.value)} placeholder="At least 4 characters" autoFocus />}
      </div>
      <div className="publish-opts">
        <label className="share-children"><Calendar size={13} /> Stops working after</label>
        <input type="date" className="chat-field" style={{ height: 32, flex: '0 0 auto' }} value={expiry} min={toDate(Date.now() / 1000)} onChange={e => setExpiry(e.target.value)} />
        {expiry && <button type="button" className="btn-ghost" onClick={() => setExpiry('')}>No end date</button>}
      </div>
      <div className="publish-opts">
        <label className="share-children"><input type="checkbox" checked={download} onChange={e => setDownload(e.target.checked)} /> <Download size={13} /> Let visitors download it (PDF / Word)</label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="export-go" onClick={create} disabled={busy}>{busy ? 'Publishing…' : 'Publish and copy link'}</button>
      </div>
    </div>
  );
}

function LinkRow({ link, onChange, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const url = linkUrl(link);

  const save = async fields => {
    try { onChange(await updateLink(link.id, fields)); toast.success('Saved'); } catch (err) { toast.error(errorText(err)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { prompt('Copy this link:', url); } };

  return (
    <div className={`publish-link${link.expired ? ' expired' : ''}`}>
      <div className="publish-link-top">
        {link.mode === 'e2e' ? <ShieldCheck size={16} className="publish-icon e2e" /> : <Globe size={16} className="publish-icon" />}
        <span className="publish-link-name">
          {link.label || (link.mode === 'e2e' ? 'Encrypted link' : 'Link')}
          <span className="publish-badges">
            {link.has_pin && <span><Lock size={10} /> PIN</span>}
            {link.expires_at && <span className={link.expired ? 'bad' : ''}><Calendar size={10} /> {link.expired ? 'expired' : `until ${nice(link.expires_at)}`}</span>}
            {link.allow_download && <span><Download size={10} /> downloads</span>}
            <span><Eye size={10} /> {link.views} {link.views === 1 ? 'view' : 'views'}</span>
          </span>
        </span>
        {url ? (
          <>
            <button type="button" className="btn-ghost" onClick={copy} title="Copy link"><Copy size={14} /></button>
            <a className="btn-ghost" href={url} target="_blank" rel="noreferrer" title="Open it as a visitor"><ExternalLink size={14} /></a>
          </>
        ) : null}
        <button type="button" className="btn-ghost" onClick={() => setEditing(e => !e)}>{editing ? 'Done' : 'Change'}</button>
        <button type="button" className="btn-ghost danger-hover" title="Unpublish — the link stops working" onClick={() => { if (confirm('Unpublish this link? Anyone who has it won’t be able to open it any more.')) onRemove(link); }}><Trash2 size={14} /></button>
      </div>
      {!url && link.mode === 'e2e' && (
        <p className="publish-note"><AlertTriangle size={12} /> This device doesn’t have this link’s secret key, so it can’t show the link or update its copy. Open it from the device you published it on, or make a new link.</p>
      )}
      {link.mode === 'e2e' && url && link.blob_updated_at && <p className="publish-note">Encrypted copy updated {new Date(link.blob_updated_at * 1000).toLocaleString()}.</p>}
      {editing && (
        <div className="publish-edit">
          <div className="publish-opts">
            <KeyRound size={13} />
            <input className="chat-field" style={{ height: 30 }} value={pin} onChange={e => setPin(e.target.value)} placeholder={link.has_pin ? 'New PIN/password (leave empty to keep)' : 'Add a PIN/password'} />
            <button type="button" className="btn-ghost" disabled={pin.length < 4} onClick={() => { save({ pin }); setPin(''); }}>Set</button>
            {link.has_pin && <button type="button" className="btn-ghost" onClick={() => save({ pin: '' })}>Remove PIN</button>}
          </div>
          <div className="publish-opts">
            <Calendar size={13} /> Stops working after
            <input type="date" className="chat-field" style={{ height: 30, flex: '0 0 auto' }} defaultValue={toDate(link.expires_at)} min={toDate(Date.now() / 1000)} onChange={e => save({ expires_at: fromDate(e.target.value) })} />
            {link.expires_at && <button type="button" className="btn-ghost" onClick={() => save({ expires_at: null })}>No end date</button>}
          </div>
          <label className="share-children"><input type="checkbox" checked={link.allow_download} onChange={e => save({ allow_download: e.target.checked })} /> Let visitors download it (PDF / Word)</label>
        </div>
      )}
    </div>
  );
}

export default function PublishDialog({ note, onClose, onLinksChanged }) {
  const [links, setLinks] = useState(null);
  const [adding, setAdding] = useState(false);
  const warning = addressWarning();

  const set = l => { setLinks(l); rememberLinks(note.id, l); onLinksChanged?.(l); };
  useEffect(() => {
    listLinks(note.id).then(l => { set(l); setAdding(!l.length); }).catch(err => { toast.error(errorText(err)); onClose(); });
  }, [note.id]);
  // Make sure encrypted copies are current when the dialog opens
  useEffect(() => { (links || []).filter(l => l.mode === 'e2e').forEach(l => uploadEncrypted(l).catch(() => {})); }, [links?.length]);

  return (
    <Modal title={`Publish “${note.title || 'Untitled'}”`} onClose={onClose} width={580}>
      <p className="chat-dialog-hint">Anyone with a link can open this note — no account needed. You can change or unpublish a link any time.</p>
      {warning && <p className="publish-warning"><AlertTriangle size={13} /> {warning}</p>}
      {!links ? <p className="chat-pop-note">Loading…</p> : (
        <>
          {links.map(l => (
            <LinkRow key={l.id} link={l}
              onChange={nl => set(links.map(x => (x.id === nl.id ? nl : x)))}
              onRemove={async x => { try { await deleteLink(x.id); set(links.filter(y => y.id !== x.id)); toast.success('Unpublished'); } catch (err) { toast.error(errorText(err)); } }} />
          ))}
          {adding ? (
            <NewLink note={note} onCreated={l => { set([...links, l]); setAdding(false); }} onCancel={links.length ? () => setAdding(false) : null} />
          ) : (
            <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={14} /> New link</button>
          )}
        </>
      )}
    </Modal>
  );
}
