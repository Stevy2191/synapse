// Home page data: the person's layout (synced via /api/home, cached on this device so Home works
// offline) and helpers that gather notes and tasks from every workspace.
import { create } from 'zustand';
import api from '../api';
import { useStore } from '../stores/useStore';
import { getWorkspaceNotes, openNote, syncNow } from '../offline/sync';
import { listTasks } from '../offline/tasks';
import { isTeamWorkspace } from '../team/team';

export const WIDGETS = {
  today: { title: 'Today’s meetings', desc: 'Events from your connected calendars' },
  tasks: { title: 'To-dos', desc: 'Overdue, today and the next 7 days' },
  pinned: { title: 'Pinned notes', desc: 'Notes you pinned to Home' },
  recent: { title: 'Recently edited', desc: 'The notes changed most recently' },
  inbox: { title: 'Inbox', desc: 'Mentions, assigned to-dos and replies' },
  workspaces: { title: 'Workspaces', desc: 'Each workspace at a glance' },
};
const DEFAULT = { order: Object.keys(WIDGETS), hidden: [], pinned: [], start_home: true };
const KEY = 'synapse.home';
const cached = () => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT; } };

export const useHome = create((set, get) => ({
  prefs: cached(),
  async load() {
    try {
      const { data } = await api.get('/home');
      try { localStorage.setItem(KEY, JSON.stringify(data.prefs)); } catch { /* private mode */ }
      set({ prefs: data.prefs });
    } catch { /* offline: keep the cached copy */ }
    return get().prefs;
  },
  async save(change) {
    const prefs = { ...get().prefs, ...change };
    set({ prefs });
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
    try { const { data } = await api.put('/home', change); set({ prefs: data.prefs }); } catch { /* sent next time */ }
  },
}));

export const isPinned = id => useHome.getState().prefs.pinned.includes(id);
export function togglePin(id) {
  const { pinned } = useHome.getState().prefs;
  return useHome.getState().save({ pinned: pinned.includes(id) ? pinned.filter(x => x !== id) : [id, ...pinned] });
}

/** Every note in every workspace, each with its workspace. */
export async function allNotes() {
  const out = [];
  for (const ws of useStore.getState().workspaces) {
    for (const n of await getWorkspaceNotes(ws.id)) out.push({ ...n, ws });
  }
  return out;
}

/**
 * Open to-dos with a date, from every workspace — like reminders: in your own workspaces the ones not
 * assigned to someone else, in shared ones only those assigned to you.
 */
export async function datedTasks() {
  const me = useStore.getState().user?.username?.toLowerCase();
  const out = [];
  for (const ws of useStore.getState().workspaces) {
    const shared = isTeamWorkspace(ws);
    for (const t of await listTasks(ws.id)) {
      if (t.done || !t.due) continue;
      const a = t.assignee?.toLowerCase();
      if (shared ? a !== me : a && a !== me) continue;
      out.push({ ...t, ws });
    }
  }
  return out;
}

/** Open a note from any workspace (switching to it first). */
export async function openAnywhere(noteId, workspaceId) {
  const store = useStore.getState();
  if (workspaceId && store.activeWorkspace?.id !== workspaceId) {
    let ws = store.workspaces.find(w => w.id === workspaceId);
    if (!ws) { await syncNow(); ws = useStore.getState().workspaces.find(w => w.id === workspaceId); }
    if (ws) await useStore.getState().setActiveWorkspace(ws);
  }
  if (noteId) await openNote(noteId);
  useStore.getState().setView('editor');
}
