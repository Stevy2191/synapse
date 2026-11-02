// Inbox (the bell): things that need you — mentions, to-dos assigned to you, replies to your comments,
// comments resolved, being added to a workspace. Click one to go there.
import { useEffect, useState } from 'react';
import { Bell, AtSign, UserCheck, MessageSquareReply, CheckCircle2, Users, CheckCheck, Loader2 } from 'lucide-react';
import api from '../../api';
import { useStore } from '../../stores/useStore';
import SidebarButton from '../sidebar/SidebarButton';
import { openNote, syncNow } from '../../offline/sync';

const ICON = { mention: AtSign, assign: UserCheck, reply: MessageSquareReply, resolved: CheckCircle2, added: Users };
const when = s => {
  const d = new Date(s * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d >= today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export async function refreshInboxCount() {
  try { const { data } = await api.get('/team/inbox/count'); useStore.setState({ inboxUnread: data.unread }); } catch { /* offline */ }
}

export default function InboxView() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(true);
  const load = async (before) => {
    try {
      const { data } = await api.get('/team/inbox', { params: before ? { before } : {} });
      setItems(prev => (before ? [...(prev || []), ...data.items] : data.items));
      setMore(data.items.length === 50);
      useStore.setState({ inboxUnread: data.unread });
      setError(null);
    } catch (err) { setError(err?.response ? 'Couldn’t load the inbox' : 'The inbox needs a connection'); setItems(i => i || []); }
  };
  useEffect(() => { load(); }, []);
  const markRead = async ids => {
    setItems(list => list.map(i => (!ids || ids.includes(i.id) ? { ...i, read_at: i.read_at || Date.now() / 1000 } : i)));
    try { const { data } = await api.post('/team/inbox/read', ids ? { ids } : { all: true }); useStore.setState({ inboxUnread: data.unread }); } catch { /* offline */ }
  };
  const go = async item => {
    markRead([item.id]);
    const store = useStore.getState();
    if (item.workspace_id && store.activeWorkspace?.id !== item.workspace_id) {
      const ws = store.workspaces.find(w => w.id === item.workspace_id);
      if (!ws) await syncNow();
      const w2 = useStore.getState().workspaces.find(w => w.id === item.workspace_id);
      if (w2) await useStore.getState().setActiveWorkspace(w2);
    }
    if (item.note_id && !item.note_deleted) {
      if (item.thread_id) useStore.setState({ pendingComment: { noteId: item.note_id, threadId: item.thread_id } });
      await openNote(item.note_id);
    }
    useStore.getState().setView('editor');
  };
  const unread = (items || []).filter(i => !i.read_at).length;

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <SidebarButton />
          <h1>Inbox</h1>
          <span>{unread ? `${unread} new` : ''}</span>
          <span style={{ flex: 1 }} />
          {unread > 0 && <button type="button" className="btn-ghost" onClick={() => markRead(null)}><CheckCheck size={14} /> Mark all read</button>}
        </div>
        <p className="tasks-lead">Things that need you: mentions, to-dos assigned to you, replies to your comments, and workspaces you’ve been added to.</p>
        {error && <p className="tasks-empty">{error}</p>}
        {items === null && <p className="tasks-empty"><Loader2 size={14} className="spin" /> Loading…</p>}
        {items && !items.length && !error && <p className="tasks-empty"><Bell size={16} /> Nothing here yet. 🎉</p>}
        <div className="ib-list">
          {(items || []).map(i => {
            const Icon = ICON[i.kind] || Bell;
            return (
              <button key={i.id} type="button" className={`ib-item${i.read_at ? '' : ' unread'}`} onClick={() => go(i)}>
                <span className={`ib-icon k-${i.kind}`}><Icon size={15} /></span>
                <span className="ib-main">
                  <span className="ib-title">{i.title}</span>
                  {i.body && <span className="ib-body">{i.body}</span>}
                  <span className="ib-meta">{i.workspace_name ? `${i.workspace_name} · ` : ''}{when(i.created_at)}{i.note_deleted ? ' · note deleted' : ''}</span>
                </span>
                {!i.read_at && <span className="ib-dot" />}
              </button>
            );
          })}
        </div>
        {items && more && items.length > 0 && <button type="button" className="btn-ghost" onClick={() => load(items[items.length - 1].id)}>Show older</button>}
      </div>
    </div>
  );
}
