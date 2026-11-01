// Side-panel calendar: a month view with meetings from connected calendars, daily notes,
// and the selected day's events (each can become a meeting note, a to-do, or a line in the daily note).
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarPlus, MapPin, Video, NotebookPen, RefreshCw, CloudOff } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import api from '../../api';
import { monthEvents, eventDays, dayKey, timeRange } from '../../offline/calendar';
import { openDailyNote } from '../../offline/dailyNotes';
import EventActions from './EventActions';

// First day of the week from the browser's locale (Sunday in the US, Monday in most places).
function firstDayOfWeek() {
  try {
    const info = new Intl.Locale(navigator.language).getWeekInfo?.() || new Intl.Locale(navigator.language).weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch {}
  return navigator.language === 'en-US' ? 0 : 1;
}
const WEEK_START = firstDayOfWeek();

export default function CalendarPanel() {
  const notes = useStore(s => s.notes);
  // The selected day lives in the store, so it survives switching notes (which re-mounts this panel).
  const storedDay = useStore(s => s.calendarDay);
  const setSelected = useStore(s => s.setCalendarDay);
  const selected = storedDay || new Date();
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [data, setData] = useState({ events: [], cached: false, loading: true, error: null });
  const [hasCalendars, setHasCalendars] = useState(null); // null = unknown (e.g. offline)
  useEffect(() => { api.get('/calendars').then(({ data }) => setHasCalendars(data.calendars.length > 0)).catch(() => {}); }, []);

  const load = async (m = month) => {
    setData(d => ({ ...d, loading: true }));
    try {
      const r = await monthEvents(m);
      setData({ ...r, loading: false, error: null });
    } catch (err) {
      setData({ events: [], cached: false, loading: false, error: err.response?.data?.error || 'Couldn’t load events' });
    }
  };
  useEffect(() => { load(month); }, [month.getFullYear(), month.getMonth()]);
  // Refresh when the window regains focus (meetings change during the day).
  useEffect(() => {
    const onFocus = () => load(month);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [month]);

  // Events by local day
  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of data.events) for (const k of eventDays(e)) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return map;
  }, [data.events]);

  const dailyNoteDays = useMemo(() => new Set(notes.map(n => n.title).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))), [notes]);

  // 6-week grid
  const cells = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() - WEEK_START + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((WEEK_START + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));

  const todayKey = dayKey(new Date());
  const selKey = dayKey(selected);
  const dayEvents = (byDay.get(selKey) || []).slice().sort((a, b) => (b.all_day - a.all_day) || a.start.localeCompare(b.start));
  const noCalendars = hasCalendars === false;

  const shiftMonth = n => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const goToday = () => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(d); };

  return (
    <div>
      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8 }}>
        <span style={{ flex: 1, font: '600 14px var(--font-display)', color: 'var(--text-primary)' }}>
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        {data.cached && <CloudOff size={13} title="Offline: showing saved events" style={{ color: 'var(--warning)', marginRight: 4 }} />}
        <button className="btn-ghost" style={mini} onClick={() => shiftMonth(-1)} title="Previous month"><ChevronLeft size={15} /></button>
        <button className="btn-ghost" style={{ ...mini, padding: '0 6px', fontSize: 11.5 }} onClick={goToday}>Today</button>
        <button className="btn-ghost" style={mini} onClick={() => shiftMonth(1)} title="Next month"><ChevronRight size={15} /></button>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {weekdays.map((w, i) => <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', padding: '2px 0 4px' }}>{w}</div>)}
        {cells.map(d => {
          const k = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const evs = byDay.get(k) || [];
          const colors = [...new Set(evs.map(e => e.color))].slice(0, 3);
          const isSel = k === selKey, isToday = k === todayKey, hasNote = dailyNoteDays.has(k);
          return (
            <button key={k} onClick={() => setSelected(d)} onDoubleClick={() => openDailyNote(d, byDay.get(k) || [])}
              title={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${evs.length ? ` · ${evs.length} event${evs.length > 1 ? 's' : ''}` : ''}${hasNote ? ' · daily note' : ''}\nDouble-click to open the daily note`}
              className={`cal-day${isSel ? ' sel' : ''}${isToday ? ' today' : ''}${hasNote ? ' has-note' : ''}`}
              style={{ opacity: inMonth ? 1 : 0.38 }}>
              <span>{d.getDate()}</span>
              <span style={{ display: 'flex', gap: 2, height: 4, justifyContent: 'center' }}>
                {colors.map(c => <i key={c} style={{ width: 4, height: 4, borderRadius: '50%', background: c }} />)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected day */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '16px 0 8px' }}>
        <span className="section-label" style={{ flex: 1 }}>
          {selKey === todayKey ? 'Today' : selected.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        </span>
        {data.loading && <RefreshCw size={12} className="spin" style={{ color: 'var(--text-muted)' }} />}
      </div>
      <button className="nav-item" style={{ marginBottom: 6, background: 'var(--accent-subtle)', color: 'var(--text-primary)' }}
        onClick={() => openDailyNote(selected, dayEvents)}>
        <NotebookPen size={14} style={{ color: 'var(--accent)' }} />
        {dailyNoteDays.has(selKey) ? 'Open daily note' : 'Start daily note'}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{selKey}</span>
      </button>

      {data.error && <p style={muted}>{data.error}</p>}
      {noCalendars && (
        <div style={{ ...muted, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <span>See your meetings here by connecting Outlook, Google, iCloud or any calendar.</span>
          <button className="btn-ghost on" style={{ padding: '0 10px' }} onClick={() => useStore.getState().setSettingsOpen('calendars')}>
            <CalendarPlus size={14} /> Connect a calendar
          </button>
        </div>
      )}
      {!noCalendars && !data.error && dayEvents.length === 0 && !data.loading && <p style={muted}>Nothing scheduled.</p>}

      {dayEvents.map(e => (
        <div key={e.id + selKey} className="cal-event" style={{ borderLeftColor: e.color }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeRange(e)}</span>
            <span style={{ flex: 1 }} />
            <EventActions event={e} date={selected} dayEvents={dayEvents} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>{e.title}</div>
          {e.location && !/^microsoft teams meeting$/i.test(e.location) && (
            <div style={meta}><MapPin size={11} /> {e.location}</div>
          )}
          {e.join_url && (
            <a href={e.join_url} target="_blank" rel="noreferrer noopener" style={{ ...meta, color: 'var(--accent-hover)', textDecoration: 'none' }}>
              <Video size={11} /> Join meeting
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

const mini = { height: 26, minWidth: 26, padding: 0 };
const muted = { fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 };
const meta = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 };
