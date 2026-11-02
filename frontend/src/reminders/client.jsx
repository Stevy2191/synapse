// Reminders in the app: report this device's time zone (the server sends reminders by it), open what a
// notification points at (/?open=tasks, /?note=<id>), and show reminders that arrive while the app is on screen.
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import { openNote } from '../offline/sync';

export const getReminderPrefs = () => api.get('/reminders').then(r => r.data);
export const saveReminderPrefs = body => api.patch('/reminders', body).then(r => r.data);
export const sendTestReminder = () => api.post('/reminders/test').then(r => r.data);
export const sendEmailNow = () => api.post('/reminders/email-now').then(r => r.data);

export function reportTimeZone(userId) {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const key = `synapse.tz.${userId}`;
    if (localStorage.getItem(key) === tz) return;
    api.patch('/reminders', { tz }).then(() => { try { localStorage.setItem(key, tz); } catch { /* ignore */ } }).catch(() => {});
  } catch { /* ignore */ }
}

function openTasks() { useStore.getState().setView('tasks'); }
function openTaskNote(id) { openNote(id).then(() => useStore.getState().setView('editor')).catch(() => {}); }

export function openFromReminderUrl(search) {
  const q = new URLSearchParams(search || '');
  const open = q.get('open'); const note = q.get('note'); const comment = q.get('comment');
  if (!open && !note) return;
  if (open === 'tasks') openTasks();
  if (open === 'inbox') useStore.getState().setView('inbox');
  if (note && comment) useStore.setState({ pendingComment: { noteId: note, threadId: comment } });
  if (note) openTaskNote(note);
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
}

export function showReminder(r) {
  if (!r) return;
  toast(t => (
    <div className="reminder-toast">
      <b>{r.title}</b>
      {r.body && <span>{r.body}</span>}
      <div>
        <button type="button" className="export-go" onClick={() => { toast.dismiss(t.id); if (r.noteId) openTaskNote(r.noteId); else openTasks(); }}>{r.noteId ? 'Open note' : 'Open Tasks'}</button>
        <button type="button" className="btn-ghost" onClick={() => toast.dismiss(t.id)}>Dismiss</button>
      </div>
    </div>
  ), { duration: 60_000, id: r.tag || undefined });
}
