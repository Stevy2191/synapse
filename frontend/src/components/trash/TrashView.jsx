// Deleted notes, kept for a while (30 days by default) before they're removed for good.
import { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, FileText, GitFork, Pencil, CloudOff, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { fetchTrash, restoreFromTrash, deleteForever, emptyTrash, pendingDeletes } from '../../offline/sync';

const ICONS = { note: FileText, diagram: GitFork, draw: Pencil };
const DAY = 86400;

function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < DAY) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / DAY);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function left(purgeAt) {
  const d = Math.ceil((purgeAt - Date.now() / 1000) / DAY);
  return d <= 1 ? 'deleted for good within a day' : `deleted for good in ${d} days`;
}

export default function TrashView() {
  const ws = useStore(s => s.activeWorkspace);
  const [data, setData] = useState(null); // { items, trash_days }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      setData(await fetchTrash(ws.id));
      setError(null);
    } catch (err) {
      setError(err.response ? (err.response.data?.error || 'Couldn’t load the Trash') : 'offline');
    }
    try { setWaiting(await pendingDeletes()); } catch { /* ignore */ }
  }, [ws?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('synapse:trash-changed', load);
    window.addEventListener('online', load);
    return () => { window.removeEventListener('synapse:trash-changed', load); window.removeEventListener('online', load); };
  }, [load]);

  const act = async (id, fn, ok) => {
    setBusy(id);
    try { await fn(); if (ok) toast.success(ok); } catch (err) { toast.error(err.response?.data?.error || (err.response ? 'Something went wrong' : 'You’re offline')); }
    setBusy(null);
    load();
  };
  const restore = item => act(item.id, () => restoreFromTrash(item.id), `Restored “${item.title}”${item.children ? ` and ${item.children} sub-note${item.children > 1 ? 's' : ''}` : ''}`);
  const forever = item => {
    if (!window.confirm(`Delete “${item.title}”${item.children ? ` and the ${item.children} note(s) inside it` : ''} for good? This can’t be undone.`)) return;
    act(item.id, () => deleteForever(item.id), 'Deleted for good');
  };
  const empty = () => {
    const n = data?.items.length || 0;
    if (!n || !window.confirm(`Delete everything in the Trash (${n} item${n > 1 ? 's' : ''}) for good? This can’t be undone.`)) return;
    act('all', () => emptyTrash(ws.id), 'Trash emptied');
  };

  const items = (data?.items || []).filter(i => !q.trim() || `${i.title} ${i.excerpt}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <h1>Trash</h1>
          <span>{data ? `${data.items.length} item${data.items.length === 1 ? '' : 's'}` : ''}</span>
          <button className="btn-ghost" title="Refresh" onClick={load} style={{ marginLeft: 'auto' }}><RefreshCw size={14} /></button>
        </div>
        <p className="tasks-lead">
          Deleted notes stay here for <b>{data?.trash_days ?? 30} days</b>, then they’re deleted for good. Restore one to put it back where it was
          (with any notes that were inside it).
        </p>

        {error === 'offline' && (
          <div className="trash-note"><CloudOff size={15} /> The Trash is kept on the server — connect to see it. Notes you delete now go there once you’re back online.</div>
        )}
        {error && error !== 'offline' && <div className="trash-note">{error}</div>}
        {waiting > 0 && !error && <div className="trash-note"><RefreshCw size={14} /> {waiting} deletion{waiting > 1 ? 's' : ''} still uploading; they’ll appear here shortly.</div>}

        {data && data.items.length > 0 && (
          <div className="trash-tools">
            <div className="trash-search"><Search size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the Trash…" /></div>
            <button className="cp-btn danger" onClick={empty} disabled={busy === 'all'}><Trash2 size={13} /> Empty Trash</button>
          </div>
        )}

        {data && data.items.length === 0 && !error && <p className="tasks-empty">The Trash is empty.</p>}
        {items.map(item => {
          const Icon = ICONS[item.note_type] || FileText;
          return (
            <div key={item.id} className="trash-row">
              <Icon size={16} className="trash-icon" />
              <div className="trash-main">
                <div className="trash-title">{item.title}{item.children > 0 && <span className="trash-count">+{item.children} inside</span>}</div>
                {item.excerpt && <div className="trash-excerpt">{item.excerpt}</div>}
                <div className="trash-meta">Deleted {ago(item.deleted_at)} · {left(item.purge_at)}</div>
              </div>
              <div className="trash-actions">
                <button className="cp-btn" disabled={busy === item.id} onClick={() => restore(item)} title="Put it back"><RotateCcw size={13} /> Restore</button>
                <button className="fd-btn sm danger" disabled={busy === item.id} onClick={() => forever(item)} title="Delete for good"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

