// The Chats page: the list of conversations on the left, the open one on the right (one at a
// time on phones).
import { useEffect, useState } from 'react';
import { Plus, PanelLeft, Bell, BellRing, MessageCircle, Search } from 'lucide-react';
import { UserAvatar } from '../Avatar';
import ChatRoom from './ChatRoom';
import { NewChatDialog } from './ChatDialogs';
import { useStore } from '../../stores/useStore';
import { useChat, loadChats, userName, notificationState, enableNotifications, disableNotifications } from '../../chat/client';
import { shortTime } from '../../chat/format';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 760);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

export function NotificationsButton({ compact = false }) {
  const [state, setState] = useState(null);
  useEffect(() => { notificationState().then(setState); }, []);
  if (!state || state === 'unsupported' && compact) return null;
  const toggle = async () => {
    if (state === 'on') { await disableNotifications(); setState('off'); }
    else if (state === 'blocked') alert('Notifications are blocked for Synapse in this browser. Allow them in the site settings (the padlock next to the address), then try again.');
    else { await enableNotifications(); setState(await notificationState()); }
  };
  return (
    <button type="button" className={`btn-ghost${state === 'on' ? ' on' : ''}`} onClick={toggle}
      title={state === 'on' ? 'Notifications are on for this device — click to turn off' : 'Get a notification for new messages when Synapse isn’t open'}>
      {state === 'on' ? <BellRing size={15} /> : <Bell size={15} />}
      {!compact && <span>{state === 'on' ? 'Notifications on' : 'Turn on notifications'}</span>}
    </button>
  );
}

export default function ChatView() {
  const chats = useChat(s => s.chats);
  const loaded = useChat(s => s.loaded);
  const connected = useChat(s => s.connected);
  const activeChatId = useStore(s => s.activeChatId);
  const setActiveChat = useStore(s => s.setActiveChat);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const myId = useStore(s => s.user?.id);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const narrow = useNarrow();

  useEffect(() => { if (!loaded) loadChats(); }, [loaded]);
  // On a wide screen, open the latest chat if none is chosen.
  useEffect(() => {
    if (!narrow && loaded && chats.length && !chats.some(c => c.id === activeChatId)) setActiveChat(chats[0].id);
  }, [narrow, loaded, chats.length, activeChatId]);

  const shown = q.trim() ? chats.filter(c => `${c.name} ${c.members.map(m => m.display_name || m.username).join(' ')}`.toLowerCase().includes(q.toLowerCase())) : chats;
  const active = chats.find(c => c.id === activeChatId);
  const showList = !narrow || !active;
  const showRoom = !narrow || active;

  return (
    <div className="chat-view">
      {showList && (
        <div className="chat-list" style={narrow ? { width: '100%', borderRight: 'none' } : undefined}>
          <div className="chat-list-head">
            {!sidebarOpen && <button className="btn-ghost" onClick={() => useStore.getState().setSidebarOpen(true)} title="Show sidebar"><PanelLeft size={16} /></button>}
            <h2>Chats</h2>
            <NotificationsButton compact />
            <button className="btn-ghost" onClick={() => setCreating(true)} title="New chat"><Plus size={16} /></button>
          </div>
          {chats.length > 4 && (
            <div className="chat-pop-search" style={{ margin: '0 10px 6px' }}>
              <Search size={14} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a chat" />
            </div>
          )}
          <div className="chat-list-items">
            {!loaded ? <p className="chat-pop-note">Loading…</p> : !chats.length ? (
              <div className="chat-list-empty">
                <MessageCircle size={30} />
                <p><strong>No chats yet.</strong> Start one for a project, a trip, or just the family. You can also start a chat from any note.</p>
                <button className="export-go" onClick={() => setCreating(true)}><Plus size={14} style={{ verticalAlign: -2 }} /> New chat</button>
              </div>
            ) : shown.map(c => {
              const other = c.members.find(m => m.id !== myId);
              return (
                <button key={c.id} type="button" className={`chat-list-item${c.id === activeChatId ? ' on' : ''}${c.unread ? ' unread' : ''}`} onClick={() => setActiveChat(c.id)}>
                  <span className="chat-list-icon">{c.icon}</span>
                  <span className="chat-list-text">
                    <span className="chat-list-top">
                      <span className="chat-list-name">{c.name}</span>
                      <span className="chat-list-time">{shortTime(c.last?.created_at || c.updated_at)}</span>
                    </span>
                    <span className="chat-list-bottom">
                      <span className="chat-list-preview">
                        {c.last ? <>{c.last.user_id === myId ? 'You' : userName(c.last.user_id)}: {c.last.text}</> : c.note ? `About “${c.note.title}”` : other ? `With ${other.display_name || other.username}` : 'No messages yet'}
                      </span>
                      {c.unread > 0 && <span className={`chat-badge${c.muted ? ' muted' : ''}`}>{c.unread > 99 ? '99+' : c.unread}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {!connected && loaded && <div className="chat-list-foot">Chat needs a connection — reconnecting…</div>}
        </div>
      )}
      {showRoom && (
        <div className="chat-main">
          {active ? <ChatRoom key={active.id} chatId={active.id} onBack={narrow ? () => setActiveChat(null) : null} />
            : (
              <div className="chat-empty">
                {!sidebarOpen && narrow && <button className="btn-ghost" onClick={() => useStore.getState().setSidebarOpen(true)}><PanelLeft size={16} /></button>}
                <MessageCircle size={40} style={{ opacity: 0.35 }} />
                <p>Pick a chat, or start a new one.</p>
              </div>
            )}
        </div>
      )}
      {creating && <NewChatDialog onClose={() => setCreating(false)} onCreated={c => { setCreating(false); setActiveChat(c.id); }} />}
    </div>
  );
}

export function ChatAvatar({ user, size }) { return <UserAvatar user={user} size={size} />; }
