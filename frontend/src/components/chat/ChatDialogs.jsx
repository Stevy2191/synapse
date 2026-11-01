// Dialogs for chat: start a new chat, people in a chat (add / remove / leave), and reading the
// note a chat is about.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Check, UserPlus, LogOut, Trash2, ExternalLink, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserAvatar } from '../Avatar';
import { EmojiButton } from '../EmojiPicker';
import { useStore } from '../../stores/useStore';
import { openNote, getWorkspaceNotes } from '../../offline/sync';
import { useChat, personName, setNickname, loadUsers, createChat, addMembers, removeMember, deleteChat, updateChat, fetchChatNote } from '../../chat/client';

export function Modal({ title, onClose, children, width = 460, footer }) {
  // One listener for the dialog's whole life (the latest onClose is read from a ref), and the
  // dialog takes focus so Escape and Tab work inside it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const box = useRef(null);
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A popup inside the dialog (emoji picker, nickname field) closes first.
      if (document.querySelector('.emoji-picker')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="export-backdrop" onClick={onClose}>
      <div ref={box} tabIndex={-1} className="export-dialog fade-in chat-dialog" style={{ width, outline: 'none' }} role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ font: '700 19px var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{title}</h2>
          <button className="btn-ghost" onClick={onClose} title="Close" style={{ width: 30, height: 30, padding: 0, justifyContent: 'center' }}><X size={17} /></button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Tick people from everyone on this server. */
export function PeoplePicker({ selected, onChange, exclude = [] }) {
  const users = useChat(s => s.users);
  const myId = useStore(s => s.user?.id);
  const [q, setQ] = useState('');
  useEffect(() => { loadUsers(); }, []);
  const list = useMemo(() => Object.values(users)
    .filter(u => u.id !== myId && !exclude.includes(u.id))
    .filter(u => !q || `${u.nickname || ''} ${u.display_name || ''} ${u.username}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => personName(a).localeCompare(personName(b))), [users, myId, exclude, q]);
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="chat-pop-search" style={{ marginBottom: 8 }}>
        <Search size={14} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find people" />
      </div>
      <div className="chat-people">
        {list.length === 0 ? (
          <p className="chat-pop-note">{Object.keys(users).length <= 1 ? 'You’re the only person on this server so far. An admin can add people in Settings → Server → Users.' : 'Nobody else to add.'}</p>
        ) : list.map(u => (
          <button key={u.id} type="button" className={`chat-person${selected.includes(u.id) ? ' on' : ''}`} onClick={() => toggle(u.id)}>
            <span style={{ position: 'relative' }}><UserAvatar user={u} size={30} />{u.online && <span className="chat-online-dot" />}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span className="chat-person-name">{personName(u)}</span>
              <span className="chat-person-sub">@{u.username}</span>
            </span>
            <span className="chat-check">{selected.includes(u.id) && <Check size={13} />}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewChatDialog({ note = null, onClose, onCreated }) {
  const [name, setName] = useState(note ? note.title : '');
  const [icon, setIcon] = useState(note ? '📄' : '💬');
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const chat = await createChat({ name: name.trim() || (note ? note.title : 'New chat'), icon, note_id: note?.id, member_ids: members });
      onCreated(chat);
    } catch { setBusy(false); }
  };
  return (
    <Modal title={note ? 'Start a chat about this note' : 'New chat'} onClose={onClose}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="export-go" onClick={create} disabled={busy}>{busy ? 'Starting…' : 'Start chat'}</button>
      </>}>
      {note && <p className="chat-dialog-hint">People you invite can chat here and read “{note.title}”. The note stays in your workspace.</p>}
      <label className="chat-dialog-label">Name</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <EmojiButton value={icon} onChange={setIcon} size={38} />
        <input className="chat-field" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vacation 2026"
          onKeyDown={e => { if (e.key === 'Enter') create(); }} maxLength={80} />
      </div>
      <label className="chat-dialog-label" style={{ marginTop: 16 }}>Invite people {members.length > 0 && <span style={{ color: 'var(--accent)' }}>· {members.length} selected</span>}</label>
      <PeoplePicker selected={members} onChange={setMembers} />
    </Modal>
  );
}

export function ChatPeopleDialog({ chat, onClose }) {
  const myId = useStore(s => s.user?.id);
  const users = useChat(s => s.users);
  const [adding, setAdding] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState(chat.name);
  const [icon, setIcon] = useState(chat.icon);
  const [nickFor, setNickFor] = useState(null);
  const [nickText, setNickText] = useState('');
  const saveNick = async (userId) => {
    if (await setNickname(userId, nickText.trim())) {
      toast.success(nickText.trim() ? 'Nickname saved — only you see it' : 'Nickname removed');
      setNickFor(null);
    }
  };
  const owner = chat.owner_id === myId;
  const memberIds = chat.members.map(m => m.id);

  const saveName = async (nextIcon = icon) => {
    if (name.trim() && (name.trim() !== chat.name || nextIcon !== chat.icon)) await updateChat(chat.id, { name: name.trim(), icon: nextIcon });
  };
  const add = async () => {
    if (!adding.length) return;
    if (await addMembers(chat.id, adding)) { toast.success(`Added ${adding.length} ${adding.length === 1 ? 'person' : 'people'}`); setAdding([]); setShowAdd(false); }
  };
  const leave = async () => {
    if (!confirm(owner && chat.members.length > 1 ? 'Leave this chat? Someone else will take it over.' : 'Leave this chat?')) return;
    if (await removeMember(chat.id, myId)) onClose();
  };
  const remove = async u => {
    if (confirm(`Remove ${personName(u)} from this chat?`)) await removeMember(chat.id, u.id);
  };
  const del = async () => {
    if (!confirm(`Delete “${chat.name}” and all its messages and files for everyone? This can’t be undone.`)) return;
    if (await deleteChat(chat.id)) onClose();
  };

  return (
    <Modal title="Chat settings" onClose={onClose} width={480}>
      <label className="chat-dialog-label">Name</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <EmojiButton value={icon} onChange={v => { setIcon(v); saveName(v); }} size={38} />
        <input className="chat-field" value={name} onChange={e => setName(e.target.value)} onBlur={() => saveName()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} maxLength={80} />
      </div>
      <label className="chat-dialog-label" style={{ marginTop: 16 }}>People ({chat.members.length}) <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· nicknames are only visible to you</span></label>
      <div className="chat-people">
        {chat.members.map(m => {
          const u = users[m.id] || m;
          return (
            <div key={m.id} className="chat-person static">
              <span style={{ position: 'relative' }}><UserAvatar user={u} size={30} />{u.online && <span className="chat-online-dot" />}</span>
              {nickFor === m.id ? (
                <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6 }}>
                  <input className="chat-field" style={{ height: 32 }} autoFocus value={nickText} maxLength={60}
                    placeholder={`Nickname for ${u.display_name || u.username}`}
                    onChange={e => setNickText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveNick(m.id); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNickFor(null); } }} />
                  <button type="button" className="export-go" style={{ height: 32 }} onClick={() => saveNick(m.id)}>Save</button>
                </span>
              ) : (
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="chat-person-name">{personName(u)}{m.id === myId ? ' (you)' : ''}</span>
                  <span className="chat-person-sub">
                    @{u.username}{u.nickname && u.display_name && u.display_name !== u.nickname ? ` · ${u.display_name}` : ''}{m.id === chat.owner_id ? ' · started this chat' : ''}
                  </span>
                </span>
              )}
              {m.id !== myId && nickFor !== m.id && (
                <button type="button" className="btn-ghost" title={u.nickname ? 'Change the nickname (only you see it)' : 'Give them a nickname (only you see it)'}
                  onClick={() => { setNickFor(m.id); setNickText(u.nickname || ''); }}>
                  <Pencil size={13} /><span className="hide-narrow">{u.nickname ? 'Nickname' : 'Nickname'}</span>
                </button>
              )}
              {owner && m.id !== myId && <button type="button" className="btn-ghost" title="Remove from chat" onClick={() => remove(u)}><X size={14} /></button>}
            </div>
          );
        })}
      </div>
      {showAdd ? (
        <div style={{ marginTop: 12 }}>
          <PeoplePicker selected={adding} onChange={setAdding} exclude={memberIds} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn-ghost" onClick={() => { setShowAdd(false); setAdding([]); }}>Cancel</button>
            <button type="button" className="export-go" onClick={add} disabled={!adding.length}>Add {adding.length || ''}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAdd(true)}><UserPlus size={15} /> Add people</button>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <button type="button" className="btn-ghost" onClick={leave}><LogOut size={15} /> Leave chat</button>
        {owner && <button type="button" className="btn-ghost" style={{ color: 'var(--danger)' }} onClick={del}><Trash2 size={15} /> Delete chat</button>}
      </div>
    </Modal>
  );
}

/** Read the note a chat is about (it may belong to someone else). */
export function ChatNoteViewer({ chat, onClose }) {
  const [state, setState] = useState({ loading: true });
  const workspace = useStore(s => s.activeWorkspace);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { note, owner } = await fetchChatNote(chat.id);
        const { buildDocument } = await import('../../export/render');
        const doc = await buildDocument([{ ...note, depth: 0 }], [note], { title: note.title, pageBreaks: false });
        // Is it one of my notes, here on this device? Then it can be opened for editing.
        const mine = workspace ? (await getWorkspaceNotes(workspace.id)).some(n => n.id === note.id) : false;
        if (!cancelled) setState({ loading: false, html: doc.html, note, owner, mine });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err?.response?.data?.error || 'Could not load the note' });
      }
    })();
    return () => { cancelled = true; };
  }, [chat.id]);

  return (
    <Modal title={state.note?.title || chat.note?.title || 'Note'} onClose={onClose} width={820}>
      {state.loading ? <p className="chat-pop-note">Loading…</p>
        : state.error ? <p className="chat-pop-note">{state.error}</p>
          : (
            <>
              <p className="chat-dialog-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>{state.mine ? 'Your note — what people in this chat can read.' : `${state.owner}’s note, shared with this chat (read only).`}</span>
                {state.mine && (
                  <button type="button" className="btn-ghost" onClick={() => { openNote(state.note.id); useStore.getState().setView('editor'); onClose(); }}>
                    <ExternalLink size={14} /> Open to edit
                  </button>
                )}
              </p>
              <iframe title="Note" className="chat-note-frame" srcDoc={state.html} sandbox="allow-same-origin" />
            </>
          )}
    </Modal>
  );
}
