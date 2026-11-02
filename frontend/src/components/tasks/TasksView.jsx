// Every checklist item from every note in the workspace, by when it's due.
// Ticking a box or changing a date here changes the note it lives in.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Square, CalendarDays, FileText, Plus, ChevronRight, RefreshCw, Bell, Repeat } from 'lucide-react';
import TaskWhenDialog from './TaskWhenDialog';
import BoardView, { sortTasks, SORTS } from './BoardView';
import { PRIORITIES } from '../../offline/taskWhen';
import { LayoutList, Columns3, Flag } from 'lucide-react';
import { fmtDue } from '../../offline/taskWhen';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import SidebarButton from '../sidebar/SidebarButton';
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
  const [open, setOpen] = useState(false);
  const cls = !task.due ? 'none' : task.done ? '' : task.due < today ? 'overdue' : task.due === today ? 'today' : '';
  const label = !task.due ? 'Add date' : task.due === today ? 'Today' : task.due === addDays(today, 1) ? 'Tomorrow' : fmtDay(task.due);
  return (
    <span className={`task-due ${cls}`}>
      <button type="button" title="Due date, reminder or repeat" onClick={() => setOpen(true)}>
        <CalendarDays size={12} /> {label}
        {task.time && <><Bell size={11} /> {task.time}</>}
        {task.repeat && <span title={task.repeat}><Repeat size={11} /></span>}
      </button>
      {open && <TaskWhenDialog initial={task} task={task.text} onClose={() => setOpen(false)} onSave={w => { setOpen(false); onChange(w); }} />}
    </span>
  );
}

export default function TasksView() {
  const ws = useStore(s => s.activeWorkspace);
  const notes = useStore(s => s.notes);
  const [tasks, setTasks] = useState(null);
  const [showDone, setShowDone] = useState(false);
  // By default: tasks with a due date, plus everything in meeting and daily notes.
  // "All checklists" also shows undated items from other notes (shopping lists, reading lists…).
  const [showAll, setShowAllState] = useState(() => { try { return localStorage.getItem('synapse.tasks.all') === '1'; } catch { return false; } });
  const setShowAll = v => { setShowAllState(v); try { localStorage.setItem('synapse.tasks.all', v ? '1' : '0'); } catch { /* ignore */ } };
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [pri, setPri] = useState('');
  const pref = (key, def) => { try { return localStorage.getItem(`synapse.tasks.${key}`) || def; } catch { return def; } };
  const usePref = (key, def) => {
    const [v, setV] = useState(() => pref(key, def));
    return [v, x => { setV(x); try { localStorage.setItem(`synapse.tasks.${key}`, x); } catch { /* ignore */ } }];
  };
  const [layout, setLayout] = usePref('layout', 'list');       // list | board (this device)
  const [listGroup, setListGroup] = usePref('listGroup', 'due'); // due | priority
  const [boardGroup, setBoardGroup] = usePref('boardGroup', 'status'); // status | priority
  const [sort, setSort] = usePref('sort', 'priority');         // priority | due | note
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
    try {
      const r = await updateTask(ws.id, task, ch);
      if (r?.next) toast.success(`Done — it repeats, next on ${fmtDue(r.next)}`);
    } catch (err) { toast.error(err.message); }
    load();
  };

  const add = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await addDailyTask(new Date(), text.trim(), due || null, pri ? { priority: pri } : {});
      setText(''); setDue(''); setPri('');
      toast.success('Added to today’s daily note');
      load();
    } catch (err) { toast.error(err.message || 'Couldn’t add the task'); }
  };

  const shown = useMemo(() => (tasks || []).filter(t => showAll || t.due || t.kind), [tasks, showAll]);
  const hiddenOpen = (tasks || []).filter(t => !t.done && !(showAll || t.due || t.kind)).length;
  const groups = useMemo(() => {
    if (!tasks) return [];
    const open = shown.filter(t => !t.done);
    const s = list => sortTasks(list, sort);
    if (listGroup === 'priority') {
      return [...PRIORITIES.map(([k, l]) => ({ key: `pri-${k}`, title: `${l} priority`, items: s(open.filter(t => t.priority === k)) })),
        { key: 'pri-none', title: 'No priority', items: s(open.filter(t => !t.priority)) }].filter(g => g.items.length);
    }
    const weekEnd = addDays(today, 7);
    return [
      { key: 'overdue', title: 'Overdue', items: s(open.filter(t => t.due && t.due < today)) },
      { key: 'today', title: 'Today', items: s(open.filter(t => t.due === today)) },
      { key: 'week', title: 'Next 7 days', items: s(open.filter(t => t.due > today && t.due <= weekEnd)) },
      { key: 'later', title: 'Later', items: s(open.filter(t => t.due > weekEnd)) },
      { key: 'none', title: 'No date', items: s(open.filter(t => !t.due)) },
    ].filter(g => g.items.length);
  }, [tasks, shown, today, listGroup, sort]);
  const done = useMemo(() => shown.filter(t => t.done).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [shown]);
  const openCount = shown.filter(t => !t.done).length;

  const Row = ({ t }) => (
    <div className={`task-row${t.done ? ' done' : ''}`}>
      <button type="button" className="task-check" title={t.done ? 'Mark as not done' : 'Mark as done'} onClick={() => change(t, { done: !t.done })}>
        {t.done ? <CheckSquare size={17} /> : <Square size={17} />}
      </button>
      <div className="task-main">
        <div className="task-text">{t.priority && <span className={`kb-label inline pri-${t.priority}`}>{{ high: 'High', medium: 'Medium', low: 'Low' }[t.priority]}</span>}<TaskText text={t.text} workspaceId={ws.id} /></div>
        <div className="task-meta">
          {!t.done && t.due && <DueButton task={t} today={today} onChange={w => change(t, w)} />}
          <button type="button" className="task-source" title="Open the note" onClick={() => { openNote(t.noteId); useStore.getState().setView('editor'); }}>
            <FileText size={12} /> {t.noteTitle}
          </button>
          {!t.done && !t.due && <DueButton task={t} today={today} onChange={w => change(t, w)} />}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`tasks-view${layout === 'board' ? ' board-mode' : ''}`}>
      <div className="tasks-inner">
        <div className="tasks-head">
          <SidebarButton />
          <h1>Tasks</h1>
          <span>{tasks ? `${openCount} open` : ''}</span>
          <div className="seg tasks-layout" style={{ marginLeft: 'auto' }}>
            <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="List"><LayoutList size={14} /> List</button>
            <button className={layout === 'board' ? 'on' : ''} onClick={() => setLayout('board')} title="Board (like Trello)"><Columns3 size={14} /> Board</button>
          </div>
          <button className="btn-ghost" title="Refresh" onClick={load}><RefreshCw size={14} /></button>
        </div>
        {layout === 'list' && (
          <p className="tasks-lead">
            {showAll ? <>Every checklist item in <b>{ws?.name}</b>.</> : <>To-dos with a due date, plus everything from meeting and daily notes.</>}
            {' '}Give a checklist item a date, priority or reminder with <b>/due</b> in a note, or click its date here. Tag a note <code>#no-tasks</code> to keep it out of here.
          </p>
        )}
        <div className="tasks-controls">
          <div className="seg tasks-filter">
            <button className={!showAll ? 'on' : ''} onClick={() => setShowAll(false)}>To-dos</button>
            <button className={showAll ? 'on' : ''} onClick={() => setShowAll(true)}>
              All checklists{!showAll && hiddenOpen > 0 ? ` (+${hiddenOpen})` : ''}
            </button>
          </div>
          <label className="tasks-select">Group by
            {layout === 'list' ? (
              <select value={listGroup} onChange={e => setListGroup(e.target.value)}><option value="due">Due date</option><option value="priority">Priority</option></select>
            ) : (
              <select value={boardGroup} onChange={e => setBoardGroup(e.target.value)}><option value="status">Lists</option><option value="priority">Priority</option></select>
            )}
          </label>
          <label className="tasks-select">Sort by
            <select value={sort} onChange={e => setSort(e.target.value)}>{Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>

        {layout === 'list' && (
          <form className="tasks-add" onSubmit={add}>
            <Plus size={16} />
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a task to today’s daily note…" maxLength={300} />
            <select value={pri} onChange={e => setPri(e.target.value)} aria-label="Priority" title="Priority (optional)" className="tasks-add-pri">
              <option value="">No priority</option>{PRIORITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" title="Due date (optional)" />
            <button type="submit" className="cp-btn primary" disabled={!text.trim()}>Add</button>
          </form>
        )}

        {tasks === null && <p className="tasks-empty">Loading…</p>}
        {layout === 'list' && tasks && openCount === 0 && (
          <p className="tasks-empty">Nothing to do. 🎉 Checklist items from your notes and meetings will show up here.</p>
        )}
        {layout === 'list' && groups.map(g => (
          <section key={g.key} className={`tasks-group ${g.key}`}>
            <h2>{g.title} <span>{g.items.length}</span></h2>
            {g.items.map(t => <Row key={`${t.noteId}:${t.index}`} t={t} />)}
          </section>
        ))}
        {layout === 'list' && done.length > 0 && (
          <section className="tasks-group done">
            <h2 className="toggle" onClick={() => setShowDone(s => !s)}>
              <ChevronRight size={14} style={{ transform: showDone ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /> Done <span>{done.length}</span>
            </h2>
            {showDone && done.slice(0, 100).map(t => <Row key={`${t.noteId}:${t.index}`} t={t} />)}
          </section>
        )}
      </div>
      {layout === 'board' && tasks && ws && <BoardView tasks={shown} groupBy={boardGroup} sort={sort} onChanged={load} workspace={ws} />}
    </div>
  );
}
