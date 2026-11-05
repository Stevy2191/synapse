// Folders: notes with note_type 'folder'. They hold notes and other folders, sync and go to the
// Trash like any note, and have an optional short description (their `content`).
import { useStore } from '../stores/useStore';
import { createNote, getWorkspaceNotes, moveNote, openNote } from '../offline/sync';

export const isFolder = n => n?.note_type === 'folder';

/** "New folder", or "New folder (2)" if that name is taken next to it. */
export function freeFolderName(siblings, base = 'New folder') {
  const taken = new Set(siblings.map(n => n.title.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}

/** Make a folder (inside `parentId`, or at the top), open it, and return it. */
export async function newFolder(parentId = null, title = null) {
  const ws = useStore.getState().activeWorkspace;
  if (!ws) return null;
  const siblings = (await getWorkspaceNotes(ws.id)).filter(n => (n.parent_id ?? null) === parentId);
  const folder = await createNote({ workspace_id: ws.id, parent_id: parentId, title: title || freeFolderName(siblings), note_type: 'folder', editor_mode: 'markdown' });
  // Remember it open, and show it; its page selects the name so it can be typed straight away.
  setFolderOpen(folder.id, true);
  if (parentId) setFolderOpen(parentId, true);
  renameNext = folder.id;
  await openNote(folder.id);
  useStore.getState().setView('editor');
  return folder;
}

let renameNext = null;
/** True (once) if `id` is a folder that was just made and should have its name selected. */
export function takeRename(id) {
  if (!id || renameNext !== id) return false;
  renameNext = null;
  return true;
}

/** Move a note (or folder) into a folder; null = the top level. */
export function moveToFolder(noteId, folderId) {
  return moveNote(noteId, folderId, folderId ? 'inside' : 'root');
}

// ── Which folders are open in the sidebar (kept on this device) ──
const KEY = 'synapse.openFolders';
function readOpen() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function folderOpen(id, fallback) { const v = readOpen()[id]; return v === undefined ? fallback : v; }
export function setFolderOpen(id, open) {
  try { const m = readOpen(); m[id] = open; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('synapse:folder-toggle', { detail: { id, open } }));
}
