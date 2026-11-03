// Home: an overview of every workspace — today's meetings, to-dos, pinned and recent notes, the
// inbox and each workspace at a glance. Every item shows which workspace it's in (its icon, name
// and colour); the chips at the top narrow everything to one workspace. Boxes can be hidden and
// reordered ("Customize"), saved per person (home/home.js).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilePlus, CalendarDays, Search, Import, Settings2, Pin, PinOff, CheckCircle2, ChevronUp, ChevronDown, Eye, EyeOff,
  Clock, Bell, FileText, Users, ArrowRight, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { useStore } from '../../stores/useStore';
import { WorkspaceIcon } from '../Avatar';
import SidebarButton from '../sidebar/SidebarButton';
import { useHome, WIDGETS, allNotes, datedTasks, openAnywhere, togglePin } from '../../home/home';
import { updateTask, isoDay } from '../../offline/tasks';
import { fmtDue, PRI_SIGN } from '../../offline/taskWhen';
import { monthEvents, eventDays, dayKey, timeRange } from '../../offline/calendar';
import { openDailyNote, openMeetingNote } from '../../offline/dailyNotes';
import { isTeamWorkspace } from '../../team/team';
import { kindInfo } from '../noteKinds';

const ago = s => {
  const d = Date.now() / 1000 - s;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)} d ago`;
  return new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

/** Which workspace something is in: its icon, name and colour, always the same way. */
export function WsChip({ ws, small }) {
  if (!ws) return null;
  return (
    <span className={`ws-chip${small ? ' small' : ''}`} style={{ '--ws': ws.color || 'var(--accent)' }} title={`In the workspace “${ws.name}”`}>
      <WorkspaceIcon workspace={ws} size={small ? 13 : 15} /> {ws.name}
    </span>
  );
}

export default function HomeView() {
  const { user, workspaces, notesTree, setSearchOpen } = useStore(s => ({ user: s.user, workspaces: s.workspaces, notesTree: s.notes, setSearchOpen: s.setSearchOpen }));
  const prefs = useHome(s => s.prefs);
  const [filter, setFilter] = useState(null);        // workspace id, or null = all
  const [notes, setNotes] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [events, setEvents] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [customize, setCustomize] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => { useHome.getState().load(); }, []);
  useEffect(() => {
    let gone = false;
    allNotes().then(n => !gone && setNotes(n));
    datedTasks().then(t => !gone && setTasks(t));
    return () => { gone = true; };
  }, [workspaces, notesTree, tick]);
  useEffect(() => {
    const today = new Date();
    monthEvents(today).then(({ events: ev }) => setEvents((ev || []).filter(e => eventDays(e).includes(dayKey(today)))
      .sort((a, b) => (a.all_day ? -1 : b.all_day ? 1 : new Date(a.start) - new Date(b.start))))).catch(() => setEvents([]));
    api.get('/team/inbox').then(({ data }) => setInbox(data.items)).catch(() => setInbox(false));
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tick]);

  const wsById = useMemo(() => new Map(workspaces.map(w => [w.id, w])), [workspaces]);
  const inScope = item => !filter || (item.ws?.id || item.workspace_id) === filter;
  const shown = prefs.order.filter(w => !prefs.hidden.includes(w) && WIDGETS[w]);

  const boxes = {
    today: <TodayBox events={events} />,
    tasks: <TasksBox tasks={(tasks || []).filter(inScope)} loading={!tasks} onChanged={refresh} />,
    pinned: <PinnedBox notes={(notes || []).filter(n => prefs.pinned.includes(n.id) && inScope(n))} order={prefs.pinned} loading={!notes} />,
    recent: <RecentBox notes={(notes || []).filter(inScope)} loading={!notes} pinned={prefs.pinned} />,
    inbox: <InboxBox items={inbox === false ? false : (inbox || []).filter(i => !i.read_at && (!filter || i.workspace_id === filter))} wsById={wsById} loading={inbox === null} />,
    workspaces: <WorkspacesBox workspaces={workspaces} notes={notes} tasks={tasks} filter={filter} setFilter={setFilter} />,
  };

  return (
    <div className="home-view">
      <div className="home-top"><SidebarButton /></div>
      <div className="home-inner">
        <header className="home-head">
          <div>
            <h1>{greeting()}{user?.display_name || user?.username ? `, ${(user.display_name || user.username).split(' ')[0]}` : ''}</h1>
            <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div className="home-quick">
            <button type="button" onClick={() => useStore.setState({ newNoteRequest: true, ...(useStore.getState().sidebarOpen ? {} : { sidebarOpen: true }) })}><FilePlus size={15} /> New note</button>
            <button type="button" onClick={async () => { const t = new Date(); await openDailyNote(t, (events || []).filter(e => eventDays(e).includes(dayKey(t)))); useStore.getState().setView('editor'); }}><CalendarDays size={15} /> Daily note</button>
            <button type="button" onClick={() => setSearchOpen(true)}><Search size={15} /> Search</button>
            <button type="button" onClick={() => useStore.setState({ importOpen: true })}><Import size={15} /> Import</button>
            <button type="button" className={customize ? 'on' : ''} onClick={() => setCustomize(c => !c)} title="Choose and arrange the boxes"><Settings2 size={15} /> Customize</button>
          </div>
        </header>

        {workspaces.length > 1 && (
          <div className="home-filter" role="tablist" aria-label="Show workspace">
            <button type="button" className={`home-fchip${!filter ? ' on' : ''}`} onClick={() => setFilter(null)}>All workspaces</button>
            {workspaces.map(w => (
              <button key={w.id} type="button" className={`home-fchip${filter === w.id ? ' on' : ''}`} style={{ '--ws': w.color || 'var(--accent)' }} onClick={() => setFilter(f => (f === w.id ? null : w.id))}>
                <WorkspaceIcon workspace={w} size={14} /> {w.name}{isTeamWorkspace(w) && <Users size={11} style={{ opacity: 0.7 }} />}
              </button>
            ))}
          </div>
        )}

        {customize && <Customize prefs={prefs} onClose={() => setCustomize(false)} />}

        {/* Two columns that fill independently (no gaps under short boxes); "Workspaces" spans both. */}
        {chunks(shown).map((part, i) => (part === 'workspaces'
          ? <section key="ws" className="home-box home-workspaces home-wide">{boxes.workspaces}</section>
          : (
            <div key={i} className="home-cols">
              {[0, 1].map(col => (
                <div key={col} className="home-col">
                  {part.filter((_, k) => k % 2 === col).map(w => <section key={w} className={`home-box home-${w}`}>{boxes[w]}</section>)}
                </div>
              ))}
            </div>
          )))}
        {!shown.length && <p className="home-empty">All boxes are hidden — choose some under <b>Customize</b>.</p>}
      </div>
    </div>
  );
}

/** Split the boxes into runs around the full-width "Workspaces" box. */
function chunks(list) {
  const out = [];
  let run = [];
  for (const w of list) {
    if (w === 'workspaces') { if (run.length) out.push(run); out.push('workspaces'); run = []; } else run.push(w);
  }
  if (run.length) out.push(run);
  return out;
}

function BoxHead({ icon: Icon, title, count, action }) {
  return (
    <div className="home-box-head">
      <Icon size={15} /> <h2>{title}</h2>{count != null && count > 0 && <span className="home-count">{count}</span>}
      <span style={{ flex: 1 }} />{action}
    </div>
  );
}
const Loading = () => <p className="home-muted">Loading…</p>;

function TodayBox({ events }) {
  return (
    <>
      <BoxHead icon={CalendarDays} title="Today’s meetings" count={events?.length} />
      {!events ? <Loading /> : !events.length ? <p className="home-muted">Nothing on your calendars today.</p> : (
        <ul className="home-list">
          {events.slice(0, 8).map(e => (
            <li key={e.id || `${e.title}${e.start}`}>
              <button type="button" className="home-row" title="Open (or make) the meeting note" onClick={async () => { await openMeetingNote(e, new Date(), events); useStore.getState().setView('editor'); }}>
                <span className="home-time">{timeRange(e)}</span>
                <span className="home-row-title">{e.title || 'Busy'}</span>
                {e.calendar_name && <span className="home-tag" style={{ '--ws': e.color || 'var(--text-muted)' }}>{e.calendar_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {events?.length > 0 && <p className="home-foot">From your calendars · click a meeting to open its notes (made in the workspace that’s open)</p>}
    </>
  );
}

function TasksBox({ tasks, loading, onChanged }) {
  const today = isoDay();
  const week = isoDay(new Date(Date.now() + 7 * 86400000));
  const groups = [
    ['Overdue', tasks.filter(t => t.due < today), 'overdue'],
    ['Today', tasks.filter(t => t.due === today), 'today'],
    ['Next 7 days', tasks.filter(t => t.due > today && t.due <= week), 'soon'],
  ];
  const later = tasks.filter(t => t.due > week).length;
  const tickIt = async t => {
    try {
      const r = await updateTask(t.ws.id, t, { done: true });
      toast.success(r?.next ? `Done — next one on ${fmtDue(r.next)}` : 'Done');
      onChanged();
    } catch (err) { toast.error(err.message); }
  };
  const total = groups.reduce((n, g) => n + g[1].length, 0);
  return (
    <>
      <BoxHead icon={CheckCircle2} title="To-dos" count={total}
        action={<button type="button" className="home-link" onClick={() => useStore.getState().setView('tasks')}>All tasks <ArrowRight size={12} /></button>} />
      {loading ? <Loading /> : !total ? <p className="home-muted">Nothing due in the next 7 days{later ? ` (${later} later)` : ''}. 🎉</p> : groups.map(([label, list, cls]) => list.length > 0 && (
        <div key={label} className="home-tgroup">
          <div className={`home-tlabel ${cls}`}>{label} · {list.length}</div>
          <ul className="home-list">
            {list.sort((a, b) => a.due.localeCompare(b.due) || (a.time || '').localeCompare(b.time || '')).slice(0, 8).map(t => (
              <li key={`${t.ws.id}:${t.noteId}:${t.index}`} className="home-task">
                <input type="checkbox" aria-label="Mark as done" onChange={() => tickIt(t)} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="home-task-text">{t.priority && <span>{PRI_SIGN[t.priority]} </span>}{t.text}</div>
                  <div className="home-meta">
                    <span className={cls === 'overdue' ? 'home-late' : ''}>📅 {fmtDue(t.due)}{t.time ? ` ${t.time}` : ''}{t.repeat ? ' 🔁' : ''}</span>
                    <button type="button" className="home-notelink" onClick={() => openAnywhere(t.noteId, t.ws.id)}>{t.noteTitle}</button>
                    <WsChip ws={t.ws} small />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {list.length > 8 && <p className="home-muted">and {list.length - 8} more…</p>}
        </div>
      ))}
    </>
  );
}

function NoteRow({ n, pinned }) {
  const Icon = kindInfo(n).icon || FileText;
  return (
    <li className="home-note">
      <button type="button" className="home-row" onClick={() => openAnywhere(n.id, n.ws.id)}>
        <Icon size={14} className="home-note-icon" />
        <span className="home-row-title">{n.title || 'Untitled'}</span>
        <span className="home-meta-inline">{ago(n.updated_at)}</span>
        <WsChip ws={n.ws} small />
      </button>
      <button type="button" className="home-pin" title={pinned ? 'Unpin from Home' : 'Pin to Home'} onClick={() => togglePin(n.id)}>{pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
    </li>
  );
}

function PinnedBox({ notes, order, loading }) {
  const sorted = [...notes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return (
    <>
      <BoxHead icon={Pin} title="Pinned notes" count={sorted.length} />
      {loading ? <Loading /> : !sorted.length ? <p className="home-muted">Pin notes you use often — hover a note in “Recently edited” (or in the sidebar) and click the pin.</p> : (
        <ul className="home-list">{sorted.map(n => <NoteRow key={n.id} n={n} pinned />)}</ul>
      )}
    </>
  );
}

function RecentBox({ notes, loading, pinned }) {
  const recent = [...notes].filter(n => !/^Templates$/i.test(n.title)).sort((a, b) => b.updated_at - a.updated_at).slice(0, 10);
  return (
    <>
      <BoxHead icon={Clock} title="Recently edited" />
      {loading ? <Loading /> : !recent.length ? <p className="home-muted">No notes yet.</p> : (
        <ul className="home-list">{recent.map(n => <NoteRow key={n.id} n={n} pinned={pinned.includes(n.id)} />)}</ul>
      )}
    </>
  );
}

function InboxBox({ items, wsById, loading }) {
  return (
    <>
      <BoxHead icon={Bell} title="Inbox" count={items ? items.length : null}
        action={<button type="button" className="home-link" onClick={() => useStore.getState().setView('inbox')}>Open inbox <ArrowRight size={12} /></button>} />
      {loading ? <Loading /> : items === false ? <p className="home-muted">The inbox needs a connection to the server.</p> : !items.length ? <p className="home-muted">Nothing new.</p> : (
        <ul className="home-list">
          {items.slice(0, 6).map(i => (
            <li key={i.id}>
              <button type="button" className="home-row home-inbox-row" onClick={() => { api.post('/team/inbox/read', { ids: [i.id] }).catch(() => {}); openAnywhere(i.note_deleted ? null : i.note_id, i.workspace_id); }}>
                <span className="home-row-title">{i.title}</span>
                <span className="home-meta-inline">{ago(i.created_at)}</span>
                <WsChip ws={wsById.get(i.workspace_id)} small />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WorkspacesBox({ workspaces, notes, tasks, filter, setFilter }) {
  const today = isoDay();
  return (
    <>
      <BoxHead icon={Users} title="Workspaces" count={workspaces.length} />
      <div className="home-ws-grid">
        {workspaces.map(w => {
          const mine = (notes || []).filter(n => n.ws.id === w.id);
          const last = mine.reduce((m, n) => Math.max(m, n.updated_at || 0), 0);
          const t = (tasks || []).filter(x => x.ws.id === w.id);
          const late = t.filter(x => x.due < today).length;
          return (
            <div key={w.id} className={`home-ws${filter === w.id ? ' on' : ''}`} style={{ '--ws': w.color || 'var(--accent)' }}>
              <button type="button" className="home-ws-main" onClick={() => openAnywhere(null, w.id)} title={`Open the workspace “${w.name}”`}>
                <WorkspaceIcon workspace={w} size={26} />
                <span className="home-ws-name">{w.name}<small>{isTeamWorkspace(w) ? (w.role && w.role !== 'owner' ? `Shared with you · ${w.role === 'view' ? 'can view' : 'can edit'}` : `Shared · ${w.members} ${w.members === 1 ? 'person' : 'people'}`) : 'Only you'}</small></span>
              </button>
              <div className="home-ws-stats">
                <span><b>{notes ? mine.length : '–'}</b> notes</span>
                <span><b>{tasks ? t.length : '–'}</b> to-dos{late ? <em> · {late} late</em> : ''}</span>
                <span>{last ? `edited ${ago(last)}` : 'no edits yet'}</span>
              </div>
              <button type="button" className="home-ws-filter" onClick={() => setFilter(f => (f === w.id ? null : w.id))}>{filter === w.id ? 'Show all' : 'Show only this'}</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Customize({ prefs, onClose }) {
  const save = useHome(s => s.save);
  const move = (w, d) => {
    const order = [...prefs.order];
    const i = order.indexOf(w), j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    save({ order });
  };
  const toggle = w => save({ hidden: prefs.hidden.includes(w) ? prefs.hidden.filter(x => x !== w) : [...prefs.hidden, w] });
  return (
    <div className="home-customize">
      <div className="home-box-head"><Settings2 size={15} /> <h2>Customize Home</h2><span style={{ flex: 1 }} /><button type="button" className="home-pin" onClick={onClose} title="Done"><X size={15} /></button></div>
      <ul className="home-clist">
        {prefs.order.filter(w => WIDGETS[w]).map((w, i) => (
          <li key={w} className={prefs.hidden.includes(w) ? 'off' : ''}>
            <button type="button" className="home-pin" onClick={() => toggle(w)} title={prefs.hidden.includes(w) ? 'Show' : 'Hide'}>{prefs.hidden.includes(w) ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <span><b>{WIDGETS[w].title}</b><small>{WIDGETS[w].desc}</small></span>
            <button type="button" className="home-pin" disabled={i === 0} onClick={() => move(w, -1)} title="Move up"><ChevronUp size={14} /></button>
            <button type="button" className="home-pin" disabled={i === prefs.order.length - 1} onClick={() => move(w, 1)} title="Move down"><ChevronDown size={14} /></button>
          </li>
        ))}
      </ul>
      <label className="home-start"><input type="checkbox" checked={prefs.start_home} onChange={e => save({ start_home: e.target.checked })} /> Open Home when Synapse starts</label>
      <p className="home-foot">Saved to your account, so every device shows the same Home.</p>
    </div>
  );
}
