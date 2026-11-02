// Tasks as a Trello-style board: a column per status, cards with priority labels, drag a card to move
// it (mouse, pen or a long press on touch), "+ Add a card" saves to today's daily note.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, MoreHorizontal, CalendarDays, Bell, Repeat, FileText, X, Check, ArrowLeft, ArrowRight, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { updateTask, isoDay } from '../../offline/tasks';
import { addDailyTask } from '../../offline/dailyNotes';
import { openNote, openNoteByTitle } from '../../offline/sync';
import { PRIORITIES, priRank, fmtDue } from '../../offline/taskWhen';
import { boardOf, saveBoard, columnOf, moveTask, columnKey, emptyColumn, COLUMN_COLORS } from '../../tasks/board';
import TaskWhenDialog from './TaskWhenDialog';
import Assignee from './Assignee';
import { isTeamWorkspace, membersNow, personLabel } from '../../team/team';

const PRI_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const errText = err => err?.response?.data?.error || (err?.response ? 'Couldn’t save' : 'Changing the board’s lists needs a connection');
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return isoDay(d); };
export const SORTS = { priority: 'Priority', due: 'Due date', note: 'Note' };

export function sortTasks(list, sort) {
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99');
  const byPri = (a, b) => priRank(a.priority) - priRank(b.priority);
  const fns = { priority: [byPri, byDue], due: [byDue, byPri], note: [(a, b) => a.noteTitle.localeCompare(b.noteTitle), byPri, byDue] }[sort] || [byPri, byDue];
  return [...list].sort((a, b) => { for (const f of fns) { const r = f(a, b); if (r) return r; } return a.text.localeCompare(b.text); });
}

function CardText({ text, workspaceId }) {
  return text.split(/(\[\[[^\]]+\]\])/g).map((p, i) => {
    const m = p.match(/^\[\[([^\]]+)\]\]$/);
    return m
      ? <span key={i} className="wiki-link" onClick={e => { e.stopPropagation(); openNoteByTitle(workspaceId, m[1].split('|')[0]); useStore.getState().setView('editor'); }}>{m[1]}</span>
      : <span key={i}>{p}</span>;
  });
}

export default function BoardView({ tasks, groupBy, sort, onChanged, workspace }) {
  const ws = workspace;
  const columns = boardOf(ws);
  const today = isoDay();
  const [editing, setEditing] = useState(null);   // task in the details dialog
  const [menu, setMenu] = useState(null);         // column key with its menu open
  const [adding, setAdding] = useState(null);     // column key with the add-card box open
  const [newList, setNewList] = useState(null);   // text of a new list, or null
  const [drag, setDrag] = useState(null);         // { task, x, y, w, over }
  const dragRef = useRef(null);

  // Columns: by status (the board's lists) or by priority.
  const cols = groupBy === 'priority'
    ? [...PRIORITIES.map(([k, l]) => ({ key: `p:${k}`, name: l, pri: k })), { key: 'p:none', name: 'No priority', pri: null }]
    : columns;
  const cardsIn = useMemo(() => {
    const map = Object.fromEntries(cols.map(c => [c.key, []]));
    for (const t of tasks) {
      if (groupBy === 'priority') { if (!t.done) map[`p:${t.priority || 'none'}`]?.push(t); } else map[columnOf(t, columns)]?.push(t);
    }
    for (const k of Object.keys(map)) {
      map[k] = k === 'done' ? map[k].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30) : sortTasks(map[k], sort);
    }
    return map;
  }, [tasks, groupBy, sort, JSON.stringify(columns)]);

  const run = async (fn, ok) => {
    try { const r = await fn(); if (r?.next) toast.success(`Done — it repeats, next on ${fmtDue(r.next)}`); else if (ok) toast.success(ok); } catch (err) { toast.error(err.message || 'Something went wrong'); }
    onChanged();
  };
  const dropOn = (task, colKey) => {
    if (groupBy === 'priority') {
      const pri = colKey.slice(2) === 'none' ? null : colKey.slice(2);
      if (pri !== (task.priority || null)) run(() => updateTask(ws.id, task, { priority: pri }));
    } else if (colKey !== columnOf(task, columns)) run(() => moveTask(ws.id, task, colKey));
  };

  // ── drag with pointer events (works with mouse, pen and touch; touch needs a short press first) ──
  const startDrag = (e, task) => {
    if (e.button !== 0 || e.target.closest('button, a, .wiki-link, input, textarea')) return;
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, task, dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, active: false, touch: e.pointerType === 'touch', pid: e.pointerId };
    dragRef.current = start;
    const activate = () => { start.active = true; navigator.vibrate?.(15); setDrag({ task, x: start.x - start.dx, y: start.y - start.dy, w: start.w, over: null }); };
    if (start.touch) start.timer = setTimeout(activate, 280);
    const blockScroll = ev => { if (start.active) ev.preventDefault(); };
    const move = ev => {
      if (ev.pointerId !== start.pid) return;
      if (!start.active) {
        const far = Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6;
        if (start.touch) { if (far) cleanup(); return; } // moved before the long press: let the page scroll
        if (far) activate(); else return;
      }
      start.x = ev.clientX; start.y = ev.clientY;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]');
      setDrag(d => d && { ...d, x: ev.clientX - start.dx, y: ev.clientY - start.dy, over: el?.dataset.col || null });
      // Scroll the board sideways near its edges.
      const board = document.querySelector('.kb-board');
      if (board) { const r = board.getBoundingClientRect(); if (ev.clientX > r.right - 40) board.scrollLeft += 14; else if (ev.clientX < r.left + 40) board.scrollLeft -= 14; }
    };
    const up = ev => {
      if (ev.pointerId !== start.pid) return;
      if (start.active) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]');
        if (el) dropOn(task, el.dataset.col);
        start.justDragged = true;
        setTimeout(() => { start.justDragged = false; }, 50);
      }
      cleanup();
    };
    function cleanup() {
      clearTimeout(start.timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('touchmove', blockScroll);
      setDrag(null);
      if (!start.active) dragRef.current = null;
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
    document.addEventListener('touchmove', blockScroll, { passive: false });
  };
  const clickCard = task => { if (dragRef.current?.justDragged) return; setEditing(task); };

  // ── lists ──
  const saveCols = async next => { try { await saveBoard(next); } catch (err) { toast.error(errText(err)); } };
  const addList = async () => {
    const name = (newList || '').trim();
    if (!name) { setNewList(null); return; }
    const done = columns.findIndex(c => c.key === 'done');
    const next = [...columns];
    next.splice(done < 0 ? next.length : done, 0, { key: columnKey(name, columns), name: name.slice(0, 40) });
    await saveCols(next);
    setNewList(null);
  };
  const renameList = c => {
    const name = prompt('List name:', c.name);
    if (name && name.trim()) saveCols(columns.map(x => (x.key === c.key ? { ...x, name: name.trim().slice(0, 40) } : x)));
  };
  const moveList = (c, dir) => {
    const i = columns.findIndex(x => x.key === c.key); const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns]; [next[i], next[j]] = [next[j], next[i]]; saveCols(next);
  };
  const colorList = (c, color) => saveCols(columns.map(x => (x.key === c.key ? { ...x, color } : x)));
  const deleteList = async c => {
    const n = cardsIn[c.key]?.length || 0;
    if (!confirm(`Delete the list “${c.name}”?${n ? ` Its ${n} card${n === 1 ? '' : 's'} move back to ${columns.find(x => x.key === 'todo')?.name || 'To do'}.` : ''}`)) return;
    try { await saveBoard(columns.filter(x => x.key !== c.key)); await emptyColumn(ws.id, c.key); onChanged(); } catch (err) { toast.error(errText(err)); }
  };

  const addCard = async (col, text) => {
    const t = text.trim();
    if (!t) return;
    const extra = groupBy === 'priority' ? { priority: col.pri } : { status: col.key === 'todo' ? null : col.key };
    try { await addDailyTask(new Date(), t, null, extra); toast.success('Added to today’s daily note'); onChanged(); } catch (err) { toast.error(err.message || 'Couldn’t add the card'); }
  };

  return (
    <>
      <div className={`kb-board${drag ? ' dragging' : ''}`}>
        {cols.map(c => {
          const cards = cardsIn[c.key] || [];
          const isStatus = groupBy !== 'priority';
          return (
            <section key={c.key} className={`kb-col${drag?.over === c.key ? ' over' : ''}${c.pri ? ` pri-col-${c.pri}` : ''}`} data-col={c.key} style={c.color ? { '--col': c.color } : undefined}>
              <header className="kb-col-head">
                <span className="kb-col-name">{c.name}</span>
                <span className="kb-col-count">{cards.length}{c.key === 'done' && cards.length >= 30 ? '+' : ''}</span>
                {isStatus && (
                  <span className="kb-menu-wrap">
                    <button type="button" className="kb-icon" title="List actions" onClick={() => setMenu(menu === c.key ? null : c.key)}><MoreHorizontal size={16} /></button>
                    {menu === c.key && (
                      <div className="kb-menu" onMouseLeave={() => setMenu(null)}>
                        <button type="button" onClick={() => { setMenu(null); renameList(c); }}><Pencil size={13} /> Rename</button>
                        <button type="button" onClick={() => { setMenu(null); moveList(c, -1); }}><ArrowLeft size={13} /> Move left</button>
                        <button type="button" onClick={() => { setMenu(null); moveList(c, 1); }}><ArrowRight size={13} /> Move right</button>
                        <div className="kb-colors">{COLUMN_COLORS.map(col => <button key={col} type="button" title="Colour" style={{ background: col }} onClick={() => { setMenu(null); colorList(c, col); }} />)}</div>
                        {!['todo', 'done'].includes(c.key) && <button type="button" className="danger" onClick={() => { setMenu(null); deleteList(c); }}><Trash2 size={13} /> Delete list</button>}
                      </div>
                    )}
                  </span>
                )}
              </header>
              <div className="kb-cards">
                {cards.map(t => (
                  <article key={`${t.noteId}:${t.index}:${t.text}`} className={`kb-card${t.done ? ' done' : ''}${drag?.task === t ? ' ghost' : ''}`}
                    onPointerDown={e => startDrag(e, t)} onClick={() => clickCard(t)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setEditing(t)}>
                    {t.priority && <span className={`kb-label pri-${t.priority}`}>{PRI_LABEL[t.priority]}</span>}
                    <div className="kb-card-text">
                      <button type="button" className="kb-check" title={t.done ? 'Mark as not done' : 'Mark as done'} onClick={e => { e.stopPropagation(); run(() => updateTask(ws.id, t, { done: !t.done })); }}>
                        {t.done ? <Check size={12} /> : null}
                      </button>
                      <span><CardText text={t.text} workspaceId={ws.id} /></span>
                    </div>
                    <div className="kb-badges">
                      {t.due && <span className={`kb-badge${t.done ? '' : t.due < today ? ' overdue' : t.due === today ? ' today' : ''}`}><CalendarDays size={12} /> {t.due === today ? 'Today' : t.due === addDays(today, 1) ? 'Tomorrow' : fmtDue(t.due)}</span>}
                      {t.time && <span className="kb-badge"><Bell size={12} /> {t.time}</span>}
                      {t.repeat && <span className="kb-badge" title={t.repeat}><Repeat size={12} /></span>}
                      <span className="kb-badge kb-note" title="In this note"><FileText size={12} /> {t.noteTitle}</span>
                      {t.assignee && <span className="kb-who"><Assignee username={t.assignee} /></span>}
                    </div>
                  </article>
                ))}
              </div>
              {c.key !== 'done' && (adding === c.key ? (
                <AddCard onAdd={text => addCard(c, text)} onClose={() => setAdding(null)} />
              ) : (
                <button type="button" className="kb-add" onClick={() => setAdding(c.key)}><Plus size={15} /> Add a card</button>
              ))}
            </section>
          );
        })}
        {groupBy !== 'priority' && (newList === null ? (
          <button type="button" className="kb-new-list" onClick={() => setNewList('')}><Plus size={15} /> Add another list</button>
        ) : (
          <section className="kb-col kb-col-new">
            <input className="kb-input" autoFocus value={newList} onChange={e => setNewList(e.target.value)} placeholder="List name, e.g. Waiting on someone"
              onKeyDown={e => { if (e.key === 'Enter') addList(); if (e.key === 'Escape') setNewList(null); }} maxLength={40} />
            <div className="kb-row"><button type="button" className="export-go" onClick={addList}>Add list</button><button type="button" className="kb-icon" onClick={() => setNewList(null)}><X size={16} /></button></div>
          </section>
        ))}
      </div>
      {drag && (
        <div className="kb-card kb-drag" style={{ left: drag.x, top: drag.y, width: drag.w }}>
          {drag.task.priority && <span className={`kb-label pri-${drag.task.priority}`}>{PRI_LABEL[drag.task.priority]}</span>}
          <div className="kb-card-text"><span>{drag.task.text}</span></div>
        </div>
      )}
      {editing && <CardDialog task={editing} columns={columns} ws={ws} onClose={() => setEditing(null)} onChanged={onChanged} run={run} />}
    </>
  );
}

function AddCard({ onAdd, onClose }) {
  const [text, setText] = useState('');
  const submit = () => { if (text.trim()) { onAdd(text); setText(''); } };
  return (
    <div className="kb-add-box">
      <textarea className="kb-input" autoFocus rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="What needs doing?"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') onClose(); }} maxLength={300} />
      <div className="kb-row"><button type="button" className="export-go" disabled={!text.trim()} onClick={submit}>Add card</button><button type="button" className="kb-icon" onClick={onClose}><X size={16} /></button></div>
    </div>
  );
}

/** Click a card: priority, list, date/reminder/repeat, open the note. */
function CardDialog({ task, columns, ws, onClose, onChanged, run }) {
  const [when, setWhen] = useState(false);
  const col = columnOf(task, columns);
  const set = (change, close = true) => { run(() => updateTask(ws.id, task, change)); if (close) onClose(); };
  if (when) return <TaskWhenDialog initial={task} task={task.text} onClose={onClose} onSave={w => { onClose(); run(() => updateTask(ws.id, task, w)); }} />;
  return (
    <div className="kb-dialog-back" onClick={onClose}>
      <div className="kb-dialog fade-in" onClick={e => e.stopPropagation()} role="dialog">
        <button type="button" className="kb-icon kb-dialog-x" onClick={onClose} title="Close"><X size={18} /></button>
        <h3>{task.text}</h3>
        <p className="kb-dialog-sub">in <button type="button" className="cl-link" onClick={() => { onClose(); openNote(task.noteId).then(() => useStore.getState().setView('editor')); }}>{task.noteTitle}</button> · list <b>{columns.find(c => c.key === col)?.name}</b></p>
        <h4>Priority</h4>
        <div className="seg pri-seg">
          <button type="button" className={!task.priority ? 'on' : ''} onClick={() => set({ priority: null })}>None</button>
          {PRIORITIES.map(([k, l]) => <button key={k} type="button" className={`pri-${k}${task.priority === k ? ' on' : ''}`} onClick={() => set({ priority: k })}>{l}</button>)}
        </div>
        {isTeamWorkspace(ws) && (
          <>
            <h4>Assigned to</h4>
            <select className="chat-field" value={task.assignee || ''} onChange={e => set({ assignee: e.target.value || null })} style={{ minWidth: 220 }}>
              <option value="">Nobody</option>
              {membersNow(ws.id).map(p => <option key={p.id} value={p.username.toLowerCase()}>{personLabel(p)} (@{p.username})</option>)}
            </select>
          </>
        )}
        <h4>Move to</h4>
        <div className="kb-move">
          {columns.map(c => <button key={c.key} type="button" className={c.key === col ? 'on' : ''} disabled={c.key === col} onClick={() => { onClose(); run(() => moveTask(ws.id, task, c.key)); }}>{c.name}</button>)}
        </div>
        <h4>Date, reminder & repeat</h4>
        <button type="button" className="btn-ghost" onClick={() => setWhen(true)}>
          <CalendarDays size={14} /> {task.due ? fmtDue(task.due) : 'Add a date'}{task.time ? ` · ${task.time}` : ''}{task.repeat ? ` · ${task.repeat}` : ''}
        </button>
        <div className="kb-dialog-foot">
          <button type="button" className="btn-ghost" onClick={() => { onClose(); openNote(task.noteId).then(() => useStore.getState().setView('editor')); }}><FileText size={14} /> Open the note</button>
          <button type="button" className="export-go" onClick={() => { onClose(); run(() => updateTask(ws.id, task, { done: !task.done })); }}>{task.done ? 'Mark as not done' : 'Mark as done'}</button>
        </div>
      </div>
    </div>
  );
}
