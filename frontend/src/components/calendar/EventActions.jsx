// The "+" menu on a calendar event: meeting note, a to-do, or a line in the daily note.
import { useEffect, useRef, useState } from 'react';
import { Plus, FileText, ListTodo, NotebookPen, Link2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { openMeetingNote, addMeetingTask, addMeetingToDailyNote, meetingTitle } from '../../offline/dailyNotes';
import { dayKey } from '../../offline/calendar';

export default function EventActions({ event, date, dayEvents }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('menu'); // 'menu' | 'todo'
  const [text, setText] = useState('');
  const [due, setDue] = useState(dayKey(date));
  const box = useRef(null);
  const notes = useStore(s => s.notes);
  const hasNote = notes.some(n => n.title === meetingTitle(event, date) || n.title === `${event.title} · ${dayKey(date)}`);

  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!box.current?.contains(e.target)) close(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const close = () => { setOpen(false); setMode('menu'); setText(''); setDue(dayKey(date)); };
  const run = async (fn, ok) => {
    close();
    try { await fn(); if (ok) toast.success(ok); } catch (err) { console.error(err); toast.error(err.message || 'Something went wrong'); }
  };
  const addTodo = e => {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text.trim(), d = due || null;
    run(() => addMeetingTask(event, date, dayEvents, t, d), `To-do added${d ? ` (due ${new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : ''}`);
  };

  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className={`btn-ghost${open ? ' on' : ''}`} style={{ height: 22, minWidth: 22, padding: 0 }} title="Create from this meeting…"
        aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Plus size={14} />
      </button>
      {open && (
        <div className="event-menu fade-in" role="menu">
          {mode === 'menu' ? (
            <>
              <div className="event-menu-title">{event.title}</div>
              <button role="menuitem" onClick={() => run(() => openMeetingNote(event, date, dayEvents))}>
                <FileText size={14} /> {hasNote ? 'Open meeting note' : 'Meeting note'}
                <small>{hasNote ? '' : 'Agenda, notes & action items'}</small>
              </button>
              <button role="menuitem" onClick={() => setMode('todo')}>
                <ListTodo size={14} /> Add a to-do…
                <small>Shows in Tasks, due on this day</small>
              </button>
              <button role="menuitem" onClick={() => run(() => addMeetingToDailyNote(event, date, dayEvents), 'Added to the daily note')}>
                <NotebookPen size={14} /> Add to daily note
                <small>List it in {dayKey(date)}</small>
              </button>
              {event.join_url && (
                <button role="menuitem" onClick={() => run(() => navigator.clipboard.writeText(event.join_url), 'Join link copied')}>
                  <Link2 size={14} /> Copy join link
                </button>
              )}
            </>
          ) : (
            <form onSubmit={addTodo} className="event-todo">
              <button type="button" className="event-back" onClick={() => setMode('menu')}><ArrowLeft size={13} /> {event.title}</button>
              <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What needs doing?" maxLength={300} />
              <label>
                Due
                <input type="date" value={due} onChange={e => setDue(e.target.value)} />
                {due && <button type="button" className="event-clear" onClick={() => setDue('')}>No date</button>}
              </label>
              <button type="submit" className="cp-btn primary" disabled={!text.trim()}>Add to-do</button>
              <small>Saved in the meeting note under “Action items”.</small>
            </form>
          )}
        </div>
      )}
    </span>
  );
}
