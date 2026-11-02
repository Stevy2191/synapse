// Tasks → Board: Trello-style columns. "To do" and "Done" are built in (Done = ticked); other columns
// (Doing, and any you add) are written into the task as "🗂 <key>". Columns are saved in the workspace's
// settings (`board`), so every device shows the same board; changing them needs a connection.
import api from '../api';
import { useStore } from '../stores/useStore';
import { workspaceSettings } from '../components/Avatar';
import { syncNow } from '../offline/sync';
import { listTasks, updateTask } from '../offline/tasks';

export const DEFAULT_COLUMNS = [
  { key: 'todo', name: 'To do' },
  { key: 'doing', name: 'Doing' },
  { key: 'done', name: 'Done' },
];
export const COLUMN_COLORS = ['#7c7bff', '#3b9eff', '#2fb67c', '#f2a93b', '#e5534b', '#c061cb', '#8a8f98'];

export function boardOf(ws) {
  const b = workspaceSettings(ws).board;
  return Array.isArray(b?.columns) && b.columns.length ? b.columns : DEFAULT_COLUMNS;
}

export async function saveBoard(columns) {
  const { activeWorkspace, workspaces, setWorkspaces } = useStore.getState();
  if (!activeWorkspace) return null;
  const { data } = await api.patch(`/workspaces/${activeWorkspace.id}`, { settings: { board: { columns } } });
  setWorkspaces(workspaces.map(w => (w.id === data.workspace.id ? data.workspace : w)));
  useStore.setState({ activeWorkspace: data.workspace });
  syncNow();
  return boardOf(data.workspace);
}

/** Which column a task is in (unknown columns → To do). */
export function columnOf(task, columns) {
  if (task.done) return 'done';
  if (task.status && columns.some(c => c.key === task.status)) return task.status;
  return 'todo';
}

/** Move a task to a column. Returns updateTask's result ({ next } when a repeating task moved on). */
export function moveTask(workspaceId, task, key) {
  if (key === 'done') return updateTask(workspaceId, task, { done: true });
  const status = key === 'todo' ? null : key;
  return updateTask(workspaceId, task, task.done ? { done: false, status } : { status });
}

/** A short key for a new column name ("Waiting on Bob" → "waiting-on-bob"), unique among `columns`. */
export function columnKey(name, columns) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 30) || 'list';
  const taken = new Set(columns.map(c => c.key));
  let key = /^[a-z0-9]/.test(base) ? base : `l-${base}`;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 26)}-${i}`;
  return key;
}

/** Deleting a column: its open tasks go back to To do (their "🗂 key" is removed). */
export async function emptyColumn(workspaceId, key) {
  const tasks = (await listTasks(workspaceId)).filter(t => !t.done && t.status === key);
  // Later tasks in the same note first, so earlier indexes stay valid.
  tasks.sort((a, b) => (a.noteId === b.noteId ? b.index - a.index : 0));
  for (const t of tasks) await updateTask(workspaceId, t, { status: null });
  return tasks.length;
}
