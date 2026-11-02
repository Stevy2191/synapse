// Clusters — smart, saved groups of notes (like a saved search). A cluster doesn't move notes: it
// gathers every note matching its rules (tag, words, kind, dates, where it lives, what it has), plus
// notes added by hand, minus notes removed by hand. A note can be in many clusters.
// Stored in the workspace's settings (synced to every device); matching runs on the device, offline.
import api from '../api';
import { useStore } from '../stores/useStore';
import { workspaceSettings } from '../components/Avatar';
import { getWorkspaceNotes, plainText, syncNow } from '../offline/sync';
import { noteKind } from '../components/noteKinds';

export const FIELDS = {
  tag: { label: 'Tag', ops: { is: 'is', not: 'is not' }, input: 'tag' },
  title: { label: 'Title', ops: { contains: 'contains', not_contains: 'doesn’t contain', starts: 'starts with' }, input: 'text' },
  text: { label: 'Text', ops: { contains: 'contains', not_contains: 'doesn’t contain' }, input: 'text' },
  kind: { label: 'Kind', ops: { is: 'is', not: 'is not' }, input: 'kind' },
  created: { label: 'Created', ops: { within: 'in the last', before: 'before', after: 'after' }, input: 'date' },
  updated: { label: 'Edited', ops: { within: 'in the last', before: 'before', after: 'after' }, input: 'date' },
  inside: { label: 'Inside', ops: { is: 'is inside', not: 'is not inside' }, input: 'note' },
  has: { label: 'Has', ops: { is: 'has', not: 'doesn’t have' }, input: 'has' },
};
export const KINDS = { note: 'Note', drawio: 'Note with a draw.io diagram', excalidraw: 'Note with an Excalidraw drawing', flowchart: 'Flowchart', freedraw: 'Free Draw page' };
export const HAS = {
  open_tasks: 'open to-dos', tasks: 'a checklist', meeting: 'a meeting recording', pictures: 'pictures', files: 'files', links: 'links to notes', tags: 'any tags',
};
export const DAYS = { 1: 'day', 7: '7 days', 30: '30 days', 90: '3 months', 365: 'year' };
export const ICONS = ['✨', '📌', '⭐', '🔥', '📚', '🍳', '✈️', '🏠', '💼', '💰', '🧠', '🎯', '🛠️', '❤️', '🎓', '🗂️'];

const tagsOf = n => { try { const t = typeof n.tags === 'string' ? JSON.parse(n.tags || '[]') : n.tags; return Array.isArray(t) ? t.map(x => String(x).toLowerCase()) : []; } catch { return []; } };
const text = n => `${n.rich_content || ''}\n${n.content || ''}`;

function has(n, what) {
  const t = text(n);
  switch (what) {
    case 'open_tasks': return /data-checked="false"|^\s*[-*] \[ \]/m.test(t);
    case 'tasks': return /data-type="taskList"|^\s*[-*] \[[ xX]\]/m.test(t);
    case 'meeting': return /data-meeting=|```synapse-meeting/.test(t);
    case 'pictures': return /<img |!\[[^\]]*\]\(data:image/.test(t);
    case 'files': return /data-file=|\[📎/.test(t);
    case 'links': return /\[\[[^\]]+\]\]|class="wiki-link"/.test(t);
    case 'tags': return tagsOf(n).length > 0;
    default: return false;
  }
}

const dayStart = d => Math.floor(new Date(`${d}T00:00:00`).getTime() / 1000);

function ruleMatches(n, r, ctx) {
  const v = String(r.value ?? '').trim();
  const lower = v.toLowerCase();
  switch (r.field) {
    case 'tag': { const yes = tagsOf(n).includes(lower.replace(/^#/, '')); return r.op === 'not' ? !yes : yes; }
    case 'title': {
      const t = (n.title || '').toLowerCase();
      if (r.op === 'starts') return t.startsWith(lower);
      return r.op === 'not_contains' ? !t.includes(lower) : t.includes(lower);
    }
    case 'text': { const yes = ctx.plain(n).includes(lower); return r.op === 'not_contains' ? !yes : yes; }
    case 'kind': { const yes = noteKind(n) === v; return r.op === 'not' ? !yes : yes; }
    case 'created':
    case 'updated': {
      const at = Number(r.field === 'created' ? n.created_at : n.updated_at) || 0;
      if (r.op === 'within') return at >= Date.now() / 1000 - (Number(v) || 7) * 86400;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
      return r.op === 'before' ? at < dayStart(v) : at >= dayStart(v) + 86400;
    }
    case 'inside': {
      let p = ctx.byId.get(n.id)?.parent_id, yes = false;
      for (let i = 0; p && i < 50; i++) { if (p === v) { yes = true; break; } p = ctx.byId.get(p)?.parent_id; }
      return r.op === 'not' ? !yes : yes;
    }
    case 'has': { const yes = has(n, v); return r.op === 'not' ? !yes : yes; }
    default: return true;
  }
}

function makeCtx(all) {
  const plainCache = new Map();
  return {
    byId: new Map(all.map(n => [n.id, n])),
    plain: n => { if (!plainCache.has(n.id)) plainCache.set(n.id, plainText(n).toLowerCase()); return plainCache.get(n.id); },
  };
}

/** Is this note in the cluster? */
export function inCluster(n, c, ctx) {
  if (c.hidden?.includes(n.id)) return false;
  if (c.pinned?.includes(n.id)) return true;
  const rules = (c.rules || []).filter(r => r.field !== 'tag' && r.field !== 'title' && r.field !== 'text' ? true : String(r.value ?? '').trim());
  if (!rules.length) return false;
  return c.match === 'any' ? rules.some(r => ruleMatches(n, r, ctx)) : rules.every(r => ruleMatches(n, r, ctx));
}

/** The notes in a cluster (newest edits first). */
export async function clusterNotes(workspaceId, c, all = null) {
  const notes = all || await getWorkspaceNotes(workspaceId);
  const ctx = makeCtx(notes);
  return notes.filter(n => inCluster(n, c, ctx)).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

/** How many notes each cluster has: { clusterId: count }. */
export async function clusterCounts(workspaceId, clusters) {
  const notes = await getWorkspaceNotes(workspaceId);
  const ctx = makeCtx(notes);
  return Object.fromEntries(clusters.map(c => [c.id, notes.filter(n => inCluster(n, c, ctx)).length]));
}

export const clustersOf = ws => (Array.isArray(workspaceSettings(ws).clusters) ? workspaceSettings(ws).clusters : []);

/** Save the workspace's clusters (needs a connection, like other workspace settings). */
export async function saveClusters(list) {
  const { activeWorkspace, workspaces, setWorkspaces } = useStore.getState();
  if (!activeWorkspace) return;
  const { data } = await api.patch(`/workspaces/${activeWorkspace.id}`, { settings: { clusters: list } });
  setWorkspaces(workspaces.map(w => (w.id === data.workspace.id ? data.workspace : w)));
  useStore.setState({ activeWorkspace: data.workspace });
  syncNow();
  return clustersOf(data.workspace);
}

export const newClusterId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A rule in words, for the cluster page ("Tag is recipe"). */
export function describeRule(r, notesById) {
  const f = FIELDS[r.field];
  if (!f) return '';
  let v = r.value;
  if (f.input === 'kind') v = KINDS[v] || v;
  if (f.input === 'has') v = HAS[v] || v;
  if (f.input === 'note') v = `“${notesById.get(v)?.title || 'a note'}”`;
  if (f.input === 'date' && r.op === 'within') v = DAYS[v] || `${v} days`;
  if (f.input === 'tag') v = `#${String(v).replace(/^#/, '')}`;
  if (f.input === 'text') v = `“${v}”`;
  const words = `${f.ops[r.op] || r.op} ${v}`;
  return r.field === 'has' || r.field === 'inside' ? words.charAt(0).toUpperCase() + words.slice(1) : `${f.label} ${words}`;
}
