// Where messages are written: text (Enter sends, Shift+Enter for a new line), emoji, GIFs,
// pictures and files (button, paste or drop), replies and edits, @mentions and [[note]] links.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Smile, Send, X, FileText, Reply, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import EmojiPicker from '../EmojiPicker';
import GifPicker from './GifPicker';
import { UserAvatar } from '../Avatar';
import { useStore } from '../../stores/useStore';
import { getWorkspaceNotes } from '../../offline/sync';
import { sendMessage, editMessage, uploadFile, sendTyping, userName, useChat } from '../../chat/client';
import { fileSize } from '../../chat/format';

const MAX_FILE = 50 * 1024 * 1024;

const Composer = forwardRef(function Composer({ chat, replyTo, editing, onCancelReply, onCancelEdit, onSent }, ref) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // { key, file, preview, progress, id, error }
  const [popup, setPopup] = useState(null); // 'emoji' | 'gif'
  const [suggest, setSuggest] = useState(null); // { kind: '@'|'[[', start, query, index }
  const [noteTitles, setNoteTitles] = useState([]);
  const [sending, setSending] = useState(false);
  const area = useRef(null);
  const fileInput = useRef(null);
  const users = useChat(s => s.users);
  const workspace = useStore(s => s.activeWorkspace);
  const myId = useStore(s => s.user?.id);

  useImperativeHandle(ref, () => ({
    addFiles,
    focus: () => area.current?.focus(),
  }));

  // Editing a message puts its text in the box
  useEffect(() => {
    if (editing) { setText(editing.body || ''); setTimeout(() => { area.current?.focus(); area.current?.setSelectionRange(9e9, 9e9); }, 0); }
  }, [editing?.id]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo?.id]);
  useEffect(() => { setText(''); setFiles([]); setPopup(null); }, [chat.id]);

  // Put the cursor where an inserted mention/emoji ends, right as the new text appears
  // (not a moment later, or fast typing lands in the wrong place).
  const pendingCaret = useRef(null);
  useLayoutEffect(() => {
    if (pendingCaret.current == null || !area.current) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    area.current.focus();
    area.current.setSelectionRange(pos, pos);
  }, [text]);

  // Grow with the text
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function addFiles(list) {
    const add = [];
    for (const file of list) {
      if (file.size > MAX_FILE) { toast.error(`${file.name} is larger than 50 MB`); continue; }
      add.push({ key: Math.random().toString(36).slice(2), file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, progress: 0 });
    }
    if (add.length) setFiles(f => [...f, ...add].slice(0, 20));
    area.current?.focus();
  }
  const removeFile = key => setFiles(f => { const x = f.find(y => y.key === key); if (x?.preview) URL.revokeObjectURL(x.preview); return f.filter(y => y.key !== key); });

  // ── @ and [[ suggestions ──
  const members = chat.members.filter(m => m.id !== myId);
  const options = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    if (suggest.kind === '@') {
      const people = members.map(m => ({ key: m.id, label: m.display_name || m.username, sub: `@${m.username}`, insert: `@${m.username} `, user: users[m.id] || m }))
        .filter(o => !q || o.label.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q));
      if ('everyone'.startsWith(q)) people.push({ key: 'everyone', label: 'Everyone', sub: '@everyone', insert: '@everyone ' });
      return people.slice(0, 8);
    }
    return noteTitles.filter(t => t.toLowerCase().includes(q)).slice(0, 8).map(t => ({ key: t, label: t, insert: `[[${t}]] ` }));
  }, [suggest, members, noteTitles, users]);

  const detectSuggest = (value, caret) => {
    const before = value.slice(0, caret);
    let m = before.match(/(^|\s)@([\w.-]{0,30})$/);
    if (m) { setSuggest({ kind: '@', start: caret - m[2].length - 1, query: m[2], index: 0 }); return; }
    m = before.match(/\[\[([^\[\]\n]{0,60})$/);
    if (m) {
      if (workspace && !noteTitles.length) getWorkspaceNotes(workspace.id).then(ns => setNoteTitles(ns.map(n => n.title).filter(Boolean).sort((a, b) => a.localeCompare(b))));
      setSuggest({ kind: '[[', start: caret - m[1].length - 2, query: m[1], index: 0 });
      return;
    }
    setSuggest(null);
  };

  const applySuggestion = opt => {
    const el = area.current;
    const caret = el.selectionStart;
    const next = text.slice(0, suggest.start) + opt.insert + text.slice(caret).replace(/^\]\]/, '');
    pendingCaret.current = suggest.start + opt.insert.length;
    setText(next);
    setSuggest(null);
  };

  const insertAtCaret = str => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? text.length;
    pendingCaret.current = start + str.length;
    setText(text.slice(0, start) + str + text.slice(end));
  };

  // ── sending ──
  const send = async (gif = null) => {
    if (sending) return;
    const body = text.trim() ? text.replace(/\s+$/, '') : '';
    if (editing) {
      if (await editMessage(editing.id, body)) { setText(''); onCancelEdit(); }
      return;
    }
    if (!body && !files.length && !gif) return;
    setSending(true);
    try {
      const ids = [];
      for (const f of files) {
        if (f.id) { ids.push(f.id); continue; }
        try {
          const up = await uploadFile(chat.id, f.file, p => setFiles(list => list.map(x => (x.key === f.key ? { ...x, progress: p } : x))));
          ids.push(up.id);
          setFiles(list => list.map(x => (x.key === f.key ? { ...x, id: up.id, progress: 1 } : x)));
        } catch (err) {
          setFiles(list => list.map(x => (x.key === f.key ? { ...x, error: true } : x)));
          throw Object.assign(new Error(), { msg: err?.response?.data?.error || `Couldn’t upload ${f.file.name}` });
        }
      }
      await sendMessage(chat.id, { body, gif, reply_to: replyTo?.id || null, file_ids: ids });
      files.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
      setText(''); setFiles([]); onCancelReply(); onSent?.();
    } catch (err) {
      if (err?.msg) toast.error(err.msg);
    } finally { setSending(false); area.current?.focus(); }
  };

  const onKeyDown = e => {
    if (suggest && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggest(s => ({ ...s, index: (s.index + 1) % options.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSuggest(s => ({ ...s, index: (s.index - 1 + options.length) % options.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySuggestion(options[suggest.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSuggest(null); return; }
    }
    if (e.key === 'Escape') { if (editing) { setText(''); onCancelEdit(); } else if (replyTo) onCancelReply(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  };

  const onPaste = e => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  };

  const canSend = editing ? true : (text.trim() || files.length);

  return (
    <div className="chat-composer">
      {(replyTo || editing) && (
        <div className="chat-compose-bar">
          {editing ? <><Pencil size={13} /> Editing message</> : <><Reply size={13} /> Replying to <strong>{userName(replyTo.user_id)}</strong> <span className="chat-compose-quote">{replyTo.body || (replyTo.gif ? 'GIF' : '📎 File')}</span></>}
          <button type="button" onClick={() => { if (editing) { setText(''); onCancelEdit(); } else onCancelReply(); }} title="Cancel (Esc)"><X size={14} /></button>
        </div>
      )}
      {files.length > 0 && (
        <div className="chat-compose-files">
          {files.map(f => (
            <div key={f.key} className={`chat-compose-file${f.error ? ' error' : ''}`}>
              {f.preview ? <img src={f.preview} alt="" /> : <span className="chat-compose-fileicon"><FileText size={18} /></span>}
              <span className="chat-compose-filename">{f.file.name}<small>{fileSize(f.file.size)}</small></span>
              {sending && !f.id && <span className="chat-compose-progress" style={{ width: `${Math.round(f.progress * 100)}%` }} />}
              {!sending && <button type="button" onClick={() => removeFile(f.key)} title="Remove"><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}
      <div className="chat-compose-row">
        {!editing && (
          <button type="button" className="chat-tool" title="Attach pictures or files" onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
        <div className="chat-input-wrap">
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={editing ? 'Edit your message' : `Message ${chat.name}`}
            onChange={e => { setText(e.target.value); detectSuggest(e.target.value, e.target.selectionStart); if (e.target.value.trim()) sendTyping(chat.id); }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onClick={e => detectSuggest(e.target.value, e.target.selectionStart)}
          />
          {suggest && options.length > 0 && (
            <div className="chat-suggest">
              <div className="chat-suggest-head">{suggest.kind === '@' ? 'Mention someone' : 'Link a note'}</div>
              {options.map((o, i) => (
                <button key={o.key} type="button" className={i === suggest.index ? 'on' : ''} onMouseDown={e => { e.preventDefault(); applySuggestion(o); }}>
                  {o.user ? <UserAvatar user={o.user} size={20} /> : suggest.kind === '@' ? <span style={{ width: 20, textAlign: 'center' }}>📣</span> : <span style={{ width: 20, textAlign: 'center' }}>📄</span>}
                  <span className="chat-suggest-label">{o.label}</span>
                  {o.sub && <span className="chat-suggest-sub">{o.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {!editing && (
          <>
            <div style={{ position: 'relative' }}>
              <button type="button" className={`chat-tool gif${popup === 'gif' ? ' on' : ''}`} title="GIF" onClick={() => setPopup(p => (p === 'gif' ? null : 'gif'))}>GIF</button>
              {popup === 'gif' && <GifPicker onClose={() => setPopup(null)} onPick={g => { setPopup(null); send(g); }} />}
            </div>
          </>
        )}
        <div style={{ position: 'relative' }}>
          <button type="button" className={`chat-tool${popup === 'emoji' ? ' on' : ''}`} title="Emoji" onClick={() => setPopup(p => (p === 'emoji' ? null : 'emoji'))}><Smile size={18} /></button>
          {popup === 'emoji' && (
            <EmojiPicker forChat onPick={e => insertAtCaret(e)} onClose={() => setPopup(null)}
              anchorStyle={{ position: 'absolute', bottom: 44, right: 0, zIndex: 50 }} />
          )}
        </div>
        <button type="button" className="chat-send" title={editing ? 'Save (Enter)' : 'Send (Enter)'} disabled={!canSend || sending} onClick={() => send()}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
});

export default Composer;
