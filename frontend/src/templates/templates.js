// Note templates. A template is an ordinary note inside the workspace's "Templates" folder (top level),
// edited with the normal editor. Fill-in fields like {{date}} are replaced when a note is made from it.
// "Meeting" and "Daily note" templates are used for notes created from the calendar; built-in versions
// are used when the workspace doesn't have its own. A template can be copied to another workspace or
// sent to another person (lands in their Templates folder).
import api from '../api';
import { useStore } from '../stores/useStore';
import { getWorkspaceNotes, createNote, saveNote, openNote } from '../offline/sync';
import { htmlToMarkdown, markdownToHtml } from '../components/editor/convert';
import { datedName } from '../components/noteKinds';

export const FOLDER = 'Templates';

const p = s => `<p>${s}</p>`;
const h2 = s => `<h2>${s}</h2>`;
const todo = (...items) => `<ul data-type="taskList">${(items.length ? items : ['']).map(i => `<li data-type="taskItem" data-checked="false"><p>${i}</p></li>`).join('')}</ul>`;
const bullets = (...items) => `<ul>${items.map(i => `<li><p>${i}</p></li>`).join('')}</ul>`;

/** Starter templates (also the built-in Meeting / Daily note when a workspace has none). */
export const STARTERS = [
  { title: 'Meeting', icon: '🤝', desc: 'Used for meeting notes made from the calendar',
    html: p('<strong>When:</strong> {{when}}') + p('<strong>Where:</strong> {{location}}') + p('<strong>Join:</strong> {{join}}')
      + p('<strong>Attendees:</strong> {{attendees}}') + p('<strong>Day:</strong> {{day}}')
      + h2('Agenda') + bullets('') + h2('Notes') + p('') + h2('Action items') + todo() },
  { title: 'Daily note', icon: '📅', desc: 'Used for the daily note made from the calendar',
    html: p('<em>{{date}}</em>') + h2('Meetings') + p('{{meetings}}') + h2('To-do') + todo() + h2('Notes') + p('') },
  { title: 'Project', icon: '🎯', desc: 'Goal, plan, tasks and decisions',
    html: p('<strong>Started:</strong> {{date_short}} · <strong>Status:</strong> Planning')
      + h2('Goal') + p('What does “done” look like?') + h2('Plan') + bullets('') + h2('Tasks') + todo()
      + h2('Decisions') + bullets('') + h2('Links & files') + p('') },
  { title: 'Weekly review', icon: '🗓️', desc: 'Look back, look ahead',
    html: p('<em>Week of {{date}}</em>') + h2('What went well') + bullets('') + h2('What didn’t') + bullets('')
      + h2('Still open') + todo() + h2('Next week’s priorities') + todo('', '', '') },
  { title: 'Recipe', icon: '🍳', desc: 'Ingredients, steps and notes',
    html: p('<strong>Serves:</strong> · <strong>Time:</strong> · <strong>Source:</strong>')
      + h2('Ingredients') + todo('') + h2('Steps') + '<ol><li><p></p></li></ol>' + h2('Notes') + p('') },
];

/** The fill-in fields, for the help text in templates. */
export const FIELDS = [
  ['{{title}}', 'the new note’s title'], ['{{date}}', 'Monday, November 2, 2026'], ['{{date_short}}', 'Nov 2, 2026'],
  ['{{today}}', '2026-11-02'], ['{{tomorrow}}', '2026-11-03'], ['{{time}}', 'the time now (or the meeting’s time)'],
  ['{{weekday}}', 'Monday'], ['{{month}}', 'November'], ['{{year}}', '2026'], ['{{me}}', 'your name'],
  ['{{meeting}}', 'meeting name'], ['{{when}}', 'meeting day and time'], ['{{location}}', 'where'], ['{{join}}', 'join link'],
  ['{{attendees}}', 'who’s invited (on a line of its own: a list)'], ['{{calendar}}', 'which calendar'], ['{{day}}', 'link to that day’s daily note'],
  ['{{meetings}}', 'daily note: that day’s meetings (on a line of its own)'],
];

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fields that only depend on a date (and who you are). */
export function dateVars(date = new Date(), { time } = {}) {
  const d = new Date(date);
  const plus = n => { const x = new Date(d); x.setDate(x.getDate() + n); return iso(x); };
  const user = useStore.getState().user;
  return {
    date: d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    date_short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    today: iso(d), tomorrow: plus(1), yesterday: plus(-1),
    time: time ?? new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    month: d.toLocaleDateString(undefined, { month: 'long' }),
    year: String(d.getFullYear()),
    me: user?.display_name || user?.username || '',
  };
}

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/gi;
/** A value as HTML: a string (escaped), { html }, or { list: [...] } (comma-separated inline). */
function inline(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'html' in v) return v.html || '';
  if (typeof v === 'object' && Array.isArray(v.list)) return esc(v.list.join(', '));
  return esc(v);
}

/**
 * Fill in a template's HTML. A paragraph holding only a list field ({{attendees}}, {{meetings}}) becomes a
 * bulleted list; a paragraph whose fields are all empty (e.g. "Where: {{location}}" with no place) is dropped.
 */
export function fillTemplate(html, vars) {
  const get = name => vars[name.toLowerCase()];
  let out = String(html || '').replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (whole, attrs, inner) => {
    const names = [...inner.matchAll(FIELD)].map(m => m[1]);
    if (!names.length) return whole;
    const alone = inner.replace(/<[^>]+>/g, '').trim().match(/^\{\{\s*([a-z_]+)\s*\}\}$/i);
    const v = alone && get(alone[1]);
    if (v && typeof v === 'object' && Array.isArray(v.list)) {
      return v.list.length ? `<ul>${v.list.map(x => `<li><p>${esc(x)}</p></li>`).join('')}</ul>` : '';
    }
    if (names.every(n => { const x = get(n); return x == null || x === '' || (typeof x === 'object' && (Array.isArray(x.list) ? !x.list.length : !x.html)); })) return '';
    return `<p${attrs}>${inner.replace(FIELD, (_, n) => inline(get(n)))}</p>`;
  });
  out = out.replace(FIELD, (m, n) => (get(n) === undefined ? m : inline(get(n))));
  return out;
}

const fillText = (s, vars) => String(s || '').replace(FIELD, (m, n) => { const v = vars[n.toLowerCase()]; return v === undefined ? m : (typeof v === 'object' ? (v.list || []).join(', ') : String(v)); });

export async function templatesFolder(workspaceId) {
  return (await getWorkspaceNotes(workspaceId)).find(n => !n.parent_id && n.title === FOLDER) || null;
}

/** All templates in a workspace (every note inside the Templates folder), by title. */
export async function listTemplates(workspaceId) {
  const all = await getWorkspaceNotes(workspaceId);
  const folder = all.find(n => !n.parent_id && n.title === FOLDER);
  if (!folder) return [];
  const inside = new Set([folder.id]);
  let grew = true;
  while (grew) { grew = false; for (const n of all) if (n.parent_id && inside.has(n.parent_id) && !inside.has(n.id)) { inside.add(n.id); grew = true; } }
  return all.filter(n => n.id !== folder.id && inside.has(n.id) && (!n.note_type || n.note_type === 'note'))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Is this note a template (inside the Templates folder)? `tree` = the sidebar notes. */
export function isTemplate(noteId, tree) {
  const byId = new Map(tree.map(n => [n.id, n]));
  let n = byId.get(noteId);
  for (let i = 0; n && i < 30; i++) {
    const parent = n.parent_id && byId.get(n.parent_id);
    if (!parent) return false;
    if (!parent.parent_id && parent.title === FOLDER) return true;
    n = parent;
  }
  return false;
}

export const templateHtml = note => (note.editor_mode !== 'markdown' && note.rich_content ? note.rich_content : markdownToHtml(note.content || ''));

const FOLDER_BLURB = 'Templates for new notes. Each note in here is a template: write it like any note, and use fill-in fields like {{date}}, {{time}} or {{title}}. “Meeting” and “Daily note” are used for notes made from the calendar. Use a template with + → From a template, or /template inside a note.';

async function ensureFolder(workspaceId) {
  let folder = await templatesFolder(workspaceId);
  if (!folder) {
    folder = await createNote({ workspace_id: workspaceId, title: FOLDER, note_type: 'folder', editor_mode: 'markdown' });
    await saveNote(folder.id, { content: FOLDER_BLURB });
  }
  return folder;
}

/** Create the Templates folder with the starter templates that are missing. Returns the folder. */
export async function setupStarters(workspaceId) {
  const folder = await ensureFolder(workspaceId);
  const have = new Set((await listTemplates(workspaceId)).map(t => t.title.toLowerCase()));
  for (const s of STARTERS) {
    if (have.has(s.title.toLowerCase())) continue;
    const n = await createNote({ workspace_id: workspaceId, parent_id: folder.id, title: s.title, editor_mode: 'rich' });
    await saveNote(n.id, { rich_content: s.html, content: htmlToMarkdown(s.html), tags: ['template'] });
  }
  return folder;
}

/** The workspace's template called `name` (e.g. "Meeting"), else the built-in one. Returns { title, html, tags }. */
export async function templateNamed(workspaceId, name) {
  const t = (await listTemplates(workspaceId)).find(x => x.title.toLowerCase() === name.toLowerCase());
  if (t) return { title: t.title, html: templateHtml(t), tags: tagsOf(t) };
  const s = STARTERS.find(x => x.title === name);
  return { title: s.title, html: s.html, tags: [] };
}

const tagsOf = n => { try { return (JSON.parse(n.tags || '[]') || []).filter(t => String(t).toLowerCase() !== 'template'); } catch { return []; } };

/** Fill a template into { title, rich_content, content, tags } for a new note. */
export function renderTemplate(tpl, vars) {
  const html = fillTemplate(typeof tpl.html === 'string' ? tpl.html : templateHtml(tpl), vars);
  return { rich_content: html, content: htmlToMarkdown(html), tags: tpl.tags ?? tagsOf(tpl) };
}

/** A new note from a template (in `parentId`, or at the top level), opened. */
export async function newNoteFromTemplate(tplNote, { parentId = null } = {}) {
  const ws = useStore.getState().activeWorkspace;
  if (!ws) throw new Error('Pick a workspace first');
  const titles = (await getWorkspaceNotes(ws.id)).map(n => n.title);
  const vars = dateVars();
  // A title with fields ("Standup {{date_short}}") is filled in; otherwise "Weekly review – Nov 2".
  let title = /\{\{/.test(tplNote.title) ? fillText(tplNote.title, vars) : datedName(tplNote.title, titles);
  if (titles.some(t => t.toLowerCase() === title.toLowerCase())) title = datedName(title, titles);
  const note = await createNote({ workspace_id: ws.id, parent_id: parentId, title, editor_mode: 'rich' });
  const r = renderTemplate(tplNote, { ...vars, title });
  await saveNote(note.id, r);
  await openNote(note.id);
  useStore.getState().setView('editor');
  return note;
}

/** HTML to insert into an open note. */
export function templateForInsert(tplNote, noteTitle) {
  return fillTemplate(templateHtml(tplNote), { ...dateVars(), title: noteTitle || '' });
}

/** Copy a template into another of my workspaces (its Templates folder). */
export async function copyTemplateToWorkspace(tplNote, workspaceId) {
  const folder = await ensureFolder(workspaceId);
  const titles = (await listTemplates(workspaceId)).map(t => t.title.toLowerCase());
  let title = tplNote.title;
  for (let i = 2; titles.includes(title.toLowerCase()); i++) title = `${tplNote.title} (${i})`;
  const n = await createNote({ workspace_id: workspaceId, parent_id: folder.id, title, editor_mode: tplNote.editor_mode || 'rich' });
  await saveNote(n.id, { rich_content: tplNote.rich_content, content: tplNote.content || '', tags: ['template', ...tagsOf(tplNote)] });
  return n;
}

/** Send a copy of a template to someone else on this server (lands in their Templates folder). */
export async function sendTemplateToPerson(tplNote, userId) {
  const { data } = await api.post(`/notes/${tplNote.id}/send-template`, { user_id: userId });
  return data;
}
