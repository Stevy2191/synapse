// "Due date & reminder": pick a task's date, an optional reminder time, and whether it repeats.
import { useEffect, useState } from 'react';
import { Bell, Repeat, CalendarDays, Flag, User } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { isTeamWorkspace, membersNow, getMembers, personLabel } from '../../team/team';
import { Modal } from '../chat/ChatDialogs';
import { REPEAT_CHOICES, PRIORITIES, parseRepeat, isoOf } from '../../offline/taskWhen';

const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return isoOf(d); };

export default function TaskWhenDialog({ initial = {}, task, onSave, onClose }) {
  const [due, setDue] = useState(initial.due || '');
  const [time, setTime] = useState(initial.time || '');
  const [priority, setPriority] = useState(initial.priority || null);
  const [assignee, setAssignee] = useState(initial.assignee || '');
  const ws = useStore(st => st.activeWorkspace);
  const team = isTeamWorkspace(ws);
  const [people, setPeople] = useState(() => (team ? membersNow(ws.id) : []));
  useEffect(() => { if (team) getMembers(ws.id).then(setPeople); }, [ws?.id]);
  const known = REPEAT_CHOICES.some(([v]) => v === (initial.repeat || ''));
  const [repeat, setRepeat] = useState(known ? (initial.repeat || '') : 'custom');
  const [custom, setCustom] = useState(known ? '' : (initial.repeat || ''));
  const customOk = repeat !== 'custom' || !!parseRepeat(custom);
  const rep = repeat === 'custom' ? `every ${custom.replace(/^every\s+/i, '').trim()}` : repeat;
  const save = () => onSave({ due: due || (time || rep ? isoOf(new Date()) : null), time: time || null, repeat: rep || null, priority, status: initial.status || null, assignee: assignee || null });

  return (
    <Modal title={team ? "To-do details" : "Date, priority & reminder"} onClose={onClose} width={420}>
      {task && <p className="chat-dialog-hint" style={{ marginTop: 0 }}>{task}</p>}
      <label className="rec-label"><Flag size={13} /> Priority</label>
      <div className="seg pri-seg">
        <button type="button" className={!priority ? 'on' : ''} onClick={() => setPriority(null)}>None</button>
        {PRIORITIES.map(([k, l]) => <button key={k} type="button" className={`pri-${k}${priority === k ? ' on' : ''}`} onClick={() => setPriority(k)}>{l}</button>)}
      </div>
      {(team || initial.assignee) && (
        <>
          <label className="rec-label"><User size={13} /> Assigned to <small>(they get a notification and the reminders)</small></label>
          <select className="chat-field" value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: '100%', marginBottom: 4 }}>
            <option value="">Nobody</option>
            {people.map(p => <option key={p.id} value={p.username.toLowerCase()}>{personLabel(p)} (@{p.username})</option>)}
            {assignee && !people.some(p => p.username.toLowerCase() === assignee) && <option value={assignee}>@{assignee}</option>}
          </select>
        </>
      )}
      <label className="rec-label"><CalendarDays size={13} /> Due</label>
      <div className="tw-quick">
        {[['Today', plus(0)], ['Tomorrow', plus(1)], ['Next week', nextMonday()]].map(([l, v]) => (
          <button key={l} type="button" className={`btn-ghost${due === v ? ' on' : ''}`} onClick={() => setDue(v)}>{l}</button>
        ))}
        <input type="date" className="chat-field" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" />
      </div>
      <label className="rec-label"><Bell size={13} /> Remind me at <small>(optional — you also get a morning summary)</small></label>
      <div className="tw-quick">
        <input type="time" className="chat-field" value={time} onChange={e => setTime(e.target.value)} aria-label="Reminder time" />
        {time && <button type="button" className="btn-ghost" onClick={() => setTime('')}>No reminder time</button>}
      </div>
      <label className="rec-label"><Repeat size={13} /> Repeat</label>
      <select className="chat-field" value={repeat} onChange={e => setRepeat(e.target.value)} style={{ width: '100%' }}>
        {REPEAT_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {repeat === 'custom' && (
        <div className="tw-custom">
          <span>every</span>
          <input className="chat-field" autoFocus value={custom.replace(/^every\s+/i, '')} onChange={e => setCustom(e.target.value)} placeholder="monday and thursday · 10 days · 6 months" />
        </div>
      )}
      {repeat === 'custom' && custom && !customOk && <p className="chat-pop-note">Try “3 days”, “2 weeks”, “month”, “weekday”, or days like “monday and thursday”.</p>}
      {rep && <p className="chat-pop-note">Ticking it off moves it to the next date instead of finishing it.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        {(initial.due || initial.time || initial.repeat || initial.priority) && <button type="button" className="btn-ghost danger-hover" style={{ marginRight: 'auto' }} title="Remove the date, reminder, repeat and priority" onClick={() => onSave({ due: null, time: null, repeat: null, priority: null, status: initial.status || null, assignee: initial.assignee || null })}>Clear all</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="export-go" disabled={!customOk} onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
