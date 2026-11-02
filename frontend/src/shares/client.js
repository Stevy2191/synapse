// Shared notes: notes shared with me, who is editing what (one person at a time), live updates,
// saving a note someone shared with me, and version history.
//
// Notes I own stay offline-first (offline/sync.js). Notes shared *with* me are opened from the
// server and saved straight back to it, so they need a connection.
import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import { storeServerNote } from '../offline/sync';

export const useShares = create(() => ({
  loaded: false,
  withMe: [],             // [{ id, title, permission, include_children, owner, children: [...] }]
  sharedByMe: new Set(),  // ids of my notes I've shared directly
  locks: {},              // noteId → { user_id, since } (who is editing)
}));
const set = useShares.setState;
const get = useShares.getState;
const me = () => useStore.getState().user?.id;

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || (err?.response ? fallback : 'You’re offline — shared notes need a connection');

export async function loadShares() {
  try {
    const { data } = await api.get('/shares/with-me');
    set({ loaded: true, withMe: data.items, sharedByMe: new Set(data.shared_by_me) });
  } catch { set({ loaded: true }); }
}

// ───────────────────────── live events (arrive on the chat stream) ─────────────────────────

export function handleShareEvent(type, data) {
  if (type === 'share:changed') {
    loadShares();
    const active = useStore.getState().activeNote;
    if (data.removed && active?.shared?.guest && isInside(active.note.id, data.note_id)) {
      useStore.getState().setActiveNote(null);
      toast('That note is no longer shared with you', { icon: '🔒' });
    } else if (active?.shared?.guest) {
      // Permission may have changed (view ↔ edit): refresh the open note's access.
      api.get(`/shares/notes/${active.note.id}`).then(({ data: d }) => {
        const cur = useStore.getState().activeNote;
        if (cur?.note?.id === active.note.id && cur.shared?.role !== d.role) {
          useStore.getState().setActiveNote({ ...cur, shared: { ...cur.shared, role: d.role } });
          toast(d.role === 'edit' ? 'You can now edit this note' : 'This note is now view-only for you', { icon: d.role === 'edit' ? '✏️' : '👁' });
        }
      }).catch(() => {});
    }
    return true;
  }
  if (type === 'note:lock') {
    set(s => {
      const locks = { ...s.locks };
      if (data.user_id) locks[data.note_id] = { user_id: data.user_id, since: data.since };
      else delete locks[data.note_id];
      return { locks };
    });
    return true;
  }
  if (type === 'note:update') {
    onRemoteUpdate(data.note, data.updated_by);
    return true;
  }
  return false;
}

function isInside(noteId, rootId) {
  if (noteId === rootId) return true;
  const root = get().withMe.find(r => r.id === rootId);
  return !!root?.children?.some(c => c.id === noteId);
}

/** Someone else saved a shared note: show the change if it's open (and I'm not the one editing). */
async function onRemoteUpdate(note, updatedBy) {
  const store = useStore.getState();
  const active = store.activeNote;
  const lock = get().locks[note.id];
  const iAmEditing = lock?.user_id === me();
  if (active?.shared?.guest) {
    if (active.note.id === note.id && !iAmEditing && updatedBy !== me()) {
      store.setActiveNote({ ...active, note: { ...active.note, ...note }, loadedAt: Date.now() });
    }
    // keep titles fresh in "Shared with me"
    set(s => ({ withMe: s.withMe.map(r => (r.id === note.id ? { ...r, title: note.title } : { ...r, children: r.children.map(c => (c.id === note.id ? { ...c, title: note.title } : c)) })) }));
    return;
  }
  if (iAmEditing) return; // my own save, echoed back (or I'm mid-edit: mine wins)
  // Notes in a shared workspace: the regular sync picks the change up (and live notes merge on their own).
  const ws = store.workspaces.find(w => w.id === note.workspace_id);
  if (ws && (ws.members > 0 || (ws.role && ws.role !== 'owner'))) return;
  // A note I own, edited by someone I shared it with: update my copy (and the editor, if open).
  await storeServerNote(note, { reopen: active?.note?.id === note.id });
}

// ───────────────────────── sharing ─────────────────────────

export const getNoteShares = noteId => api.get(`/shares/note/${noteId}`).then(r => r.data);

export async function shareNote(noteId, userId, permission, includeChildren = true) {
  await api.put(`/shares/note/${noteId}`, { user_id: userId, permission, include_children: includeChildren });
  set(s => ({ sharedByMe: new Set([...s.sharedByMe, noteId]) }));
}

export async function unshareNote(noteId, userId) {
  await api.delete(`/shares/note/${noteId}/${userId}`);
}

// ───────────────────────── opening & saving a note shared with me ─────────────────────────

export async function openSharedNote(id) {
  try {
    const { data } = await api.get(`/shares/notes/${id}`);
    if (data.lock) set(s => ({ locks: { ...s.locks, [id]: data.lock } }));
    useStore.getState().setActiveNote({
      note: data.note,
      links: [],
      attachments: [],
      loadedAt: Date.now(),
      shared: { guest: true, role: data.role, owner: data.owner, updated_by: data.updated_by, people: data.people },
    });
    useStore.getState().setView('editor');
    return true;
  } catch (err) {
    toast.error(errorText(err, 'Could not open the shared note'));
    loadShares();
    return false;
  }
}

/** Save a note shared with me. Returns the server's copy, or null (with a message shown). */
export async function saveSharedNote(id, fields, baseVersion) {
  try {
    const { data } = await api.patch(`/notes/${id}`, { ...fields, base_version: baseVersion, op_id: crypto.randomUUID?.() || String(Math.random()) });
    return data.note;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 423 || status === 409) {
      toast.error(err.response.data.error);
      const active = useStore.getState().activeNote;
      if (status === 409 && active?.note?.id === id && err.response.data.note) {
        useStore.getState().setActiveNote({ ...active, note: { ...active.note, ...err.response.data.note }, loadedAt: Date.now() });
      }
    } else toast.error(errorText(err, 'Could not save'));
    return null;
  }
}

// ───────────────────────── editing turns ─────────────────────────

export async function takeTurn(noteId, { force = false } = {}) {
  try {
    const { data } = await api.post(`/shares/notes/${noteId}/lock`, { force });
    set(s => ({ locks: { ...s.locks, [noteId]: data.lock } }));
    return { ok: true, note: data.note };
  } catch (err) {
    const lock = err?.response?.data?.lock;
    if (lock) set(s => ({ locks: { ...s.locks, [noteId]: lock } }));
    return { ok: false, error: errorText(err), status: err?.response?.status };
  }
}

export function releaseTurn(noteId) {
  const lock = get().locks[noteId];
  if (lock?.user_id !== me()) return;
  set(s => { const locks = { ...s.locks }; delete locks[noteId]; return { locks }; });
  api.delete(`/shares/notes/${noteId}/lock`).catch(() => {});
}

// ───────────────────────── history ─────────────────────────

export const listVersions = noteId => api.get(`/shares/notes/${noteId}/versions`).then(r => r.data);
export const getVersion = (noteId, vid) => api.get(`/shares/notes/${noteId}/versions/${vid}`).then(r => r.data);
