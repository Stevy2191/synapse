// History: every change to a note — who made it and when — with what was added (green) and
// removed (red), and a way to bring an older version back.
import { useEffect, useMemo, useState } from 'react';
import { X, History, RotateCcw, Loader2 } from 'lucide-react';
import { diffWordsWithSpace } from 'diff';
import { UserAvatar } from '../Avatar';
import { personName } from '../../chat/client';
import { listVersions, getVersion, errorText } from '../../shares/client';

function when(sec) {
  const d = new Date(sec * 1000);
  const diff = Date.now() / 1000 - sec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (today) return `today ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
}

// Notes' Markdown copy, minus things that don't read well in a comparison
const clean = s => (s || '').replace(/```synapse-diagram\n[\s\S]*?\n```/g, '[diagram]').replace(/!\[([^\]]*)\]\(data:[^)]+\)/g, '[picture $1]');

export default function HistoryPanel({ noteId, canRestore, onRestore, onClose }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => listVersions(noteId).then(d => { setList(d.versions); if (d.versions[0] && !picked) setPicked(d.versions[0].id); }).catch(err => setError(errorText(err)));
  useEffect(() => { setList(null); setPicked(null); load(); }, [noteId]);
  useEffect(() => {
    if (!picked) return;
    setDetail(null);
    getVersion(noteId, picked).then(setDetail).catch(err => setError(errorText(err)));
  }, [picked, noteId]);

  const parts = useMemo(() => {
    if (!detail) return null;
    return diffWordsWithSpace(clean(detail.previous?.content), clean(detail.version.content));
  }, [detail]);
  const stats = useMemo(() => {
    if (!parts) return null;
    const count = (p) => (p.value.match(/\S+/g) || []).length;
    return { added: parts.filter(p => p.added).reduce((n, p) => n + count(p), 0), removed: parts.filter(p => p.removed).reduce((n, p) => n + count(p), 0) };
  }, [parts]);

  return (
    <div className="history-panel">
      <div className="history-head">
        <History size={15} />
        <span style={{ fontWeight: 650 }}>History</span>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={onClose} title="Close"><X size={15} /></button>
      </div>
      {error ? <p className="chat-pop-note" style={{ padding: 14 }}>{error}</p>
        : !list ? <div className="chat-loading"><Loader2 size={16} className="spin" /></div>
          : !list.length ? <p className="chat-pop-note" style={{ padding: 14 }}>No changes recorded yet. From now on, every edit is listed here with who made it and when.</p>
            : (
              <>
                <div className="history-list">
                  {list.map((v, i) => (
                    <button key={v.id} type="button" className={`history-item${picked === v.id ? ' on' : ''}`} onClick={() => setPicked(v.id)}>
                      <UserAvatar user={v.user || { username: '?' }} size={26} />
                      <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                        <span className="history-who">{v.user ? personName(v.user) : 'Someone'}{i === 0 && <span className="history-now"> · current</span>}</span>
                        <span className="history-when">{when(v.created_at)}{v.started_at && v.created_at - v.started_at > 90 ? ` (editing since ${new Date(v.started_at * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="history-detail">
                  {!detail ? <div className="chat-loading"><Loader2 size={16} className="spin" /></div> : (
                    <>
                      <div className="history-detail-head">
                        <span>
                          <b>{detail.version.user_id ? personName(list.find(v => v.id === detail.version.id)?.user) : 'Someone'}</b>
                          {' '}{detail.previous ? 'changed' : 'wrote'} this {when(detail.version.created_at)}
                          {stats && detail.previous && <span className="history-stats"> <span className="add">+{stats.added}</span> <span className="del">−{stats.removed}</span> words</span>}
                        </span>
                        {canRestore && list[0]?.id !== detail.version.id && (
                          <button type="button" className="btn-ghost" onClick={() => onRestore(detail.version)}><RotateCcw size={13} /> Restore this version</button>
                        )}
                      </div>
                      {detail.previous && detail.previous.title !== detail.version.title && (
                        <p className="history-title-change">Title: <del>{detail.previous.title}</del> → <ins>{detail.version.title}</ins></p>
                      )}
                      <div className="history-diff">
                        {parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
                        {!parts.length && <em>(empty)</em>}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
    </div>
  );
}
