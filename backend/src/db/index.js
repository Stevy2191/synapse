import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DATA_DIR, UPLOADS_DIR } from '../config.js';

const DB_PATH = path.join(DATA_DIR, 'synapse.db');

const db = new Database(DB_PATH);
// On a network share (SMB/NFS), SQLite's shared-memory WAL index doesn't work reliably.
// Exclusive locking keeps that index in this process's memory instead; it's safe because
// only this one Synapse server ever opens the database. Must be set before journal_mode.
if (process.env.SYNAPSE_NETWORK_STORAGE === 'true') {
  db.pragma('locking_mode = EXCLUSIVE');
}
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
// Two-step verification
addColumn('users', `totp_secret TEXT`);          // base32; set while setting up, kept once enabled
addColumn('users', `totp_enabled INTEGER NOT NULL DEFAULT 0`);
addColumn('users', `totp_last_step INTEGER NOT NULL DEFAULT 0`); // stops a code being used twice
db.exec(`
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,                -- credential ID (base64url)
    user_id TEXT NOT NULL,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL DEFAULT 'Passkey',
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
  CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
`);
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
  // 3: The redesign's default theme is "auto" (Neural, following the device's light/dark
  // setting). Move people still on the old default over; other choices are kept.
  () => {
    db.exec(`UPDATE users SET theme='auto' WHERE theme='dark'`);
  },
  // 4: The Outline-style editor ("Write") becomes the default for text notes. Notes that were in
  // Markdown mode switch to it; their Markdown stays the source and the app converts it on
  // open (rich_content is cleared so stale HTML from an old mode switch can't win). The version
  // bump makes every device download the change.
  () => {
    db.exec(`UPDATE notes SET editor_mode='rich', rich_content=NULL, version=version+1
             WHERE editor_mode='markdown' AND note_type='note'`);
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
