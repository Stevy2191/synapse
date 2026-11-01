// Daily notes and meeting notes, Obsidian-style.
//   Daily note:   titled "2026-11-01", kept inside a "Daily notes" folder note.
//   Meeting note: titled "Team standup · Nov 1, 2026", kept in Meetings › "November 2026",
//                 linked from that day's note (and linking back to it).
import toast from 'react-hot-toast';
import { useStore } from '../stores/useStore';
import { createNote, saveNote, openNote, getWorkspaceNotes } from './sync';
import { dayKey, timeRange } from './calendar';
import { addTaskToNote, upsertListItem } from './tasks';

const FOLDER = 'Daily notes';

const longDate = d => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const cleanTitle = s => String(s || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

function activeWorkspaceId() {
  const ws = useStore.getState().activeWorkspace;
  if (!ws) { toast.error('Pick a workspace first'); return null; }
  return ws.id;
}

async function findByTitle(workspaceId, title) {
  const all = await getWorkspaceNotes(workspaceId);
  return all.find(n => n.title.toLowerCase() === title.toLowerCase()) || null;
}

async function dailyFolder(workspaceId) {
  const existing = (await getWorkspaceNotes(workspaceId)).find(n => !n.parent_id && n.title === FOLDER);
  if (existing) return existing;
  const folder = await createNote({ workspace_id: workspaceId, title: FOLDER, editor_mode: 'markdown' });
  await saveNote(folder.id, { content: 'One note per day, created from the calendar.' });
  return folder;
}

/** Open the daily note for `date`, creating it (listing that day's meetings) if needed. */
export async function openDailyNote(date, dayEvents = []) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const note = await ensureDailyNote(workspaceId, date, dayEvents);
  await openNote(note.id);
  return note;
}

const shortDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthName = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
/** "Team standup · Nov 4, 2026" */
export const meetingTitle = (event, date) => `${cleanTitle(event.title)} · ${shortDate(date)}`;

/** A folder note (created if missing) under `parent` (null = top level). */
async function folder(workspaceId, title, parentId, blurb) {
  const existing = (await getWorkspaceNotes(workspaceId)).find(n => (n.parent_id ?? null) === (parentId ?? null) && n.title === title);
  if (existing) return existing;
  const f = await createNote({ workspace_id: workspaceId, parent_id: parentId ?? null, title, editor_mode: 'markdown' });
  if (blurb) await saveNote(f.id, { content: blurb });
  return f;
}

/** That day's daily note, created (without opening it) if needed. */
async function ensureDailyNote(workspaceId, date, dayEvents) {
  const key = dayKey(date);
  let day = await findByTitle(workspaceId, key);
  if (!day) {
    const f = await dailyFolder(workspaceId);
    day = await createNote({ workspace_id: workspaceId, parent_id: f.id, title: key });
    const lines = [];
    for (const e of dayEvents) {
      // Meetings that already have a note are listed as links to it.
      const mn = await findByTitle(workspaceId, meetingTitle(e, date));
      lines.push(`- ${timeRange(e)} — ${mn ? `[[${mn.title}]]` : cleanTitle(e.title)}`);
    }
    await saveNote(day.id, {
      content: `*${longDate(date)}*\n\n## Meetings\n${lines.join('\n') || '- (none)'}\n\n## To-do\n- [ ] \n\n## Notes\n\n`,
      tags: ['daily'],
    });
  }
  return day;
}

/** List the meeting in the daily note, as a [[link]] when it has a meeting note. */
async function listInDailyNote(workspaceId, event, date, dayEvents, linkTitle) {
  const day = await ensureDailyNote(workspaceId, date, dayEvents);
  const name = cleanTitle(event.title);
  const text = `${timeRange(event)} — ${linkTitle ? `[[${linkTitle}]]` : name}`;
  await upsertListItem(workspaceId, day.id, 'Meetings', text, t => t.includes(name));
  return day;
}

/** The meeting's note, created if needed, in Meetings › "November 2026". Doesn't open it. */
export async function ensureMeetingNote(event, date, dayEvents = []) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const key = dayKey(date);
  const title = meetingTitle(event, date);
  // Notes made before meeting notes had their own folder were titled "Team standup · 2026-11-04".
  let note = await findByTitle(workspaceId, title) || await findByTitle(workspaceId, `${cleanTitle(event.title)} · ${key}`);
  if (note) return note;
  const meetings = await folder(workspaceId, 'Meetings', null, 'Notes from meetings, created from the calendar. One folder per month.');
  const month = await folder(workspaceId, monthName(date), meetings.id);
  note = await createNote({ workspace_id: workspaceId, parent_id: month.id, title });
  const lines = [
    `**When:** ${longDate(date)}, ${timeRange(event)}`,
    event.location && `**Where:** ${event.location}`,
    event.join_url && `**Join:** [Join meeting](${event.join_url})`,
    event.attendees?.length && `**Attendees:** ${event.attendees.map(a => a.name || a.email).join(', ')}`,
    `**Calendar:** ${event.calendar_name}`,
    `**Day:** [[${key}]]`,
  ].filter(Boolean);
  await saveNote(note.id, {
    content: `${lines.join('  \n')}\n\n## Agenda\n\n\n## Notes\n\n\n## Action items\n- [ ] \n`,
    tags: ['meeting'],
  });
  await listInDailyNote(workspaceId, event, date, dayEvents, title);
  return note;
}

/** Open (or create) the meeting's note. */
export async function openMeetingNote(event, date, dayEvents = []) {
  const note = await ensureMeetingNote(event, date, dayEvents);
  if (note) await openNote(note.id);
  return note;
}

/** Add a to-do to the meeting's note (under "Action items"); it shows in Tasks with its due date. */
export async function addMeetingTask(event, date, dayEvents, text, due) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const note = await ensureMeetingNote(event, date, dayEvents);
  if (!note) return null;
  await addTaskToNote(workspaceId, note.id, 'Action items', text, due);
  return note;
}

/** Make sure the meeting is listed in that day's daily note. */
export async function addMeetingToDailyNote(event, date, dayEvents = []) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const existing = await findByTitle(workspaceId, meetingTitle(event, date));
  return listInDailyNote(workspaceId, event, date, dayEvents, existing?.title || null);
}

/** Add a to-do to a day's daily note (used by "Add task" in the Tasks view). */
export async function addDailyTask(date, text, due) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const day = await ensureDailyNote(workspaceId, date, []);
  await addTaskToNote(workspaceId, day.id, 'To-do', text, due);
  return day;
}
