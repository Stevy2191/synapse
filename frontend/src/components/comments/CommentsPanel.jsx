// Comments beside a note: threads on highlighted text (and on the whole note), replies, resolve.
import { useEffect, useRef, useState } from 'react';
import { X, Check, RotateCcw, MoreHorizontal, MessageSquarePlus, ChevronRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { addThread, reply, editComment, deleteComment, resolveThread, removeHighlight, scrollToThread } from '../../comments/client';
import { colorFor } from '../../collab/session';
import { formatMessage } from '../../chat/format';

const ago = s => {
  const d = Date.now() / 1000 - s;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const errText = err => err?.response?.data?.error || (err?.response ? 'Couldn’t save the comment' : 'Comments need a connection');
const who = a => a?.display_name || a?.username || 'Someone';

function Composer({ placeholder, onSend, onCancel, autoFocus, initial = '' }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onSend(text.trim()); setText(''); } catch (err) { toast.error(errText(err)); }
    setBusy(false);
  };
  return (
    <div className="cm-composer">
      <textarea value={text} autoFocus={autoFocus} rows={2} placeholder={placeholder} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); send(); } if (e.key === 'Escape' && onCancel) onCancel(); }} maxLength={5000} />
      <div className="cm-composer-row">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="export-go" disabled={!text.trim() || busy} onClick={send}>{busy ? <Loader2 size={13} className="spin" /> : null} {initial ? 'Save' : 'Comment'}</button>
      </div>
    </div>
  );
}

function Comment({ c, me, canDelete, onChanged }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  if (c.deleted) return <div className="cm-comment deleted">Comment deleted</div>;
  return (
    <div className="cm-comment">
      <div className="cm-head">
        <span className="cm-avatar" style={{ background: colorFor(c.author?.username) }}>{who(c.author).slice(0, 1).toUpperCase()}</span>
        <b>{who(c.author)}</b><span className="cm-time">{ago(c.created_at)}{c.edited_at ? ' · edited' : ''}</span>
        {(c.author?.id === me || canDelete) && (
          <span className="cm-menu-wrap">
            <button type="button" className="kb-icon" onClick={() => setMenu(m => !m)} title="More"><MoreHorizontal size={14} /></button>
            {menu && (
              <div className="kb-menu" onMouseLeave={() => setMenu(false)}>
                {c.author?.id === me && <button type="button" onClick={() => { setMenu(false); setEditing(true); }}>Edit</button>}
                <button type="button" className="danger" onClick={async () => { setMenu(false); if (!confirm('Delete this comment?')) return; try { onChanged(await deleteComment(c.id)); } catch (err) { toast.error(errText(err)); } }}>Delete</button>
              </div>
            )}
          </span>
        )}
      </div>
      {editing
        ? <Composer initial={c.body} autoFocus onCancel={() => setEditing(false)} onSend={async body => { onChanged(await editComment(c.id, body)); setEditing(false); }} />
        : <div className="cm-body" dangerouslySetInnerHTML={{ __html: formatMessage(c.body) }} />}
    </div>
  );
}

function Thread({ t, noteId, editor, me, isOwner, onChanged, focus, refs }) {
  return (
    <div ref={el => { refs.current[t.id] = el; }} className={`cm-thread${focus === t.id ? ' focus' : ''}${t.resolved_at ? ' resolved' : ''}`}
      onClick={() => editor && t.anchored && scrollToThread(editor, t.id)}>
      {t.anchored ? <div className="cm-quote" title="Show it in the note">“{t.quote || '…'}”</div> : <div className="cm-quote general">On the whole note</div>}
      {t.comments.map(c => <Comment key={c.id} c={c} me={me} canDelete={isOwner} onChanged={onChanged} />)}
      {t.resolved_at && <div className="cm-resolved-by"><Check size={12} /> Resolved by {t.resolved_by}</div>}
      <div className="cm-actions" onClick={e => e.stopPropagation()}>
        {!t.resolved_at && <Composer placeholder="Reply… (@ to mention)" onSend={async body => onChanged(await reply(noteId, t.id, body))} />}
        <button type="button" className="btn-ghost cm-resolve" onClick={async () => { try { onChanged(await resolveThread(t.id, !t.resolved_at)); } catch (err) { toast.error(errText(err)); } }}>
          {t.resolved_at ? <><RotateCcw size={13} /> Reopen</> : <><Check size={13} /> Resolve</>}
        </button>
      </div>
    </div>
  );
}

/**
 * threads: from getThreads; draft: { id, quote } for a new highlighted comment; focus: thread id to show.
 */
export default function CommentsPanel({ noteId, threads, canAnchor, editor, draft, onDraftDone, focus, onChanged, onClose, online, isOwner }) {
  const me = useStore(s => s.user?.id);
  const [general, setGeneral] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const refs = useRef({});
  useEffect(() => { if (focus) refs.current[focus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focus, threads]);

  const open = (threads || []).filter(t => !t.resolved_at);
  const resolved = (threads || []).filter(t => t.resolved_at);
  const tp = { noteId, editor, me, isOwner, onChanged, focus, refs };
  const cancelDraft = () => { if (draft && editor) removeHighlight(editor, draft.id); onDraftDone(); };

  return (
    <div className="cm-panel">
      <div className="cm-panel-head">
        <b>Comments</b>
        <span className="cm-count">{open.length ? `${open.length} open` : ''}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="kb-icon" onClick={onClose} title="Close"><X size={16} /></button>
      </div>
      {!online && <p className="cm-empty">Comments need a connection. They’ll be here when you’re back online.</p>}
      {online && (
        <div className="cm-scroll">
          {draft && (
            <div className="cm-thread focus">
              <div className="cm-quote">“{draft.quote}”</div>
              <Composer autoFocus placeholder="Add a comment… (@ to mention someone)" onCancel={cancelDraft}
                onSend={async body => { const r = await addThread(noteId, { id: draft.id, anchored: true, quote: draft.quote, body }); onDraftDone(r.thread_id); onChanged(r); }} />
            </div>
          )}
          {general ? (
            <div className="cm-thread focus">
              <div className="cm-quote general">On the whole note</div>
              <Composer autoFocus placeholder="Add a comment… (@ to mention someone)" onCancel={() => setGeneral(false)}
                onSend={async body => { const r = await addThread(noteId, { anchored: false, body }); setGeneral(false); onChanged(r); }} />
            </div>
          ) : (
            <button type="button" className="cm-new" onClick={() => setGeneral(true)}><MessageSquarePlus size={14} /> Comment on the whole note</button>
          )}
          {canAnchor && !draft && <p className="cm-hint">To comment on part of the note, select the words and click <b>Comment</b>.</p>}
          {threads === null && <p className="cm-empty"><Loader2 size={14} className="spin" /> Loading…</p>}
          {threads && !open.length && !draft && <p className="cm-empty">No open comments.</p>}
          {open.map(t => <Thread key={t.id} t={t} {...tp} />)}
          {resolved.length > 0 && (
            <>
              <button type="button" className="cm-new" onClick={() => setShowResolved(s => !s)}>
                <ChevronRight size={13} style={{ transform: showResolved ? 'rotate(90deg)' : 'none' }} /> Resolved ({resolved.length})
              </button>
              {showResolved && resolved.map(t => <Thread key={t.id} t={t} {...tp} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
