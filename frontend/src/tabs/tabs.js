// Tabs: several notes open at once, like a web browser. Clicking a note opens it in the current
// tab; Ctrl/⌘-click, middle-click or the "+" button make a new tab. Each device remembers its own
// tabs per workspace (persisted in the zustand store as `tabs`).
//
// The store's `activeNote` stays the one open note; tabs just follow it (a subscription below
// puts whatever note gets opened into the current tab).
import { useStore } from '../stores/useStore';
import { openNote } from '../offline/sync';
import { openSharedNote } from '../shares/client';

const MAX_TABS = 30;
let newTabNext = false;

const wsId = () => useStore.getState().activeWorkspace?.id || null;
export const isBlank = t => String(t?.id || '').startsWith('new:');

export function tabsFor(state, ws) {
  return state.tabs?.[ws] || { items: [], active: null };
}

function setTabs(ws, value) {
  useStore.setState(s => ({ tabs: { ...(s.tabs || {}), [ws]: value } }));
}

/** The next note that gets opened goes into a new tab (for [[link]] Ctrl-clicks etc.). */
export function nextInNewTab() { newTabNext = true; setTimeout(() => { newTabNext = false; }, 3000); }

/** Open a tab's note (your own, or one shared with you). */
export async function openTabNote(tab) {
  if (!tab || isBlank(tab)) return false;
  if (tab.shared) return openSharedNote(tab.id);
  await openNote(tab.id);
  return true;
}

export async function openInNewTab(id, { shared = false } = {}) {
  newTabNext = true;
  try { await openTabNote({ id, shared }); } finally { newTabNext = false; }
  const s = useStore.getState();
  if (['graph', 'tasks', 'trash', 'chat', 'ask'].includes(s.view)) s.setView('editor');
}

/** "+": an empty tab; the next note you pick fills it. */
export function newBlankTab() {
  const ws = wsId();
  if (!ws) return;
  const cur = tabsFor(useStore.getState(), ws);
  const blank = { id: `new:${Date.now().toString(36)}`, title: 'New tab' };
  const ai = cur.items.findIndex(t => t.id === cur.active);
  const items = [...cur.items];
  items.splice(ai < 0 ? items.length : ai + 1, 0, blank);
  setTabs(ws, { items: items.slice(-MAX_TABS), active: blank.id });
  const s = useStore.getState();
  s.setActiveNote(null);
  if (['graph', 'tasks', 'trash', 'chat', 'ask'].includes(s.view)) s.setView('editor');
}

export async function switchTab(tab) {
  const ws = wsId();
  if (!ws) return;
  const cur = tabsFor(useStore.getState(), ws);
  if (isBlank(tab)) { setTabs(ws, { ...cur, active: tab.id }); useStore.getState().setActiveNote(null); return; }
  if (useStore.getState().activeNote?.note?.id === tab.id) { setTabs(ws, { ...cur, active: tab.id }); return; }
  if (!(await openTabNote(tab))) closeTab(tab.id);
}

export async function closeTab(id) {
  const ws = wsId();
  if (!ws) return;
  const cur = tabsFor(useStore.getState(), ws);
  const idx = cur.items.findIndex(t => t.id === id);
  if (idx < 0) return;
  const items = cur.items.filter(t => t.id !== id);
  if (cur.active !== id) { setTabs(ws, { ...cur, items }); return; }
  const next = items[idx] || items[idx - 1] || null;
  setTabs(ws, { items, active: next?.id || null });
  if (!next || isBlank(next)) { useStore.getState().setActiveNote(null); return; }
  if (!(await openTabNote(next))) closeTab(next.id);
}

export function closeOtherTabs(id) {
  const ws = wsId();
  if (!ws) return;
  const cur = tabsFor(useStore.getState(), ws);
  setTabs(ws, { items: cur.items.filter(t => t.id === id), active: id });
  if (useStore.getState().activeNote?.note?.id !== id) switchTab(cur.items.find(t => t.id === id));
}

/** Drop tabs whose notes were deleted (the tree is the list of this workspace's notes). */
export function pruneTabs(treeIds) {
  const ws = wsId();
  if (!ws || !treeIds.size) return;
  const cur = tabsFor(useStore.getState(), ws);
  const items = cur.items.filter(t => isBlank(t) || t.shared || treeIds.has(t.id));
  if (items.length === cur.items.length) return;
  const activeGone = !items.some(t => t.id === cur.active);
  if (!activeGone) { setTabs(ws, { ...cur, items }); return; }
  const oldIdx = cur.items.findIndex(t => t.id === cur.active);
  const next = items[Math.min(oldIdx, items.length - 1)] || null;
  setTabs(ws, { items, active: next?.id || null });
  if (!useStore.getState().activeNote && next) openTabNote(next);
}

/** Move a tab (drag and drop in the tab bar). */
export function moveTab(id, toIndex) {
  const ws = wsId();
  if (!ws) return;
  const cur = tabsFor(useStore.getState(), ws);
  const items = [...cur.items];
  const from = items.findIndex(t => t.id === id);
  if (from < 0) return;
  const [t] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, t);
  setTabs(ws, { ...cur, items });
}

// Whatever note gets opened (sidebar, search, links, calendar…) goes into the current tab.
let started = false;
export function startTabs() {
  if (started) return;
  started = true;
  useStore.subscribe((s, prev) => {
    const note = s.activeNote?.note;
    if (!note || note.id === prev.activeNote?.note?.id) return;
    const ws = s.activeWorkspace?.id;
    if (!ws) return;
    const entry = { id: note.id, shared: !!s.activeNote.shared?.guest, title: note.title };
    const cur = tabsFor(s, ws);
    const items = [...cur.items];
    const existing = items.findIndex(t => t.id === note.id);
    if (existing >= 0) items[existing] = { ...items[existing], ...entry };
    else {
      const ai = items.findIndex(t => t.id === cur.active);
      if (newTabNext || ai < 0) items.splice(ai < 0 ? items.length : ai + 1, 0, entry);
      else items[ai] = entry;
    }
    newTabNext = false;
    const trimmed = items.length > MAX_TABS ? items.slice(items.length - MAX_TABS) : items;
    setTabs(ws, { items: trimmed, active: note.id });
  });
}
