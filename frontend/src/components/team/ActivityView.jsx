// Activity: what happened in this workspace — who created, changed, deleted or commented on what.
import { useEffect, useState } from 'react';
import { FilePlus2, Pencil, Trash2, Undo2, MessageSquareText, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import api from '../../api';
import { useStore } from '../../stores/useStore';
import SidebarButton from '../sidebar/SidebarButton';
import { openNote } from '../../offline/sync';
import { getMembers, personLabel } from '../../team/team';
import { colorFor } from '../../collab/session';

const KIND = {
  created: [FilePlus2, 'created'], edited: [Pencil, 'edited'], deleted: [Trash2, 'deleted'], restored: [Undo2, 'restored'],
  commented: [MessageSquareText, 'commented on'], resolved: [CheckCircle2, 'resolved a comment on'],
};
const dayLabel = s => {
  const d = new Date(s * 1000); const t = new Date(); t.setHours(0, 0, 0, 0);
  const y = new Date(t); y.setDate(y.getDate() - 1);
  if (d >= t) return 'Today';
  if (d >= y) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
const time = s => new Date(s * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function ActivityView() {
  const ws = useStore(s => s.activeWorkspace);
  const me = useStore(s => s.user);
  const [items, setItems] = useState(null);
  const [who, setWho] = useState('');
  const [people, setPeople] = useState([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(null);
  const load = async (before) => {
    if (!ws) return;
    try {
      const { data } = await api.get(`/team/activity/${ws.id}`, { params: { ...(before ? { before } : {}), ...(who ? { user: who } : {}) } });
      setItems(prev => (before ? [...(prev || []), ...data.items] : data.items));
      setMore(data.items.length === 60); setError(null);
    } catch (err) { setError(err?.response ? 'Couldn’t load the activity' : 'Activity needs a connection'); setItems(i => i || []); }
  };
  useEffect(() => { setItems(null); load(); getMembers(ws?.id).then(setPeople); }, [ws?.id, who]);
  useEffect(() => {
    const on = e => { if (e.detail?.workspace_id === ws?.id) load(); };
    window.addEventListener('synapse:ws-changed', on);
    return () => window.removeEventListener('synapse:ws-changed', on);
  }, [ws?.id, who]);

  let lastDay = null;
  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <SidebarButton />
          <h1>Activity</h1>
          <span style={{ flex: 1 }} />
          <button className="btn-ghost" title="Refresh" onClick={() => load()}><RefreshCw size={14} /></button>
        </div>
        <p className="tasks-lead">What’s been happening in <b>{ws?.name}</b>.</p>
        {people.length > 1 && (
          <div className="tasks-controls">
            <label className="tasks-select">Person
              <select value={who} onChange={e => setWho(e.target.value)}>
                <option value="">Everyone</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : personLabel(p)}</option>)}
              </select>
            </label>
          </div>
        )}
        {error && <p className="tasks-empty">{error}</p>}
        {items === null && <p className="tasks-empty"><Loader2 size={14} className="spin" /> Loading…</p>}
        {items && !items.length && !error && <p className="tasks-empty">Nothing yet.</p>}
        <div className="ac-list">
          {(items || []).map(a => {
            const [Icon, verb] = KIND[a.kind] || [Pencil, a.kind];
            const day = dayLabel(a.created_at);
            const head = day !== lastDay ? <h2 key={`d${a.id}`} className="ac-day">{day}</h2> : null;
            lastDay = day;
            const title = a.note_title || a.title || 'a note';
            return [head, (
              <div key={a.id} className="ac-item">
                <span className="ac-avatar" style={{ background: colorFor(a.username) }}>{(a.user_name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="ac-main">
                  <span><b>{a.user_id === me?.id ? 'You' : (a.user_name || 'Someone')}</b> {verb}{' '}
                    {a.note_id && !a.note_deleted && a.kind !== 'deleted'
                      ? <button type="button" className="cl-link" onClick={() => openNote(a.note_id).then(() => useStore.getState().setView('editor'))}>{title}</button>
                      : <b>{title}</b>}
                  </span>
                  {a.detail && <span className="ac-detail">{a.kind === 'commented' ? `“${a.detail}”` : a.detail}</span>}
                </span>
                <span className="ac-time"><Icon size={13} /> {time(a.created_at)}</span>
              </div>
            )];
          })}
        </div>
        {items && more && items.length > 0 && <button type="button" className="btn-ghost" onClick={() => load(items[items.length - 1].id)}>Show older</button>}
      </div>
    </div>
  );
}
