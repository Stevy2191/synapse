import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DATA_DIR, UPLOADS_DIR } from '../config.js';
import { applyPendingRestore } from '../restore.js';
import { noteImages } from '../imagehash.js';

const DB_PATH = path.join(DATA_DIR, 'synapse.db');

// ───────────────────────── opening the database ─────────────────────────
// Is the data folder on a network share (NFS / SMB …)? The installer says so for its own share
// option; a plain folder that happens to be an NFS/SMB mount is detected here from /proc/mounts.
const NETWORK_FS = /^(nfs4?|cifs|smb3?|smbfs|fuse\.sshfs|9p|afs|ceph|glusterfs|fuse\.glusterfs|fuse\.rclone|davfs)$/;
function mountOf(dir) {
  try {
    let real = dir;
    try { real = fs.realpathSync(dir); } catch { /* not created yet */ }
    let best = { point: '', type: '', options: '' };
    for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const [, point, type, options = ''] = line.split(' ');
      if (!point) continue;
      const p = point.replace(/\\040/g, ' ');
      if ((real === p || real.startsWith(p.endsWith('/') ? p : `${p}/`)) && p.length > best.point.length) best = { point: p, type, options };
    }
    return best;
  } catch { return { point: '', type: '', options: '' }; } // not Linux
}
const mount = mountOf(DATA_DIR);
const fsType = mount.type;
const mountOpts = mount.options.split(',');
// The most common cause of "database is locked" on a share, with the exact fix.
function lockAdvice() {
  if (/^(cifs|smb3?|smbfs)$/.test(fsType) && !mountOpts.includes('nobrl')) {
    return `
    → Your data folder is on an SMB share mounted WITHOUT the "nobrl" option, so the NAS is being
      asked to lock the database file and is refusing. Add ",nobrl" to that share's mount options on
      the server (usually in /etc/fstab), then remount it and restart Synapse:
        findmnt -T <your notes folder>      (shows how it's mounted)
        sudo nano /etc/fstab                (add ,nobrl to the share's options)
        docker compose down && sudo umount <share> && sudo mount <share> && docker compose up -d`;
  }
  if (/^nfs4?$/.test(fsType) && !mountOpts.includes('nolock') && !mountOpts.some(o => o.startsWith('local_lock='))) {
    return `
    → Your data folder is on an NFS share whose file locking isn't working. Either make sure the NFS
      lock service runs on the server (rpc-statd), or mount the share with the "nolock" option
      (safe here: only Synapse opens the database), then restart Synapse.`;
  }
  return '';
}
if (/^(cifs|smb3?|smbfs)$/.test(fsType) && !mountOpts.includes('nobrl')) {
  console.log('ℹ️  The data folder is on an SMB share without the "nobrl" mount option — if Synapse reports "database is locked", add ,nobrl to that mount.');
}
export const NETWORK_STORAGE = process.env.SYNAPSE_NETWORK_STORAGE === 'true' || NETWORK_FS.test(fsType);
if (NETWORK_STORAGE && process.env.SYNAPSE_NETWORK_STORAGE !== 'true') {
  console.log(`📁 The data folder is on a network share (${fsType}) — using network-safe database settings.`);
}

function openDatabase() {
  const d = new Database(DB_PATH, { timeout: 10_000 });
  try {
    // On a network share, SQLite's shared-memory index (used by WAL) doesn't work. Exclusive
    // locking keeps it in this process's memory instead — safe because only this one Synapse
    // server opens the database. Must be set before journal_mode.
    if (NETWORK_STORAGE) d.pragma('locking_mode = EXCLUSIVE');
    try {
      d.pragma('journal_mode = WAL');
    } catch (err) {
      if (!NETWORK_STORAGE) throw err;
      d.pragma('journal_mode = TRUNCATE'); // some shares can't do WAL at all: classic journal
    }
    return d;
  } catch (err) {
    try { d.close(); } catch { /* ignore */ }
    throw err;
  }
}

// If the database is locked (another Synapse still running on the same data, or a network share
// holding on to an old lock), wait and retry with an explanation rather than crash-looping.
// A restore started from Settings → Server → Backups is finished here, before opening.
try { applyPendingRestore(); } catch (err) { console.error('❌ Could not finish restoring the backup:', err); }

let db;
const MAX_TRIES = 24; // about two and a half minutes
for (let attempt = 1; ; attempt++) {
  try { db = openDatabase(); break; } catch (err) {
    if (err.code !== 'SQLITE_BUSY' && err.code !== 'SQLITE_LOCKED') throw err;
    if (attempt === 1) {
      console.error(`
⚠️  Synapse can't lock its database (${DB_PATH}).
    Usually this means one of:
      • another copy of Synapse is still running with the same data folder
        (check with: docker ps), or
      • the data folder is on a network share (NFS/SMB) that is still holding an old lock,
        or doesn't allow file locking. If it's a network share, set
        SYNAPSE_NETWORK_STORAGE=true in .env (Synapse also detects NFS/SMB by itself).${lockAdvice()}
    Waiting and trying again…`);
    }
    if (attempt >= MAX_TRIES) {
      console.error('❌ Still locked after several minutes — giving up for now. Fix the cause above, then: synapse restart');
      process.exit(1);
    }
    console.error(`    …still locked (try ${attempt}/${MAX_TRIES})`);
    await new Promise(r => setTimeout(r, 6000));
  }
}
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
// Profiles and workspace settings
addColumn('users', `display_name TEXT`);
addColumn('users', `avatar TEXT`);              // small image as a data URL
addColumn('workspaces', `icon_image TEXT`);     // small image as a data URL (else the emoji icon)
addColumn('workspaces', `settings TEXT NOT NULL DEFAULT '{}'`);

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
// Trash: deleted notes keep their place for TRASH_DAYS. `trash_root` is the note that was
// deleted (its sub-notes went with it), so they're restored together.
addColumn('notes', `deleted_at INTEGER`);
addColumn('notes', `trash_root TEXT`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_trash ON notes(deleted_at) WHERE deleted_at IS NOT NULL`);

/** Plain text used for search and [[link]] detection, covering both markdown and rich-text notes. */
// Text read from the pictures in notes (OCR, see ocr.js), keyed by picture hash.
db.exec(`CREATE TABLE IF NOT EXISTS ocr_cache (
  hash TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'eng',
  confidence REAL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
const ocrText = db.prepare('SELECT text FROM ocr_cache WHERE hash=?');

export function searchableText(note) {
  // Diagrams (draw.io / Excalidraw) carry large embedded data; index them as just "[diagram]".
  const content = (note.content || '').replace(/```synapse-diagram\n[\s\S]*?\n```/g, ' [diagram] ');
  const rich = (note.rich_content || '')
    .replace(/<figure[^>]*data-diagram[\s\S]*?<\/figure>/gi, ' [diagram] ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  // Words inside pictures (already read by OCR) are searchable too.
  const pictures = noteImages(note).map(i => ocrText.get(i.hash)?.text).filter(Boolean).join('\n');
  const base = note.editor_mode === 'rich' ? `${rich}\n${content}` : `${content}\n${rich}`;
  return pictures ? `${base}\n${pictures}` : base;
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
