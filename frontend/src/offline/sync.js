// Offline-first note storage and sync.
//
// Every change is written to the local database first and queued in the outbox, so editing
// never waits on the network. The outbox is sent to the server in order whenever we're online
// (push), and the local copy is refreshed from the server (pull) on start, on reconnect, when
// the tab regains focus, and every couple of minutes.
//
// Conflicts ("keep both"): each queued save carries the server version it was based on. If the
// note changed on another device in the meantime, the server keeps its version and saves ours as
// "<title> (conflict copy)" next to it. Nothing is overwritten.
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import { openUserDb, db, deleteUserDb } from './db';

const TREE_FIELDS = ['id', 'workspace_id', 'parent_id', 'title', 'tags', 'note_type', 'position', 'created_at', 'updated_at'];
const PULL_INTERVAL = 2 * 60 * 1000;

// crypto.randomUUID only exists on HTTPS/localhost; fall back for plain-HTTP LAN installs.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let userId = null;
let pushing = false;
let pulling = false;
let retryTimer = null;
let retryDelay = 5000;
let pullTimer = null;
const lastLocalEdit = new Map(); // noteId -> timestamp, so a pull never clobbers text being typed

// ───────────────────────── status ─────────────────────────

function setStatus(patch) {
  useStore.setState(s => ({ sync: { ...s.sync, ...patch } }));
}

async function refreshPendingCount() {
  if (!userId) return;
  const pending = await (await db()).count('outbox');
  setStatus({ pending });
}

function isNetworkError(err) {
  return !err.response; // no response at all: offline, DNS failure, timeout, server down
}

function markOnline() {
  retryDelay = 5000;
  if (!useStore.getState().sync.online) setStatus({ online: true });
}

function markOffline() {
  setStatus({ online: false });
  scheduleRetry();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => syncNow(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

// ───────────────────────── lifecycle ─────────────────────────

const onOnline = () => { retryDelay = 5000; syncNow(); };
const onOffline = () => setStatus({ online: false });
const onVisible = () => { if (document.visibilityState === 'visible') syncNow(); };

export async function startOffline(user) {
  if (userId === user.id) return;
  userId = user.id;
  await openUserDb(user.id);
  // Ask the browser not to evict our data when storage runs low.
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  clearInterval(pullTimer);
  pullTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, PULL_INTERVAL);

  setStatus({ online: navigator.onLine });
  await refreshPendingCount();
}

export function stopOffline() {
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(pullTimer);
  clearTimeout(retryTimer);
  userId = null;
}

/**
 * Sign out and forget this device's copy of the user's notes. Tries to upload queued
 * changes first, and asks before throwing away any that can't be uploaded.
 */
export async function signOut() {
  const { user, logout } = useStore.getState();
  if (userId) {
    await syncNow();
    const pending = await pendingChanges();
    if (pending > 0 && !confirm(`${pending} change(s) haven't been uploaded yet because you're offline. Sign out anyway and lose them?`)) return false;
    stopOffline();
  }
  if (user?.id) await deleteUserDb(user.id);
  logout();
  return true;
}

export async function pendingChanges() {
  if (!userId) return 0;
  return (await db()).count('outbox');
}

let syncPromise = null;
/** Upload queued changes, then refresh from the server. Safe to call any time. */
export function syncNow() {
  if (!userId) return Promise.resolve();
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    setStatus({ syncing: true });
    try {
      const pushed = await push();
      if (pushed) await pull();
    } finally {
      setStatus({ syncing: false });
      syncPromise = null;
    }
  })();
  return syncPromise;
}

// ───────────────────────── reading ─────────────────────────

function treeEntry(note) {
  const entry = {};
  for (const f of TREE_FIELDS) entry[f] = note[f];
  return entry;
}

function byPosition(a, b) {
  return (a.position - b.position) || ((a.created_at || 0) - (b.created_at || 0));
}

export async function getWorkspaces() {
  return (await (await db()).getAll('workspaces')).sort((a, b) => a.created_at - b.created_at);
}

export async function getWorkspaceNotes(workspaceId) {
  return (await db()).getAllFromIndex('notes', 'workspace_id', workspaceId);
}

/** Reload the sidebar tree for the active workspace from the local copy. */
export async function refreshTree() {
  const ws = useStore.getState().activeWorkspace;
  if (!ws || !userId) return;
  const notes = (await getWorkspaceNotes(ws.id)).sort(byPosition).map(treeEntry);
  if (useStore.getState().activeWorkspace?.id === ws.id) useStore.setState({ notes });
}

export function plainText(note) {
  const rich = (note.rich_content || '')
    .replace(/<figure[^>]*data-diagram[\s\S]*?<\/figure>/gi, ' [diagram] ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return `${(note.content || '').replace(/```synapse-diagram\n[\s\S]*?\n```/g, ' [diagram] ')}\n${rich}`;
}

function linkTitles(note) {
  const titles = new Set();
  for (const m of plainText(note).matchAll(/\[\[([^\[\]\n]+)\]\]/g)) titles.add(m[1].split('|')[0].trim().toLowerCase());
  return titles;
}

function computeLinks(note, all) {
  const byTitle = new Map(all.map(n => [n.title.toLowerCase(), n]));
  const links = [];
  for (const t of linkTitles(note)) {
    const target = byTitle.get(t);
    if (target && target.id !== note.id) links.push({ id: target.id, title: target.title, direction: 'outgoing' });
  }
  const mine = note.title.toLowerCase();
  for (const other of all) {
    if (other.id !== note.id && linkTitles(other).has(mine)) links.push({ id: other.id, title: other.title, direction: 'incoming' });
  }
  return links;
}

/** Open a note in the editor from the local copy. */
export async function openNote(id) {
  const note = await (await db()).get('notes', id);
  if (!note) { toast.error('Note not found'); return; }
  const all = await getWorkspaceNotes(note.workspace_id);
  useStore.getState().setActiveNote({ note, links: computeLinks(note, all), attachments: [], loadedAt: Date.now() });
}

/** Recompute the open note's links after an edit, without reloading the editor. */
export async function refreshActiveLinks(id) {
  const active = useStore.getState().activeNote;
  if (!active || active.note.id !== id) return;
  const note = await (await db()).get('notes', id);
  if (!note) return;
  const links = computeLinks(note, await getWorkspaceNotes(note.workspace_id));
  const current = useStore.getState().activeNote;
  const same = (a, b) => a.length === b.length && a.every((l, i) => l.id === b[i].id && l.direction === b[i].direction);
  if (current?.note.id === id && !same(current.links || [], links)) useStore.setState({ activeNote: { ...current, links } });
}

export async function openNoteByTitle(workspaceId, title) {
  const all = await getWorkspaceNotes(workspaceId);
  const target = all.find(n => n.title.toLowerCase() === title.trim().toLowerCase());
  if (target) return openNote(target.id);
  toast(`No note called "${title}" yet`, { icon: '🔗' });
}

/** Search the local copy: every word must appear in the title or body. */
export async function searchNotes(workspaceId, query) {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 10);
  if (terms.length === 0) return [];
  const results = [];
  for (const note of await getWorkspaceNotes(workspaceId)) {
    const title = note.title.toLowerCase();
    const text = readable(plainText(note)).replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    if (!terms.every(t => title.includes(t) || lower.includes(t))) continue;
    const score = terms.reduce((s, t) => s + (title.includes(t) ? 10 : 0) + (lower.split(t).length - 1), 0);
    results.push({ id: note.id, title: note.title, note_type: note.note_type, excerpt: excerpt(text, terms), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 30);
}

// Search excerpts read better without Markdown symbols (**, #, > [!NOTE], table bars, tags…).
function readable(text) {
  return text
    .replace(/```[\w+#.-]*\n?/g, ' ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ')   // table divider rows
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/<\/?(details|summary|u|br)[^>]*>/gi, ' ')
    .replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]/gi, ' ')
    .replace(/\[TOC\]/gi, ' ')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')                            // links and images → their text
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, '$1$2')
    .replace(/(\s*·\s*)+/g, ' · ');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function excerpt(text, terms) {
  const lower = text.toLowerCase();
  const hits = terms.map(t => lower.indexOf(t)).filter(i => i >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, at - 60);
  let snippet = escapeHtml(text.slice(start, start + 180));
  for (const t of terms) {
    snippet = snippet.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  }
  return (start > 0 ? '…' : '') + snippet + (start + 180 < text.length ? '…' : '');
}

/** Nodes and [[link]] edges for the graph view, from the local copy. */
export async function graphData(workspaceId) {
  const all = await getWorkspaceNotes(workspaceId);
  const byTitle = new Map(all.map(n => [n.title.toLowerCase(), n.id]));
  const edges = [];
  for (const note of all) {
    for (const t of linkTitles(note)) {
      const target = byTitle.get(t);
      if (target && target !== note.id) edges.push({ source_id: note.id, target_id: target });
    }
  }
  return { nodes: all.map(n => ({ id: n.id, title: n.title, tags: n.tags, note_type: n.note_type })), edges };
}

// ───────────────────────── writing ─────────────────────────

export async function createNote({ workspace_id, parent_id = null, title = 'Untitled', note_type = 'note', editor_mode }) {
  if (!editor_mode) {
    // The workspace's preference (Settings → Workspace → Preferences); Write by default.
    const ws = useStore.getState().workspaces.find(w => w.id === workspace_id);
    try { editor_mode = JSON.parse(ws?.settings || '{}').default_editor; } catch {}
    if (editor_mode !== 'markdown') editor_mode = 'rich';
  }
  const d = await db();
  const siblings = (await getWorkspaceNotes(workspace_id)).filter(n => (n.parent_id ?? null) === parent_id);
  const now = Math.floor(Date.now() / 1000);
  const note = {
    id: uuid(), workspace_id, parent_id, title, note_type,
    content: '', rich_content: null, canvas_data: null, editor_mode, tags: '[]',
    position: siblings.reduce((m, n) => Math.max(m, n.position), -1) + 1,
    created_at: now, updated_at: now, server_version: null,
  };
  const tx = d.transaction(['notes', 'outbox'], 'readwrite');
  await tx.objectStore('notes').put(note);
  await tx.objectStore('outbox').add({ op: 'create', noteId: note.id, fields: {}, opId: uuid() });
  await tx.done;
  afterLocalChange();
  await refreshTree();
  return note;
}

/**
 * Save changes to a note. `fields` may include title, content, rich_content, canvas_data,
 * tags (array), editor_mode, parent_id, position.
 */
export async function saveNote(id, fields) {
  const d = await db();
  const tx = d.transaction(['notes', 'outbox'], 'readwrite');
  const notes = tx.objectStore('notes');
  const outbox = tx.objectStore('outbox');
  const note = await notes.get(id);
  if (!note) { await tx.done; return; }

  const local = { ...fields };
  if (Array.isArray(local.tags)) local.tags = JSON.stringify(local.tags);
  // Moving a note in the tree isn't an edit, so it doesn't change "Edited … ago".
  const isMoveOnly = Object.keys(fields).every(k => k === 'parent_id' || k === 'position');
  await notes.put({ ...note, ...local, ...(isMoveOnly ? {} : { updated_at: Math.floor(Date.now() / 1000) }) });

  // Merge into the newest queued change for this note if no upload of it has been attempted,
  // so a burst of typing becomes one upload instead of hundreds. Once an upload was attempted
  // the server may already have applied it, so later edits go in a new entry.
  let cursor = await outbox.openCursor(null, 'prev');
  let merged = false;
  while (cursor) {
    const entry = cursor.value;
    if (entry.noteId === id) {
      if (!entry.attempted && (entry.op === 'create' || entry.op === 'update')) {
        await cursor.update({ ...entry, fields: { ...entry.fields, ...fields } });
        merged = true;
      }
      break;
    }
    cursor = await cursor.continue();
  }
  if (!merged) await outbox.add({ op: 'update', noteId: id, fields, opId: uuid() });
  await tx.done;

  lastLocalEdit.set(id, Date.now());
  afterLocalChange();
}

/** Delete a note and everything under it. Returns the deleted ids. */
export async function deleteNote(id) {
  const d = await db();
  const root = await d.get('notes', id);
  if (!root) return [];
  const all = await getWorkspaceNotes(root.workspace_id);
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const n of all) if (n.parent_id === ids[i]) ids.push(n.id);
  const gone = new Set(ids);

  const tx = d.transaction(['notes', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  let rootCreateAttempted = false;
  let cursor = await outbox.openCursor();
  while (cursor) {
    const entry = cursor.value;
    if (gone.has(entry.noteId)) {
      // An attempted upload may have reached the server; leave it so the delete follows it.
      if (entry.attempted) { if (entry.noteId === id && entry.op === 'create') rootCreateAttempted = true; }
      else await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  for (const nid of ids) await tx.objectStore('notes').delete(nid);
  // The server deletes the whole subtree, so one request for the root is enough.
  // Notes that never reached the server need no request at all.
  if (root.server_version !== null || rootCreateAttempted) await outbox.add({ op: 'delete', noteId: id, fields: {}, opId: uuid() });
  await tx.done;

  afterLocalChange();
  await refreshTree();
  return ids;
}

/**
 * Move a note in the tree (drag and drop).
 *   where: 'before' | 'after' — next to `targetId`, at the same level
 *          'inside'           — last child of `targetId`
 *          'root'             — end of the top level (`targetId` ignored)
 * Renumbers the positions of the new siblings; children move along with the note.
 * Returns false if the move isn't allowed (e.g. into its own sub-note).
 */
export async function moveNote(id, targetId, where) {
  const d = await db();
  const note = await d.get('notes', id);
  if (!note || id === targetId) return false;
  const all = await getWorkspaceNotes(note.workspace_id);

  let parentId = null;
  if (where !== 'root') {
    const target = all.find(n => n.id === targetId);
    if (!target) return false;
    parentId = where === 'inside' ? target.id : (target.parent_id ?? null);
  }

  // Not into itself or anything nested under it.
  const nested = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of all) if (n.parent_id && nested.has(n.parent_id) && !nested.has(n.id)) { nested.add(n.id); grew = true; }
  }
  if (parentId && nested.has(parentId)) return false;

  const siblings = all.filter(n => (n.parent_id ?? null) === parentId && n.id !== id).sort(byPosition);
  let index = siblings.length;
  if (where === 'before' || where === 'after') {
    index = siblings.findIndex(n => n.id === targetId) + (where === 'after' ? 1 : 0);
  }
  siblings.splice(index, 0, note);

  const parentChanged = (note.parent_id ?? null) !== parentId;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    if (s.id === id) {
      if (parentChanged || s.position !== i) await saveNote(id, parentChanged ? { parent_id: parentId, position: i } : { position: i });
    } else if (s.position !== i) {
      await saveNote(s.id, { position: i });
    }
  }
  await refreshTree();
  return true;
}

function afterLocalChange() {
  refreshPendingCount();
  // Send soon, but let quick successive edits pile up first.
  clearTimeout(afterLocalChange.timer);
  afterLocalChange.timer = setTimeout(() => syncNow(), 1500);
}

// ───────────────────────── push ─────────────────────────

/** Send queued changes in order. Returns false if we stopped because we're offline. */
async function push() {
  if (pushing) return true;
  pushing = true;
  try {
    const d = await db();
    while (userId) {
      // Take the oldest entry and mark it attempted in one transaction, so nothing merges
      // into it from here on.
      const tx = d.transaction('outbox', 'readwrite');
      const cursor = await tx.store.openCursor();
      if (!cursor) { await tx.done; break; }
      const entry = { ...cursor.value, attempted: true };
      await cursor.update(entry);
      await tx.done;
      try {
        await send(entry);
        markOnline();
      } catch (err) {
        if (isNetworkError(err)) { markOffline(); return false; }
        if (err.response.status === 401) return false; // signed out; keep the queue for next login
        if (err.response.status >= 500 || err.response.status === 429) { scheduleRetry(); return false; }
        // The server refused this change outright (bad data). Drop it so the queue isn't stuck.
        console.error('Sync: dropping rejected change', entry, err.response.data);
        toast.error(`A change couldn't be saved: ${err.response.data?.error || 'rejected by server'}`);
      }
      await d.delete('outbox', entry.seq);
      await refreshPendingCount();
    }
    setStatus({ lastSyncAt: Date.now(), error: null });
    return true;
  } finally {
    pushing = false;
  }
}

async function send(entry) {
  const d = await db();
  if (entry.op === 'delete') {
    try { await api.delete(`/notes/${entry.noteId}`); }
    catch (err) { if (err.response?.status !== 404) throw err; }
    return;
  }

  const local = await d.get('notes', entry.noteId);
  if (!local) return; // deleted locally since; the delete is queued separately

  if (entry.op === 'create') return sendCreate(local);

  const body = { ...entry.fields, base_version: local.server_version ?? undefined, op_id: entry.opId };
  let data;
  try {
    ({ data } = await api.patch(`/notes/${entry.noteId}`, body));
  } catch (err) {
    if (err.response?.status === 404) {
      // Deleted on another device while we edited it here: keep our version by re-creating it.
      await sendCreate(local);
      toast(`"${local.title}" was deleted on another device. Your edited copy was kept.`, { icon: '♻️', duration: 6000 });
      return;
    }
    throw err;
  }

  if (data.conflict_copy) return handleConflict(entry, local, data.note, data.conflict_copy);
  await setServerVersion(entry.noteId, data.note);
}

async function sendCreate(local) {
  const { data } = await api.post('/notes', {
    id: local.id, workspace_id: local.workspace_id, parent_id: local.parent_id ?? null,
    title: local.title, content: local.content || '', rich_content: local.rich_content ?? null,
    canvas_data: local.canvas_data ?? null, editor_mode: local.editor_mode || 'markdown',
    note_type: local.note_type, tags: safeTags(local.tags), position: local.position,
  });
  await setServerVersion(local.id, data.note, { parent_id: data.note.parent_id });
  if ((local.parent_id ?? null) !== data.note.parent_id) refreshTree();
}

function safeTags(tags) {
  try { return JSON.parse(tags || '[]'); } catch { return []; }
}

async function setServerVersion(id, serverNote, extra = {}) {
  const d = await db();
  const tx = d.transaction('notes', 'readwrite');
  const local = await tx.store.get(id);
  if (local) await tx.store.put({ ...local, ...extra, server_version: serverNote.version });
  await tx.done;
}

async function handleConflict(entry, local, serverNote, copy) {
  const d = await db();
  const tx = d.transaction(['notes', 'outbox'], 'readwrite');
  // The original becomes the server's version; our text lives on in the copy.
  await tx.objectStore('notes').put({ ...serverNote, server_version: serverNote.version });
  await tx.objectStore('notes').put({
    ...local, id: copy.id, title: copy.title, parent_id: copy.parent_id, position: copy.position,
    created_at: copy.created_at, server_version: copy.version,
  });
  // Later edits we queued for the original belong to the copy too.
  const outbox = tx.objectStore('outbox');
  let cursor = await outbox.openCursor();
  while (cursor) {
    const e = cursor.value;
    if (e.noteId === entry.noteId && e.seq !== entry.seq && e.op === 'update') {
      const { title, ...fields } = e.fields;
      await cursor.update({ ...e, noteId: copy.id, fields });
    }
    cursor = await cursor.continue();
  }
  await tx.done;

  await refreshTree();
  const active = useStore.getState().activeNote?.note?.id;
  if (active === entry.noteId) await openNote(copy.id);
  toast(`"${serverNote.title}" was changed on another device. Your version was saved as "${copy.title}".`, { icon: '⚠️', duration: 8000 });
}

// ───────────────────────── pull ─────────────────────────

async function pull() {
  if (pulling || !userId) return;
  pulling = true;
  try {
    const { data } = await api.get('/workspaces');
    markOnline();
    const d = await db();

    // Workspaces
    const serverWs = new Map(data.workspaces.map(w => [w.id, w]));
    const tx = d.transaction(['workspaces', 'notes'], 'readwrite');
    for (const local of await tx.objectStore('workspaces').getAll()) {
      if (!serverWs.has(local.id)) {
        await tx.objectStore('workspaces').delete(local.id);
        const keys = await tx.objectStore('notes').index('workspace_id').getAllKeys(local.id);
        for (const k of keys) await tx.objectStore('notes').delete(k);
      }
    }
    for (const ws of data.workspaces) await tx.objectStore('workspaces').put(ws);
    await tx.done;

    const store = useStore.getState();
    store.setWorkspaces(data.workspaces);
    if ((!store.activeWorkspace || !serverWs.has(store.activeWorkspace.id)) && data.workspaces[0]) {
      store.setActiveWorkspace(data.workspaces[0]);
    }

    for (const ws of data.workspaces) await pullWorkspace(ws.id);
    await refreshTree();
    setStatus({ lastSyncAt: Date.now() });
  } catch (err) {
    if (isNetworkError(err)) markOffline();
    else console.error('Sync: pull failed', err);
  } finally {
    pulling = false;
  }
}

async function pullWorkspace(workspaceId) {
  const d = await db();
  const { data } = await api.get(`/notes/workspace/${workspaceId}`);
  const serverNotes = new Map(data.notes.map(n => [n.id, n]));
  const pending = new Set((await d.getAll('outbox')).map(e => e.noteId));
  const localNotes = new Map((await getWorkspaceNotes(workspaceId)).map(n => [n.id, n]));

  const toFetch = [];
  const metaUpdates = [];
  for (const s of data.notes) {
    const local = localNotes.get(s.id);
    if (pending.has(s.id)) continue; // our queued change will reconcile it
    if (!local || local.server_version !== s.version) toFetch.push(s.id);
    else if (local.parent_id !== s.parent_id || local.position !== s.position) metaUpdates.push(s);
  }
  const toDelete = [...localNotes.values()].filter(n =>
    !serverNotes.has(n.id) && n.server_version !== null && !pending.has(n.id));

  const fetched = [];
  for (let i = 0; i < toFetch.length; i += 100) {
    const res = await api.post('/notes/batch', { ids: toFetch.slice(i, i + 100) });
    fetched.push(...res.data.notes);
  }

  const tx = d.transaction(['notes', 'outbox'], 'readwrite');
  // Re-check the outbox inside the transaction: the user may have edited while we downloaded.
  const pendingNow = new Set((await tx.objectStore('outbox').getAll()).map(e => e.noteId));
  const notes = tx.objectStore('notes');
  for (const n of fetched) if (!pendingNow.has(n.id)) await notes.put({ ...n, server_version: n.version });
  for (const s of metaUpdates) {
    if (pendingNow.has(s.id)) continue;
    const local = await notes.get(s.id);
    if (local) await notes.put({ ...local, parent_id: s.parent_id, position: s.position });
  }
  for (const n of toDelete) if (!pendingNow.has(n.id)) await notes.delete(n.id);
  await tx.done;

  // If the open note changed on another device (and isn't being edited here), show the new version.
  const active = useStore.getState().activeNote?.note?.id;
  if (!active) return;
  if (toDelete.some(n => n.id === active)) {
    useStore.getState().setActiveNote(null);
    toast('This note was deleted on another device.', { icon: '🗑️' });
  } else if (fetched.some(n => n.id === active) && Date.now() - (lastLocalEdit.get(active) || 0) > 5000) {
    await openNote(active);
  }
}
