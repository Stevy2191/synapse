// Shared workspaces (team features), on the device: who's in a workspace (cached so it works offline),
// add/change/remove people, and the live events that keep everyone's app up to date.
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import { syncNow, openNote } from '../offline/sync';

/** Is this workspace shared (has members, or isn't mine)? */
export const isTeamWorkspace = ws => !!ws && (ws.role && ws.role !== 'owner' || (ws.members || 0) > 0);
export const myRole = ws => ws?.role || 'owner';
export const canEdit = ws => myRole(ws) !== 'view';

const cache = new Map();
const key = wsId => `synapse.members.${wsId}`;
/** People in a workspace [{ id, username, display_name, avatar, role }], from the server (cached for offline). */
export async function getMembers(wsId, { fresh = false } = {}) {
  if (!wsId) return [];
  if (!fresh && cache.has(wsId)) return cache.get(wsId);
  try {
    const { data } = await api.get(`/workspaces/${wsId}/members`);
    cache.set(wsId, data.members);
    try { localStorage.setItem(key(wsId), JSON.stringify(data.members)); } catch { /* ignore */ }
    return data.members;
  } catch {
    try { const saved = JSON.parse(localStorage.getItem(key(wsId)) || 'null'); if (saved) { cache.set(wsId, saved); return saved; } } catch { /* ignore */ }
    return [];
  }
}
export const membersNow = wsId => cache.get(wsId) || (() => { try { return JSON.parse(localStorage.getItem(key(wsId)) || '[]'); } catch { return []; } })();
export const personLabel = p => p?.display_name || p?.username || 'Someone';

export async function addMember(wsId, userId, role) { const { data } = await api.post(`/workspaces/${wsId}/members`, { user_id: userId, role }); cache.set(wsId, data.members); await syncNow(); return data.members; }
export async function setMemberRole(wsId, userId, role) { const { data } = await api.patch(`/workspaces/${wsId}/members/${userId}`, { role }); cache.set(wsId, data.members); return data.members; }
export async function removeMember(wsId, userId) { const { data } = await api.delete(`/workspaces/${wsId}/members/${userId}`); cache.set(wsId, data.members); await syncNow(); return data.members; }

/** Live events from the server (they arrive on the chat stream). Returns true if handled. */
export function handleTeamEvent(type, data) {
  if (type === 'ws:changed') { syncNow(); return true; }
  if (type === 'workspaces:changed') {
    cache.delete(data.workspace_id);
    if (data.added) toast.success(`${data.by} added you to the workspace “${data.name}” — find it in the workspace menu`, { duration: 8000 });
    syncNow();
    return true;
  }
  if (type === 'members:changed') {
    cache.delete(data.workspace_id);
    getMembers(data.workspace_id, { fresh: true }).then(() => window.dispatchEvent(new CustomEvent('synapse:members', { detail: data })));
    syncNow();
    return true;
  }
  if (type === 'mention') {
    toast(t => (
      <span className="reminder-toast">
        <b>{data.title}</b>
        {data.body && <span>{data.body}</span>}
        <span style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" className="export-go" onClick={() => { toast.dismiss(t.id); openNote(data.note_id).then(() => useStore.getState().setView('editor')).catch(() => {}); }}>Open note</button>
          <button type="button" className="btn-ghost" onClick={() => toast.dismiss(t.id)}>Dismiss</button>
        </span>
      </span>
    ), { duration: 30_000, icon: data.kind === 'assign' ? '👤' : '💬' });
    return true;
  }
  return false;
}

// Keep the open workspace's member list ready (for @mentions and "Assigned to"), also for offline use.
let lastWs = null;
let unsub = null;
export function startTeam() {
  if (unsub) return;
  const check = st => {
    const ws = st.activeWorkspace;
    if (!ws || ws.id === lastWs) return;
    lastWs = ws.id;
    if (isTeamWorkspace(ws)) getMembers(ws.id, { fresh: navigator.onLine });
  };
  unsub = useStore.subscribe(check);
  check(useStore.getState());
}
