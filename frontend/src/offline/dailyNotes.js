// Daily notes and meeting notes, Obsidian-style.
//   Daily note:   titled "2026-11-01", kept inside a "Daily notes" folder note.
//   Meeting note: titled "Team standup · 2026-11-01", kept inside that day's note, linking back to it.
import toast from 'react-hot-toast';
import { useStore } from '../stores/useStore';
import { createNote, saveNote, openNote, getWorkspaceNotes } from './sync';
import { dayKey, timeRange } from './calendar';

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
  const key = dayKey(date);
  let note = await findByTitle(workspaceId, key);
  if (!note) {
    const folder = await dailyFolder(workspaceId);
    note = await createNote({ workspace_id: workspaceId, parent_id: folder.id, title: key });
    const meetings = dayEvents.length
      ? dayEvents.map(e => `- ${timeRange(e)} — ${cleanTitle(e.title)}`).join('\n')
      : '- (none)';
    await saveNote(note.id, { content: `*${longDate(date)}*\n\n## Meetings\n${meetings}\n\n## Notes\n\n` });
  }
  await openNote(note.id);
  return note;
}

/** Open (or create) a note for a calendar event, inside that day's daily note. */
export async function openMeetingNote(event, date, dayEvents = []) {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return null;
  const key = dayKey(date);
  const title = `${cleanTitle(event.title)} · ${key}`;
  let note = await findByTitle(workspaceId, title);
  if (!note) {
    let day = await findByTitle(workspaceId, key);
    if (!day) {
      // Create the daily note too, without switching to it.
      const folder = await dailyFolder(workspaceId);
      day = await createNote({ workspace_id: workspaceId, parent_id: folder.id, title: key });
      const meetings = dayEvents.map(e => `- ${timeRange(e)} — ${cleanTitle(e.title)}`).join('\n') || '- (none)';
      await saveNote(day.id, { content: `*${longDate(date)}*\n\n## Meetings\n${meetings}\n\n## Notes\n\n` });
    }
    note = await createNote({ workspace_id: workspaceId, parent_id: day.id, title });
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
  }
  await openNote(note.id);
  return note;
}
