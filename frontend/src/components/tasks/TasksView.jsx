// Every checklist item from every note in the workspace, by when it's due.
// Ticking a box or changing a date here changes the note it lives in.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Square, CalendarDays, FileText, Plus, ChevronRight, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { listTasks, updateTask, isoDay } from '../../offline/tasks';
import { addDailyTask } from '../../offline/dailyNotes';
import { openNote, openNoteByTitle } from '../../offline/sync';

const fmtDay = iso => new Date(iso + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoDay(d); };

/** Task text with [[links]] you can click. */
function TaskText({ text, workspaceId }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[\[([^\]]+)\]\]$/);
    return m
      ? <span key={i} className="wiki-link" onClick={e => { e.stopPropagation(); openNoteByTitle(workspaceId, m[1].split('|')[0]); useStore.getState().setView('editor'); }}>{m[1]}</span>
      : <span key={i}>{p}</span>;
  });
}

function DueButton({ task, today, onChange }) {
  const input = useRef(null);
  const cls = !task.due ? 'none' : task.done ? '' : task.due < today ? 'overdue' : task.due === today ? 'today' : '';
  const label = !task.due ? 'Add date' : task.due === today ? 'Today' : task.due === addDays(today, 1) ? 'Tomorrow' : fmtDay(task.due);
  return (
    <span className={`task-due ${cls}`}>
      <button type="button" title="Change the due date" onClick={() => input.current?.showPicker ? input.current.showPicker() : input.current?.click()}>
        <CalendarDays size={12} /> {label}
      </button>
      <input ref={input} type="date" value={task.due || ''} aria-label="Due date" tabIndex={-1}
        onChange={e => onChange(e.target.value || null)} />
    </span>
  );
}

export default function TasksView() {
  const ws = useStore(s => s.activeWorkspace);
  const notes = useStore(s => s.notes);
  const [tasks, setTasks] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const today = isoDay();

  const load = useCallback(async () => {
    if (!ws) return;
    setTasks(await listTasks(ws.id));
  }, [ws?.id]);
  // Reload when notes change (edits here, syncs from other devices) and when the window comes back.
  useEffect(() => { load(); }, [load, notes]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const change = async (task, ch) => {
    setTasks(ts => ts.map(t => (t === task ? { ...t, ...ch } : t)));   // show it straight away
    try { await updateTask(ws.id, task, ch); } catch (err) { toast.error(err.message); }
    load();
  };

  const add = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await addDailyTask(new Date(), text.trim(), due || null);
      setText(''); setDue('');
      toast.success('Added to today’s daily note');
      load();
    } catch (err) { toast.error(err.message || 'Couldn’t add the task'); }
  };

  const groups = useMemo(() => {
    if (!tasks) return [];
    const open = tasks.filter(t => !t.done);
    const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || a.noteTitle.localeCompare(b.noteTitle);
    const weekEnd = addDays(today, 7);
    return [
      { key: 'overdue', title: 'Overdue', items: open.filter(t => t.due && t.due < today).sort(byDue) },
      { key: 'today', title: 'Today', items: open.filter(t => t.due === today).sort(byDue) },
      { key: 'week', title: 'Next 7 days', items: open.filter(t => t.due > today && t.due <= weekEnd).sort(byDue) },
      { key: 'later', title: 'Later', items: open.filter(t => t.due > weekEnd).sort(byDue) },
      { key: 'none', title: 'No date', items: open.filter(t => !t.due).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) },
    ].filter(g => g.items.length);
  }, [tasks, today]);
  const done = useMemo(() => (tasks || []).filter(t => t.done).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [tasks]);
  const openCount = (tasks || []).filter(t => !t.done).length;

  const Row = ({ t }) => (
    <div className={`task-row${t.done ? ' done' : ''}`}>
      <button type="button" className="task-check" title={t.done ? 'Mark as not done' : 'Mark as done'} onClick={() => change(t, { done: !t.done })}>
        {t.done ? <CheckSquare size={17} /> : <Square size={17} />}
      </button>
      <div className="task-main">
        <div className="task-text"><TaskText text={t.text} workspaceId={ws.id} /></div>
        <div className="task-meta">
          {!t.done && t.due && <DueButton task={t} today={today} onChange={d => change(t, { due: d })} />}
          <button type="button" className="task-source" title="Open the note" onClick={() => { openNote(t.noteId); useStore.getState().setView('editor'); }}>
            <FileText size={12} /> {t.noteTitle}
          </button>
          {!t.done && !t.due && <DueButton task={t} today={today} onChange={d => change(t, { due: d })} />}
        </div>
      </div>
    </div>
  );

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head">
          <h1>Tasks</h1>
          <span>{tasks ? `${openCount} open` : ''}</span>
          <button className="btn-ghost" title="Refresh" onClick={load} style={{ marginLeft: 'auto' }}><RefreshCw size={14} /></button>
        </div>
        <p className="tasks-lead">Every checklist item in <b>{ws?.name}</b>. Add a due date by typing <code>📅 2026-11-20</code> after a task, or with the date button here.</p>

        <form className="tasks-add" onSubmit={add}>
          <Plus size={16} />
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a task to today’s daily note…" maxLength={300} />
          <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" title="Due date (optional)" />
          <button type="submit" className="cp-btn primary" disabled={!text.trim()}>Add</button>
        </form>

        {tasks === null && <p className="tasks-empty">Loading…</p>}
        {tasks && openCount === 0 && (
          <p className="tasks-empty">Nothing to do. 🎉 Checklist items from your notes and meetings will show up here.</p>
        )}
        {groups.map(g => (
          <section key={g.key} className={`tasks-group ${g.key}`}>
            <h2>{g.title} <span>{g.items.length}</span></h2>
            {g.items.map(t => <Row key={`${t.noteId}:${t.index}`} t={t} />)}
          </section>
        ))}
        {done.length > 0 && (
          <section className="tasks-group done">
            <h2 className="toggle" onClick={() => setShowDone(s => !s)}>
              <ChevronRight size={14} style={{ transform: showDone ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /> Done <span>{done.length}</span>
            </h2>
            {showDone && done.slice(0, 100).map(t => <Row key={`${t.noteId}:${t.index}`} t={t} />)}
          </section>
        )}
      </div>
    </div>
  );
}
