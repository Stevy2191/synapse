// Finishing a restore. Restoring from Settings → Server → Backups unpacks the backup into
// DATA_DIR/restore-pending and restarts Synapse; here — before the database is opened — the
// unpacked copy replaces the live database and uploaded files. (A safety backup of what was there
// before is made first, by backups.js.) Imports nothing that opens the database.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, UPLOADS_DIR } from './config.js';

export const PENDING_DIR = path.join(DATA_DIR, 'restore-pending');
export const FIXUPS_FILE = path.join(DATA_DIR, 'restore-fixups.json');

export function applyPendingRestore() {
  if (!fs.existsSync(PENDING_DIR)) return;
  // Only a completely unpacked and checked backup has the "ready" marker.
  if (!fs.existsSync(path.join(PENDING_DIR, 'ready')) || !fs.existsSync(path.join(PENDING_DIR, 'synapse.db'))) {
    fs.rmSync(PENDING_DIR, { recursive: true, force: true });
    return;
  }
  console.log('♻️  Restoring a backup…');
  const dbPath = path.join(DATA_DIR, 'synapse.db');
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(dbPath + suffix, { force: true });
  fs.renameSync(path.join(PENDING_DIR, 'synapse.db'), dbPath);

  const oldUploads = path.join(DATA_DIR, 'uploads.before-restore');
  fs.rmSync(oldUploads, { recursive: true, force: true });
  if (fs.existsSync(UPLOADS_DIR)) fs.renameSync(UPLOADS_DIR, oldUploads);
  const newUploads = path.join(PENDING_DIR, 'uploads');
  if (fs.existsSync(newUploads)) fs.renameSync(newUploads, UPLOADS_DIR);
  else fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.rmSync(oldUploads, { recursive: true, force: true });

  const fixups = path.join(PENDING_DIR, 'fixups.json');
  if (fs.existsSync(fixups)) fs.renameSync(fixups, FIXUPS_FILE);
  fs.rmSync(PENDING_DIR, { recursive: true, force: true });
  console.log('♻️  Backup restored.');
}
