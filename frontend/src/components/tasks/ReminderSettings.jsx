// Settings → Reminders (each person's own): morning summary, exact-time reminders, this device's notifications.
import { useEffect, useState } from 'react';
import { Bell, Send, Info, Check, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { Row, Group } from '../meetings/MeetingSettings';
import { getReminderPrefs, saveReminderPrefs, sendTestReminder, sendEmailNow } from '../../reminders/client';
import { notificationState, enableNotifications } from '../../chat/client';

const Switch = ({ on, onChange }) => (
  <button type="button" role="switch" aria-checked={on} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}><span /></button>
);
const errText = err => err?.response?.data?.error || (err?.response ? 'Something went wrong' : 'Reminders settings need a connection');

export default function ReminderSettings({ styles }) {
  const { heading, lead, field } = styles;
  const [p, setP] = useState(null);
  const [notif, setNotif] = useState(null);
  const load = () => getReminderPrefs().then(setP).catch(err => toast.error(errText(err)));
  useEffect(() => { load(); notificationState().then(setNotif); }, []);
  if (!p) return <div><h3 style={heading}>Reminders</h3><p style={lead}>Loading…</p></div>;
  const save = async body => { try { setP(await saveReminderPrefs(body)); } catch (err) { toast.error(errText(err)); } };

  const notifText = {
    on: 'On for this device.',
    off: 'Off on this device — turn them on to get reminders when Synapse isn’t open.',
    blocked: 'Blocked in this browser’s site settings — allow notifications for this site, then come back.',
    insecure: 'Notifications need Synapse to be opened at its https:// address. While Synapse is open you still see reminders on screen.',
    unsupported: /iPad|iPhone/.test(navigator.userAgent) ? 'On iPad/iPhone, add Synapse to your Home Screen (Share → Add to Home Screen) and open it from there to turn notifications on.' : 'This browser can’t show notifications.',
  }[notif] || '';

  return (
    <div className="spage">
      <h3 style={heading}>Reminders <span className="sbadge">New</span></h3>
      <p style={lead}>Get reminded about to-dos with a due date. Give a checklist item a date with <b>/due</b> or the 🔔 button in the formatting bar, or type it: <code>Pay the water bill 📅 2026-11-20 ⏰ 09:00 🔁 every month</code>.</p>

      <Group title="This device">
        <Row title="Notifications" desc={notifText}>
          {notif === 'on' ? <span className="sbadge ok"><Check size={11} /> On</span>
            : notif === 'off' ? <button type="button" className="btn-ghost" onClick={async () => { if (await enableNotifications()) { setNotif('on'); load(); } }}><Bell size={13} /> Turn on</button>
              : null}
        </Row>
        <Row title="Send a test" desc={p.devices ? `Sends a reminder to your ${p.devices} device${p.devices === 1 ? '' : 's'} with notifications on.` : 'No device has notifications on yet — the test shows on this screen only.'}>
          <button type="button" className="btn-ghost" onClick={async () => { try { await sendTestReminder(); toast.success('Test sent'); } catch (err) { toast.error(errText(err)); } }}><Send size={13} /> Test</button>
        </Row>
      </Group>

      <Group title="When to remind me">
        <Row title="Morning summary" desc="One notification a day listing what’s due today and what’s overdue. Nothing is sent on days with nothing due.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {p.summary && <input type="time" value={p.summary_time} onChange={e => e.target.value && save({ summary_time: e.target.value })} style={{ ...field, width: 120, flex: '0 0 auto' }} aria-label="Summary time" />}
            <Switch on={p.summary} onChange={v => save({ summary: v })} />
          </div>
        </Row>
        <Row title="At the task’s time" desc="A reminder at the exact time for to-dos that have one (⏰).">
          <Switch on={p.timed} onChange={v => save({ timed: v })} />
        </Row>
        <p className="srow-note"><Info size={13} /> Times are in your time zone{p.tz ? ` (${p.tz})` : ''}. Today: {p.today.due} due, {p.today.overdue} overdue{p.today.timed.length ? `; next reminder at ${p.today.timed[0].time} — “${p.today.timed[0].text}”` : ''}.</p>
      </Group>

      <Group title="Daily email">
        {!p.email.configured && <p className="srow-note"><Info size={13} /> Email isn’t set up on this server yet — an admin can do it in Settings → Server → Email.</p>}
        {p.email.configured && !p.email.address && <p className="srow-note"><Info size={13} /> Your account has no email address — add one in Settings → Profile.</p>}
        <Row title="Daily email" desc={<>Every day at this time: today’s meetings from your connected calendars, what’s due today and what’s overdue{p.email.address ? <> — sent to <b>{p.email.address}</b></> : ''}.</>}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {p.email_daily && <input type="time" value={p.email_time} onChange={e => e.target.value && save({ email_time: e.target.value })} style={{ ...field, width: 120, flex: '0 0 auto' }} aria-label="Email time" />}
            <Switch on={p.email_daily} onChange={v => save({ email_daily: v })} />
          </div>
        </Row>
        {p.email_daily && (
          <Row title="Skip quiet days" desc="Don’t send it on days with no meetings and nothing due.">
            <Switch on={p.email_skip_empty} onChange={v => save({ email_skip_empty: v })} />
          </Row>
        )}
        <Row title="Send today’s email now" desc="See what it looks like.">
          <button type="button" className="btn-ghost" disabled={!p.email.configured || !p.email.address} onClick={async () => { try { const r = await sendEmailNow(); toast.success(`Sent to ${r.to}`); } catch (err) { toast.error(errText(err), { duration: 9000 }); } }}><Mail size={13} /> Send</button>
        </Row>
      </Group>

      <Group title="Repeating to-dos">
        <p className="srow-note">Add <code>🔁 every week</code> (or pick Repeat in the due-date window) and ticking the to-do moves it to its next date instead of finishing it. Works with “every day”, “every weekday”, “every 2 weeks”, “every month”, “every year”, “every monday and thursday”…</p>
      </Group>
    </div>
  );
}
