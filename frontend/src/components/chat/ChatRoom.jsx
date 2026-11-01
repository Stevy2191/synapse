// One open chat: header, message history (scroll up for older), typing, and the composer.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, FileText, Users, Bell, BellOff, Settings2, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserAvatar } from '../Avatar';
import Message from './Message';
import Composer from './Composer';
import { ChatPeopleDialog, ChatNoteViewer } from './ChatDialogs';
import { useStore } from '../../stores/useStore';
import { getWorkspaceNotes, openNote } from '../../offline/sync';
import { useChat, personName, loadMessages, loadOlder, setOpenChat, updateChat, userName } from '../../chat/client';
import { dayLabel } from '../../chat/format';

const GROUP_SECONDS = 5 * 60;

export default function ChatRoom({ chatId, onBack, onClose, compact = false }) {
  const chat = useChat(s => s.chats.find(c => c.id === chatId));
  const messages = useChat(s => s.messages[chatId]);
  const hasMore = useChat(s => s.hasMore[chatId]);
  const typing = useChat(s => s.typing[chatId]);
  const users = useChat(s => s.users);
  const connected = useChat(s => s.connected);
  const me = useStore(s => s.user);
  const workspace = useStore(s => s.activeWorkspace);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null); // 'people' | 'note'
  const [lightbox, setLightbox] = useState(null);
  const [flash, setFlash] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const atBottom = useRef(true);
  const composer = useRef(null);
  const readMarker = useRef(null); // where "New messages" goes, fixed when the chat opens
  const loadedUpTo = useRef(null); // last message there when the chat opened (newer ones you watched arrive)

  useEffect(() => {
    readMarker.current = chat ? chat.last_read : null;
    loadedUpTo.current = null;
    setReplyTo(null); setEditing(null); setError('');
    setOpenChat(chatId);
    if (!useChat.getState().messages[chatId]) loadMessages(chatId).catch(() => setError('Couldn’t load messages — are you online?'));
    atBottom.current = true;
    return () => { if (useChat.getState().openChatId === chatId) setOpenChat(null); };
  }, [chatId]);

  // Stay at the bottom as messages arrive (unless reading further up).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages?.length, typing]);

  const onScroll = async () => {
    const el = scroller.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 120 && hasMore && !loadingOlder) {
      setLoadingOlder(true);
      const before = el.scrollHeight;
      try { await loadOlder(chatId); } catch { /* offline */ }
      requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - before; });
      setLoadingOlder(false);
    }
  };

  const jumpTo = useCallback(id => {
    const el = document.getElementById(`msg-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setFlash(id); setTimeout(() => setFlash(null), 1600); }
    else toast('That message is further back — scroll up to load it');
  }, []);

  const onNoteLink = useCallback(async title => {
    if (!workspace) return;
    const all = await getWorkspaceNotes(workspace.id);
    const target = all.find(n => n.title.toLowerCase() === title.trim().toLowerCase());
    if (!target) { toast(`“${title}” isn’t in your current workspace`, { icon: '📄' }); return; }
    await openNote(target.id);
    useStore.getState().setView('editor');
  }, [workspace]);

  const fmtCtx = useMemo(() => ({
    me: me?.username?.toLowerCase(),
    myId: me?.id,
    usernames: new Map((chat?.members || []).map(m => [m.username.toLowerCase(), personName(useChat.getState().users[m.id] || m)])),
  }), [me?.id, chat?.members]);

  if (!chat) {
    return <div className="chat-empty">{onBack && <button className="btn-ghost" onClick={onBack}><ChevronLeft size={16} /> Chats</button>}<p>This chat isn’t available any more.</p></div>;
  }

  const owner = chat.owner_id === me?.id;
  const typers = Object.entries(typing || {}).filter(([uid, until]) => until > Date.now() && uid !== me?.id).map(([uid]) => userName(uid));
  const others = chat.members.filter(m => m.id !== me?.id);

  if (messages && loadedUpTo.current == null) loadedUpTo.current = messages.length ? messages[messages.length - 1].seq : 0;
  const rows = [];
  let prev = null;
  let markerShown = false;
  for (const m of messages || []) {
    const day = new Date(m.created_at * 1000).toDateString();
    if (!prev || new Date(prev.created_at * 1000).toDateString() !== day) rows.push({ type: 'day', key: `d-${m.seq}`, label: dayLabel(m.created_at) });
    if (!markerShown && readMarker.current != null && m.seq > readMarker.current && m.seq <= loadedUpTo.current && m.user_id !== me?.id && prev) {
      rows.push({ type: 'new', key: 'new' });
      markerShown = true;
    }
    const grouped = prev && !rows[rows.length - 1].type.match(/day|new/) && prev.user_id === m.user_id && !prev.gif?.system && !m.gif?.system
      && !m.reply_to && m.created_at - prev.created_at < GROUP_SECONDS;
    if (grouped) rows[rows.length - 1].last = false; // the one before isn't the end of a run any more
    rows.push({ type: 'msg', key: m.id, m, grouped, last: true });
    prev = m;
  }

  const onDrop = e => {
    e.preventDefault();
    setDragging(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) composer.current?.addFiles(files);
  };

  return (
    <div className={`chat-room${compact ? ' compact' : ''}`}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={onDrop}>
      <div className="chat-room-head">
        {onBack && <button className="btn-ghost" onClick={onBack} title="All chats"><ChevronLeft size={17} /></button>}
        <span className="chat-room-icon">{chat.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="chat-room-name">{chat.name}</div>
          <div className="chat-room-sub">
            {others.length ? others.map(m => personName(users[m.id] || m)).join(', ') : 'Just you — add people to chat'}
            {!connected && <span className="chat-offline"> · reconnecting…</span>}
          </div>
        </div>
        {chat.note && (
          <button className="btn-ghost" onClick={() => setDialog('note')} title={chat.note.deleted ? 'The note was deleted' : `Read “${chat.note.title}”`} disabled={chat.note.deleted}>
            <FileText size={15} /><span className="hide-narrow">{compact ? '' : 'Note'}</span>
          </button>
        )}
        <div className="chat-avatars hide-narrow" onClick={() => setDialog('people')} title="People">
          {chat.members.slice(0, 4).map(m => <UserAvatar key={m.id} user={users[m.id] || m} size={24} />)}
          {chat.members.length > 4 && <span className="chat-avatars-more">+{chat.members.length - 4}</span>}
        </div>
        <button className="btn-ghost" onClick={() => setDialog('people')} title="Add people"><Users size={15} /></button>
        <button className="btn-ghost" onClick={() => updateChat(chat.id, { muted: !chat.muted })} title={chat.muted ? 'Muted — only @mentions notify you. Click to unmute' : 'Mute (only @mentions will notify you)'}>
          {chat.muted ? <BellOff size={15} /> : <Bell size={15} />}
        </button>
        <button className="btn-ghost" onClick={() => setDialog('people')} title="Chat settings"><Settings2 size={15} /></button>
        {onClose && <button className="btn-ghost" onClick={onClose} title="Close chat"><X size={16} /></button>}
      </div>

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {loadingOlder && <div className="chat-loading"><Loader2 size={14} className="spin" /></div>}
        {!messages ? (
          <div className="chat-loading">{error || <Loader2 size={16} className="spin" />}</div>
        ) : (
          <>
            {!hasMore && (
              <div className="chat-start">
                <span className="chat-start-icon">{chat.icon}</span>
                <h3>{chat.name}</h3>
                <p>{chat.note ? <>This chat is about the note <strong>{chat.note.title}</strong>. </> : null}
                  {owner ? 'You started this chat.' : `${userName(chat.owner_id)} started this chat.`} Say hello 👋</p>
              </div>
            )}
            {rows.map(r => r.type === 'day' ? <div key={r.key} className="chat-day"><span>{r.label}</span></div>
              : r.type === 'new' ? <div key={r.key} className="chat-newline"><span>New messages</span></div>
                : (
                  <Message key={r.key} message={r.m} grouped={r.grouped} last={r.last} showNames={chat.members.length > 2} mine={r.m.user_id === me?.id}
                    canDelete={r.m.user_id === me?.id || owner} fmtCtx={fmtCtx} highlight={flash === r.m.id}
                    onReply={m => { setEditing(null); setReplyTo(m); }} onEdit={m => { setReplyTo(null); setEditing(m); }}
                    onOpenImage={setLightbox} onJump={jumpTo} onNoteLink={onNoteLink} />
                ))}
          </>
        )}
      </div>
      <div className="chat-typing">{typers.length > 0 && <><span className="chat-typing-dots"><i /><i /><i /></span> {typers.join(', ')} {typers.length > 1 ? 'are' : 'is'} typing…</>}</div>
      <Composer ref={composer} chat={chat} replyTo={replyTo} editing={editing}
        onCancelReply={() => setReplyTo(null)} onCancelEdit={() => setEditing(null)} onSent={() => { atBottom.current = true; }} />

      {dragging && <div className="chat-drop">Drop files to send them</div>}
      {dialog === 'people' && <ChatPeopleDialog chat={chat} onClose={() => setDialog(null)} />}
      {dialog === 'note' && <ChatNoteViewer chat={chat} onClose={() => setDialog(null)} />}
      {lightbox && (
        <div className="chat-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} referrerPolicy="no-referrer" />
          <div className="chat-lightbox-bar" onClick={e => e.stopPropagation()}>
            <span>{lightbox.name}</span>
            {lightbox.id && <a href={`${lightbox.url}&download`} download={lightbox.name}>Download</a>}
            <button type="button" onClick={() => setLightbox(null)}><X size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
