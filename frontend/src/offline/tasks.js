// Tasks are the checklist items in your notes ("- [ ] …" / ☐). A due date is written in the
// task's own text as "📅 2026-11-04", so it survives Markdown, copying and exporting.
//
// Notes in Write mode keep HTML as their source, so they're read and changed through the DOM
// (keeping colours and other formatting); Markdown-mode notes are changed line by line.
import { getWorkspaceNotes, saveNote, openNote } from './sync';
import { useStore } from '../stores/useStore';
import { htmlToMarkdown, markdownToHtml } from '../components/editor/convert';
import { DUE, WHEN_REGEXES, splitWhen, whenTokens, setWhen, nextDue } from './taskWhen';

export { DUE };
const MD_TASK = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)(.*)$/;

const hasText = html => !!(html || '').replace(/<[^>]+>/g, '').trim();
const isRich = note => note.editor_mode === 'rich';
/** The HTML a Write-mode note shows (older notes may only have Markdown saved). */
const richHtml = note => (hasText(note.rich_content) || !(note.content || '').trim() ? (note.rich_content || '') : markdownToHtml(note.content));
const parse = html => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

// { text, due, time, repeat } — see taskWhen.js for the 📅 / ⏰ / 🔁 tokens.
const splitDue = splitWhen;

/** The task's own line of text (without any list nested under it). */
function itemText(li) {
  const p = li.querySelector(':scope > div > p, :scope > p') || li;
  return p.textContent || '';
}

function richItems(doc) {
  return [...doc.querySelectorAll('li[data-type="taskItem"]')];
}

function mdLines(md) {
  const lines = (md || '').split('\n');
  const tasks = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = line.match(MD_TASK);
    if (m) tasks.push({ line: i, done: m[2] !== ' ', text: m[4] });
  });
  return { lines, tasks };
}

/** Every task in the workspace: { noteId, noteTitle, index, text, done, due }. */
export async function listTasks(workspaceId) {
  const out = [];
  for (const note of await getWorkspaceNotes(workspaceId)) {
    if (note.note_type && note.note_type !== 'note') continue;
    let tags = [];
    try { tags = JSON.parse(note.tags || '[]').map(t => String(t).toLowerCase().replace(/^#/, '')); } catch {}
    // A note tagged #no-tasks (a recipe, a packing list…) never shows in Tasks.
    if (tags.includes('no-tasks')) continue;
    // Tasks from meeting and daily notes always show; others only once they have a due date.
    const kind = tags.includes('meeting') ? 'meeting' : (tags.includes('daily') || /^\d{4}-\d{2}-\d{2}$/.test(note.title)) ? 'daily' : null;
    let found = [];
    if (isRich(note)) {
      const html = richHtml(note);
      if (!html.includes('taskItem') && !html.includes('checkbox')) continue;
      found = richItems(parse(html)).map(li => ({ raw: itemText(li), done: li.getAttribute('data-checked') === 'true' }));
    } else {
      if (!/\[[ xX]\]/.test(note.content || '')) continue;
      found = mdLines(note.content).tasks.map(t => ({ raw: t.text, done: t.done }));
    }
    found.forEach((t, index) => {
      const { text, due, time, repeat, priority, status } = splitDue(t.raw);
      if (!text) return; // empty placeholder items
      out.push({ noteId: note.id, noteTitle: note.title, index, text, done: t.done, due, time, repeat, priority, status, kind, updatedAt: note.updated_at });
    });
  }
  return out;
}

async function getNote(workspaceId, noteId) {
  return (await getWorkspaceNotes(workspaceId)).find(n => n.id === noteId) || null;
}

/** Save new content; if the note is open, show the change there too. */
async function writeBack(note, { html, md }) {
  if (isRich(note)) {
    await saveNote(note.id, { rich_content: html, content: htmlToMarkdown(html) });
  } else {
    await saveNote(note.id, { content: md });
  }
  if (useStore.getState().activeNote?.note?.id === note.id) await openNote(note.id);
}

function setDueInText(raw, due) {
  return setWhen(raw, { ...splitWhen(raw), due });
}

const WHEN_KEYS = ['due', 'time', 'repeat', 'priority', 'status'];

/**
 * Change one task: { done?, due?: 'YYYY-MM-DD' | null, time?: 'HH:MM' | null, repeat?: 'every …' | null }.
 * Ticking a repeating task moves it to its next date instead (it stays unticked); returns { next } then.
 * The task's text guards against edits made meanwhile.
 */
export async function updateTask(workspaceId, task, change) {
  const note = await getNote(workspaceId, task.noteId);
  if (!note) throw new Error('That note no longer exists');
  change = { ...change };
  let result = {};
  const rich = isRich(note);
  const doc = rich ? parse(richHtml(note)) : null;
  const md = rich ? null : mdLines(note.content);
  const li = rich ? richItems(doc)[task.index] : null;
  const mdt = rich ? null : md.tasks[task.index];
  const raw = rich ? (li ? itemText(li) : null) : (mdt ? mdt.text : null);
  if (raw == null || splitDue(raw).text !== task.text) throw new Error('The note changed — refresh and try again');
  const cur = splitDue(raw);
  if (change.done && cur.repeat) {
    const next = nextDue(cur.due, cur.repeat);
    if (next) { delete change.done; change.due = next; change.status = null; result = { next }; }
  }
  const when = WHEN_KEYS.some(k => k in change) ? { due: cur.due, time: cur.time, repeat: cur.repeat, priority: cur.priority, status: cur.status, ...Object.fromEntries(WHEN_KEYS.filter(k => k in change).map(k => [k, change[k] || null])) } : null;
  if (rich) {
    if ('done' in change) {
      li.setAttribute('data-checked', change.done ? 'true' : 'false');
      const box = li.querySelector(':scope > label input[type="checkbox"]');
      if (box) { if (change.done) box.setAttribute('checked', 'checked'); else box.removeAttribute('checked'); }
    }
    if (when) {
      const p = li.querySelector(':scope > div > p, :scope > p');
      if (p) {
        // Remove the old date / time / repeat from the text nodes, then add the new ones at the end.
        const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const n of nodes) {
          n.textContent = WHEN_REGEXES.reduce((acc, re) => acc.replace(new RegExp(re.source, `${re.flags}g`), ''), n.textContent);
        }
        const last = nodes[nodes.length - 1];
        if (last) last.textContent = last.textContent.replace(/\s+$/, '');
        const tokens = whenTokens(when);
        if (tokens) p.appendChild(doc.createTextNode(tokens));
      }
    }
    await writeBack(note, { html: doc.body.innerHTML });
  } else {
    const { lines } = md;
    const m = lines[mdt.line].match(MD_TASK);
    let text = m[4];
    if (when) text = setWhen(text, when);
    const mark = 'done' in change ? (change.done ? 'x' : ' ') : m[2];
    lines[mdt.line] = `${m[1]}${mark}${m[3]}${text}`;
    await writeBack(note, { md: lines.join('\n') });
  }
  return result;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Add a task to a note, in the checklist under `heading` (e.g. "Action items"). The heading
 * and list are created at the end of the note if they aren't there. An empty "☐" placeholder
 * in that list is filled in instead of adding another line.
 */
export async function addTaskToNote(workspaceId, noteId, heading, text, due, extra = {}) {
  const note = await getNote(workspaceId, noteId);
  if (!note) throw new Error('That note no longer exists');
  const line = setWhen(text.trim(), { ...splitWhen(text.trim()), due: due || null, ...extra });
  if (isRich(note)) {
    const doc = parse(richHtml(note));
    const body = doc.body;
    const h = [...body.querySelectorAll('h1, h2, h3')].find(x => x.textContent.trim().toLowerCase() === heading.toLowerCase());
    let list = null;
    if (h) {
      for (let el = h.nextElementSibling; el && !/^H[1-3]$/.test(el.tagName); el = el.nextElementSibling) {
        if (el.matches('ul[data-type="taskList"]')) list = el;
      }
    }
    const item = doc.createElement('li');
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', 'false');
    item.innerHTML = `<p>${esc(line)}</p>`;
    if (list) {
      const empty = [...list.children].find(li => !itemText(li).trim());
      if (empty) empty.replaceWith(item); else list.appendChild(item);
    } else {
      list = doc.createElement('ul');
      list.setAttribute('data-type', 'taskList');
      list.appendChild(item);
      if (h) {
        let after = h;
        while (after.nextElementSibling && !/^H[1-3]$/.test(after.nextElementSibling.tagName)) after = after.nextElementSibling;
        // Put the list straight after the heading's text, before trailing empty paragraphs.
        while (after !== h && after.tagName === 'P' && !after.textContent.trim()) after = after.previousElementSibling;
        after.after(list);
      } else {
        const hh = doc.createElement('h2');
        hh.textContent = heading;
        body.append(hh, list);
      }
    }
    await writeBack(note, { html: body.innerHTML });
  } else {
    const lines = (note.content || '').split('\n');
    const hi = lines.findIndex(l => l.replace(/^#+\s*/, '').trim().toLowerCase() === heading.toLowerCase() && /^#{1,3}\s/.test(l));
    const newLine = `- [ ] ${line}`;
    if (hi < 0) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('', `## ${heading}`, newLine, '');
    } else {
      let end = hi + 1;
      while (end < lines.length && !/^#{1,3}\s/.test(lines[end])) end++;
      const empty = lines.slice(hi + 1, end).findIndex(l => /^\s*[-*+]\s+\[ \]\s*$/.test(l));
      if (empty >= 0) lines[hi + 1 + empty] = newLine;
      else {
        let at = end;
        while (at > hi + 1 && !lines[at - 1].trim()) at--;
        lines.splice(at, 0, newLine);
      }
    }
    await writeBack(note, { md: lines.join('\n') });
  }
}

/**
 * Put `text` (e.g. "9:00 AM — [[Team standup · Nov 4, 2026]]") in the bullet list under
 * `heading`, replacing the item whose plain text `matches`, or adding it (in place of a "(none)" item).
 */
export async function upsertListItem(workspaceId, noteId, heading, text, matches) {
  const note = await getNote(workspaceId, noteId);
  if (!note) return;
  if (isRich(note)) {
    const doc = parse(richHtml(note));
    const body = doc.body;
    let h = [...body.querySelectorAll('h1, h2, h3')].find(x => x.textContent.trim().toLowerCase() === heading.toLowerCase());
    if (!h) { h = doc.createElement('h2'); h.textContent = heading; body.appendChild(h); }
    let list = null;
    for (let el = h.nextElementSibling; el && !/^H[1-3]$/.test(el.tagName); el = el.nextElementSibling) {
      if (el.tagName === 'UL' && el.getAttribute('data-type') !== 'taskList') { list = el; break; }
    }
    if (!list) { list = doc.createElement('ul'); h.after(list); }
    const items = [...list.children];
    const hit = items.find(li => matches(li.textContent.trim())) || items.find(li => /^\(none\)$/.test(li.textContent.trim()));
    if (hit && hit.textContent.trim() === text) return;
    const li = doc.createElement('li');
    li.innerHTML = `<p>${esc(text)}</p>`;
    if (hit) hit.replaceWith(li); else list.appendChild(li);
    await writeBack(note, { html: body.innerHTML });
  } else {
    const lines = (note.content || '').split('\n');
    let hi = lines.findIndex(l => /^#{1,3}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === heading.toLowerCase());
    if (hi < 0) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('', `## ${heading}`);
      hi = lines.length - 1;
    }
    let end = hi + 1;
    while (end < lines.length && !/^#{1,3}\s/.test(lines[end])) end++;
    const bullet = l => (l.match(/^\s*[-*+]\s+(?!\[[ xX]\])(.*)$/) || [])[1];
    const section = lines.slice(hi + 1, end);
    let idx = section.findIndex(l => bullet(l) != null && matches(bullet(l).trim()));
    if (idx < 0) idx = section.findIndex(l => bullet(l)?.trim() === '(none)');
    const line = `- ${text}`;
    if (idx >= 0) {
      if (section[idx] === line) return;
      lines[hi + 1 + idx] = line;
    } else {
      let at = end;
      while (at > hi + 1 && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, line);
    }
    await writeBack(note, { md: lines.join('\n') });
  }
}

/** "YYYY-MM-DD" for a Date in local time. */
export function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
