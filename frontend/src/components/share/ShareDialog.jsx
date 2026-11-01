// Share a note: pick people, give each "Can view" or "Can edit", optionally including every note
// inside it. Only the owner changes sharing.
import { useEffect, useState } from 'react';
import { X, UserPlus, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, PeoplePicker } from '../chat/ChatDialogs';
import { UserAvatar } from '../Avatar';
import { personName } from '../../chat/client';
import { getNoteShares, shareNote, unshareNote, loadShares, errorText } from '../../shares/client';

const PERMS = [['view', 'Can view'], ['edit', 'Can edit']];

export default function ShareDialog({ note, onClose }) {
  const [info, setInfo] = useState(null);
  const [adding, setAdding] = useState([]);
  const [perm, setPerm] = useState('view');
  const [withChildren, setWithChildren] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => getNoteShares(note.id).then(setInfo).catch(err => { toast.error(errorText(err)); onClose(); });
  useEffect(() => { load(); }, [note.id]);

  if (!info) return <Modal title={`Share “${note.title || 'Untitled'}”`} onClose={onClose}><p className="chat-pop-note">Loading…</p></Modal>;

  const change = async (s, fields) => {
    try {
      await shareNote(note.id, s.user_id, fields.permission ?? s.permission, fields.include_children ?? !!s.include_children);
      await load();
    } catch (err) { toast.error(errorText(err)); }
  };
  const remove = async s => {
    try { await unshareNote(note.id, s.user_id); await load(); loadShares(); toast.success(`${personName(s)} no longer has access`); }
    catch (err) { toast.error(errorText(err)); }
  };
  const add = async () => {
    if (!adding.length) return;
    setBusy(true);
    try {
      for (const id of adding) await shareNote(note.id, id, perm, withChildren);
      toast.success(`Shared with ${adding.length} ${adding.length === 1 ? 'person' : 'people'} — they’ve been notified`);
      setAdding([]);
      await load();
    } catch (err) { toast.error(errorText(err)); }
    setBusy(false);
  };

  const already = [...info.shares.map(s => s.user_id), ...info.inherited.map(s => s.user_id)];

  return (
    <Modal title={`Share “${note.title || 'Untitled'}”`} onClose={onClose} width={520}>
      <p className="chat-dialog-hint">
        People you share with see it under <b>Shared with me</b>. <b>Can view</b> lets them read it; <b>Can edit</b> lets them change it — one person edits at a time, and <b>History</b> shows who changed what and when.
      </p>

      <label className="chat-dialog-label">People with access</label>
      <div className="share-list">
        <div className="share-row">
          <UserAvatar user={info.owner} size={30} />
          <span className="share-name">{personName(info.owner)} <span className="share-sub">owner</span></span>
          <span className="share-perm-fixed">Owner</span>
        </div>
        {info.shares.map(s => (
          <div key={s.user_id} className="share-row">
            <UserAvatar user={s} size={30} />
            <span className="share-name">
              {personName(s)}
              {info.has_children && (
                <label className="share-sub share-children">
                  <input type="checkbox" checked={!!s.include_children} onChange={e => change(s, { include_children: e.target.checked })} /> and the notes inside it
                </label>
              )}
            </span>
            <select className="share-select" value={s.permission} onChange={e => change(s, { permission: e.target.value })}>
              {PERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="btn-ghost" title="Stop sharing with them" onClick={() => remove(s)}><X size={14} /></button>
          </div>
        ))}
        {info.inherited.map(s => (
          <div key={`i-${s.user_id}-${s.from.id}`} className="share-row inherited" title="Shared through a note this one is inside">
            <UserAvatar user={s} size={30} />
            <span className="share-name">{personName(s)} <span className="share-sub">through “{s.from.title}”</span></span>
            <span className="share-perm-fixed"><Lock size={11} /> {s.permission === 'edit' ? 'Can edit' : 'Can view'}</span>
          </div>
        ))}
        {!info.shares.length && !info.inherited.length && <p className="chat-pop-note">Only you can see this note.</p>}
      </div>

      <label className="chat-dialog-label" style={{ marginTop: 18 }}><UserPlus size={12} style={{ verticalAlign: -1 }} /> Share with</label>
      <PeoplePicker selected={adding} onChange={setAdding} exclude={already} />
      {adding.length > 0 && (
        <div className="share-add-bar">
          <div className="seg">
            {PERMS.map(([v, l]) => <button key={v} type="button" className={perm === v ? 'on' : ''} onClick={() => setPerm(v)}>{l}</button>)}
          </div>
          {info.has_children && (
            <label className="share-children">
              <input type="checkbox" checked={withChildren} onChange={e => setWithChildren(e.target.checked)} /> Include the notes inside it
            </label>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="export-go" onClick={add} disabled={busy}>{busy ? 'Sharing…' : `Share with ${adding.length}`}</button>
        </div>
      )}
    </Modal>
  );
}
