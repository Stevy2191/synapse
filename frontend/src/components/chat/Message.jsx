// One chat message: author, text, pictures/files, GIF, reply quote, reactions and its actions.
import { memo, useState } from 'react';
import { Reply, SmilePlus, Pencil, Trash2, Copy, FileText, Download, CornerDownRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserAvatar } from '../Avatar';
import EmojiPicker from '../EmojiPicker';
import { useChat, toggleReaction, deleteMessage, userName } from '../../chat/client';
import { formatMessage, emojiOnly, timeLabel, fileSize } from '../../chat/format';

const QUICK = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

function Files({ files, onOpenImage }) {
  return (
    <div className="chat-files">
      {files.map(f => {
        if (f.mime?.startsWith('image/')) {
          const ratio = f.width && f.height ? Math.min(1, 320 / f.width, 260 / f.height) : null;
          return (
            <button key={f.id} type="button" className="chat-image" onClick={() => onOpenImage(f)} title={f.name}
              style={ratio ? { width: Math.round(f.width * ratio), height: Math.round(f.height * ratio) } : undefined}>
              <img src={f.url} alt={f.name} loading="lazy" />
            </button>
          );
        }
        if (f.mime?.startsWith('video/')) return <video key={f.id} className="chat-video" src={f.url} controls preload="metadata" />;
        if (f.mime?.startsWith('audio/')) return <audio key={f.id} src={f.url} controls preload="none" style={{ maxWidth: '100%' }} />;
        return (
          <a key={f.id} className="chat-file" href={`${f.url}&download`} download={f.name}>
            <FileText size={18} />
            <span style={{ minWidth: 0 }}><span className="chat-file-name">{f.name}</span><span className="chat-file-size">{fileSize(f.size)}</span></span>
            <Download size={14} style={{ marginLeft: 'auto', opacity: 0.6 }} />
          </a>
        );
      })}
    </div>
  );
}

function Message({ message: m, grouped, mine, canDelete, fmtCtx, onReply, onEdit, onOpenImage, onJump, onNoteLink, highlight }) {
  const [picker, setPicker] = useState(false);
  const users = useChat(s => s.users);
  const author = users[m.user_id];
  const myId = fmtCtx.myId;

  if (m.gif?.system) {
    return <div className="chat-system"><strong>{userName(m.user_id)}</strong> {m.body} · {timeLabel(m.created_at)}</div>;
  }

  const big = !m.deleted && !m.gif && !m.files.length && emojiOnly(m.body);
  const reactions = Object.entries(m.reactions || {});
  const onBodyClick = e => {
    const link = e.target.closest('.chat-notelink');
    if (link) { e.preventDefault(); onNoteLink(link.getAttribute('data-note')); }
  };

  return (
    <div className={`chat-msg${grouped ? ' grouped' : ''}${highlight ? ' flash' : ''}`} id={`msg-${m.id}`}>
      {m.reply_to && (
        <button type="button" className="chat-replyref" onClick={() => onJump(m.reply_to.id)}>
          <CornerDownRight size={12} /> <strong>{userName(m.reply_to.user_id)}</strong> <span>{m.reply_to.text}</span>
        </button>
      )}
      <div className="chat-msg-row">
        <div className="chat-msg-avatar">
          {grouped ? <span className="chat-msg-time-hover">{timeLabel(m.created_at)}</span> : <UserAvatar user={author || { username: '?' }} size={34} />}
        </div>
        <div className="chat-msg-main">
          {!grouped && (
            <div className="chat-msg-head">
              <span className="chat-msg-author">{author ? (author.display_name || author.username) : 'Deleted user'}</span>
              <span className="chat-msg-time">{timeLabel(m.created_at)}</span>
            </div>
          )}
          {m.deleted ? (
            <div className="chat-msg-deleted">Message deleted</div>
          ) : (
            <>
              {m.body && (
                <div className={`chat-msg-body${big ? ' big' : ''}`} onClick={onBodyClick}
                  dangerouslySetInnerHTML={{ __html: formatMessage(m.body, fmtCtx) + (m.edited_at ? ' <span class="chat-edited">(edited)</span>' : '') }} />
              )}
              {m.gif && (
                <button type="button" className="chat-gif" onClick={() => onOpenImage({ url: m.gif.url, name: m.gif.title || 'GIF' })}
                  style={m.gif.width && m.gif.height ? { aspectRatio: `${m.gif.width} / ${m.gif.height}` } : undefined}>
                  <img src={m.gif.preview || m.gif.url} alt={m.gif.title || 'GIF'} loading="lazy" referrerPolicy="no-referrer" />
                  <span className="chat-gif-tag">GIF</span>
                </button>
              )}
              {m.files.length > 0 && <Files files={m.files} onOpenImage={onOpenImage} />}
              {reactions.length > 0 && (
                <div className="chat-reactions">
                  {reactions.map(([emoji, who]) => (
                    <button key={emoji} type="button" className={`chat-reaction${who.includes(myId) ? ' on' : ''}`}
                      title={who.map(userName).join(', ')} onClick={() => toggleReaction(m, emoji)}>
                      <span>{emoji}</span> {who.length}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {!m.deleted && (
        <div className="chat-msg-actions">
          {QUICK.slice(0, 3).map(e => <button key={e} type="button" title={`React ${e}`} onClick={() => toggleReaction(m, e)}>{e}</button>)}
          <button type="button" title="Add reaction" onClick={() => setPicker(p => !p)}><SmilePlus size={15} /></button>
          <button type="button" title="Reply" onClick={() => onReply(m)}><Reply size={15} /></button>
          {m.body && <button type="button" title="Copy text" onClick={() => { navigator.clipboard?.writeText(m.body); toast.success('Copied'); }}><Copy size={14} /></button>}
          {mine && m.body !== undefined && <button type="button" title="Edit" onClick={() => onEdit(m)}><Pencil size={14} /></button>}
          {canDelete && <button type="button" title="Delete" className="danger" onClick={() => { if (confirm('Delete this message for everyone?')) deleteMessage(m.id); }}><Trash2 size={14} /></button>}
          {picker && (
            <div className="chat-react-picker">
              <div className="chat-react-quick">
                {QUICK.map(e => <button key={e} type="button" onMouseDown={ev => { ev.preventDefault(); ev.stopPropagation(); toggleReaction(m, e); setPicker(false); }}>{e}</button>)}
              </div>
              <EmojiPicker forChat onPick={e => { toggleReaction(m, e); setPicker(false); }} onClose={() => setPicker(false)}
                anchorStyle={{ position: 'static', boxShadow: 'none', border: 'none', padding: 0 }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(Message);
