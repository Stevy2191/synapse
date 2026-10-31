import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DATA_DIR, UPLOADS_DIR } from '../config.js';

const DB_PATH = path.join(DATA_DIR, 'synapse.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    theme TEXT NOT NULL DEFAULT 'dark',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🧠',
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    parent_id TEXT,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES notes(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS note_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    title,
    content,
    tokenize='porter ascii'
  );

  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    DELETE FROM notes_fts WHERE id=old.id;
  END;
`);

// Older databases were created before these columns existed.
function addColumn(table, ddl) {
  const name = ddl.split(/\s+/)[0];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('notes', `editor_mode TEXT NOT NULL DEFAULT 'markdown'`);
addColumn('notes', `note_type TEXT NOT NULL DEFAULT 'note'`);
addColumn('notes', `canvas_data TEXT`);
addColumn('notes', `rich_content TEXT`);
addColumn('users', `token_version INTEGER NOT NULL DEFAULT 0`);
// Offline sync: `version` goes up on every content change so devices can detect conflicts,
// and `last_op_id` makes retried saves idempotent.
addColumn('notes', `version INTEGER NOT NULL DEFAULT 1`);
addColumn('notes', `last_op_id TEXT`);

/** Plain text used for search and [[link]] detection, covering both markdown and rich-text notes. */
export function searchableText(note) {
  const rich = (note.rich_content || '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return note.editor_mode === 'rich' ? `${rich}\n${note.content || ''}` : `${note.content || ''}\n${rich}`;
}

const ftsDelete = db.prepare('DELETE FROM notes_fts WHERE id=?');
const ftsInsert = db.prepare('INSERT INTO notes_fts(id, title, content) VALUES (?,?,?)');

export function indexNote(note) {
  ftsDelete.run(note.id);
  ftsInsert.run(note.id, note.title, searchableText(note));
}

// Versioned migrations. PRAGMA user_version records the last one applied.
const migrations = [
  // 1: Index rich-text content for search. Search indexing moves from SQL triggers to indexNote().
  () => {
    db.exec(`
      DROP TRIGGER IF EXISTS notes_ai;
      DROP TRIGGER IF EXISTS notes_au;
      DROP TRIGGER IF EXISTS add_editor_mode_if_missing;
      DELETE FROM notes_fts;
    `);
    for (const note of db.prepare('SELECT * FROM notes').all()) indexNote(note);
  },
  // 2: Indexes for the lookups every request makes.
  () => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes(parent_id);
      CREATE INDEX IF NOT EXISTS idx_links_source ON note_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_links_target ON note_links(target_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
      CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
    `);
  },
];

const currentVersion = db.pragma('user_version', { simple: true });
for (let v = currentVersion; v < migrations.length; v++) {
  db.transaction(() => {
    migrations[v]();
    db.pragma(`user_version = ${v + 1}`);
  })();
}

/** Delete attachment files from disk. Call after the DB rows are gone (or about to be). */
export function removeUploadFiles(filenames) {
  for (const f of filenames) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(f))); } catch {}
  }
}

export { db, UPLOADS_DIR };
