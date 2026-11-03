// Copies of backups in OneDrive or Google Drive (Settings → Server → Backups → "Also copy to").
//
// The admin who turns it on picks one of *their own* connected drives (Settings → Connected drives);
// every automatic and "Back up now" backup is then uploaded into a "Synapse Backups" folder there.
// The cloud keeps its own number of automatic backups (default 7) — older ones are deleted there.
// Failed uploads are retried (every 15 min, for about 3 hours). A backup on the drive can be copied
// back to this server (e.g. a new server after the old one died) and restored as usual.
//
// Settings: backup_cloud = {provider, user_id, account, folder_id, folder_name, keep}
//           backup_cloud_last = result of the last upload, backup_cloud_queue = [{name, tries, next}]
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { db } from './db/index.js';
import { getSetting, setSetting } from './settings.js';
import { backupDrive, driveLabel, connectedDrives, drivesConfigured, FileError } from './files.js';
import { BACKUP_DIR, BackupError, listBackups, backupPath, adoptUpload } from './backups.js';

const FOLDER = 'Synapse Backups';
const AUTO_RE = /^synapse-backup-\d{4}-\d\d-\d\d-\d{4}\.tar\.gz(\.enc)?$/;
const NAME_RE = /^synapse-backup-[A-Za-z0-9._-]{1,120}\.tar\.gz(\.enc)?$/;
const RETRY_MS = 15 * 60_000;
const MAX_TRIES = 12;

const readJson = (k, d) => { try { return JSON.parse(getSetting(k) || 'null') ?? d; } catch { return d; } };
const target = () => readJson('backup_cloud', null);
const queue = () => readJson('backup_cloud_queue', []);
const saveQueue = q => setSetting('backup_cloud_queue', JSON.stringify(q));

let uploading = null; // { name, done, total }
let working = null;   // the running queue pass (one at a time)

const asBackupError = err => (err instanceof BackupError ? err : new BackupError(err instanceof FileError ? err.status : 500, err.message));
function ownerOf(t) {
  const u = t && db.prepare('SELECT id, username FROM users WHERE id=?').get(t.user_id);
  if (!u) throw new BackupError(400, 'The admin who set up cloud backups no longer exists — turn it on again');
  return u;
}

export function cloudStatus(admin) {
  const t = target();
  return {
    target: t ? { provider: t.provider, label: driveLabel(t.provider), account: t.account, folder: t.folder_name, keep: t.keep, by_me: t.user_id === admin.id,
      by: db.prepare('SELECT username, display_name FROM users WHERE id=?').get(t.user_id) || null } : null,
    my_drives: connectedDrives(admin.id),      // drives this admin could send backups to
    configured: drivesConfigured(),            // drives set up on the server at all
    last: readJson('backup_cloud_last', null),
    waiting: queue().map(q => q.name),
    uploading,
  };
}

/** Turn it on ({provider, keep}), change how many to keep ({keep}) or turn it off ({off: true}). */
export async function setCloud(admin, body = {}) {
  if (body.off) {
    db.prepare("DELETE FROM settings WHERE key IN ('backup_cloud','backup_cloud_queue')").run();
    return;
  }
  const keep = body.keep === undefined ? undefined : Math.round(Number(body.keep));
  if (keep !== undefined && !(keep >= 1 && keep <= 365)) throw new BackupError(400, 'Keep between 1 and 365 backups');
  if (body.provider) {
    const drive = connectedDrives(admin.id).find(d => d.provider === body.provider);
    if (!drive) throw new BackupError(400, `Connect your ${driveLabel(body.provider)} first (Settings → Connected drives)`);
    let folder;
    try { folder = await backupDrive(body.provider).ensureFolder(admin, FOLDER); } catch (err) { throw asBackupError(err); }
    const old = target();
    setSetting('backup_cloud', JSON.stringify({
      provider: body.provider, user_id: admin.id, account: drive.account, folder_id: folder.id, folder_name: folder.name,
      keep: keep ?? old?.keep ?? 7,
    }));
    if (!old || old.provider !== body.provider || old.user_id !== admin.id) saveQueue([]);
    return;
  }
  const t = target();
  if (!t) throw new BackupError(400, 'Cloud backups are off');
  if (keep !== undefined) setSetting('backup_cloud', JSON.stringify({ ...t, keep }));
}

/** Called after each backup: queue it for upload (automatic and "Back up now" ones). */
export function afterBackup(name, kind) {
  if (!target() || !['automatic', 'manual'].includes(kind)) return;
  enqueue(name);
}
function enqueue(name) {
  const q = queue().filter(x => x.name !== name);
  q.push({ name, tries: 0, next: 0 });
  saveQueue(q);
  processQueue().catch(() => {});
}

/** "Copy to cloud" for one backup in the list. */
export function copyToCloud(name) {
  if (!target()) throw new BackupError(400, 'Turn on cloud backups first');
  backupPath(name); // exists, valid name
  enqueue(name);
}

async function uploadOne(t, name) {
  const user = ownerOf(t);
  const drive = backupDrive(t.provider);
  const file = backupPath(name);
  const started = Date.now();
  uploading = { name, done: 0, total: fs.statSync(file).size };
  try {
    let r;
    try {
      r = await drive.upload(user, t.folder_id, file, name, (done, total) => { uploading = { name, done, total }; });
    } catch (err) {
      // The folder was deleted or moved on the drive: make a new one and try once more.
      if (err.status !== 404) throw err;
      const folder = await drive.ensureFolder(user, FOLDER);
      t = { ...t, folder_id: folder.id, folder_name: folder.name };
      setSetting('backup_cloud', JSON.stringify(t));
      r = await drive.upload(user, t.folder_id, file, name, (done, total) => { uploading = { name, done, total }; });
    }
    const removed = AUTO_RE.test(name) ? await prune(t, user).catch(() => 0) : 0;
    setSetting('backup_cloud_last', JSON.stringify({ ok: true, at: Math.floor(started / 1000), name, size: r.size, seconds: Math.round((Date.now() - started) / 100) / 10, removed, label: driveLabel(t.provider) }));
    console.log(`☁️  Backup copied to ${driveLabel(t.provider)}: ${name}${removed ? ` (removed ${removed} older)` : ''}`);
  } finally { uploading = null; }
}

/** Keep the newest `keep` automatic backups in the cloud folder; delete the rest there. */
async function prune(t, user) {
  const drive = backupDrive(t.provider);
  const autos = (await drive.list(user, t.folder_id)).filter(f => AUTO_RE.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
  let n = 0;
  for (const f of autos.slice(t.keep)) { await drive.remove(user, f.id); n++; }
  return n;
}

export function processQueue() {
  working ||= (async () => {
    for (;;) {
      const t = target();
      if (!t) return;
      const q = queue();
      const item = q.find(x => x.next <= Date.now());
      if (!item) return;
      try {
        await uploadOne(t, item.name);
        saveQueue(queue().filter(x => x.name !== item.name));
      } catch (err) {
        const gone = err instanceof BackupError && err.status === 404; // deleted on the server meanwhile
        const tries = item.tries + 1;
        const rest = queue().filter(x => x.name !== item.name);
        const giveUp = gone || tries >= MAX_TRIES;
        saveQueue(giveUp ? rest : [...rest, { name: item.name, tries, next: Date.now() + RETRY_MS }]);
        setSetting('backup_cloud_last', JSON.stringify({
          ok: false, at: Math.floor(Date.now() / 1000), name: item.name, label: driveLabel(t.provider),
          error: err.message, retrying: !giveUp,
        }));
        console.error(`❌ Copying ${item.name} to ${driveLabel(t.provider)} failed${giveUp ? '' : ' (will retry)'}:`, err.message);
      }
    }
  })().finally(() => { working = null; });
  return working;
}

/** Backups in the cloud folder, marked with whether this server has them too. */
export async function listCloud() {
  const t = target();
  if (!t) throw new BackupError(400, 'Cloud backups are off');
  try {
    const here = new Set(listBackups().map(b => b.name));
    const files = await backupDrive(t.provider).list(ownerOf(t), t.folder_id);
    return files.filter(f => NAME_RE.test(f.name)).sort((a, b) => b.name.localeCompare(a.name))
      .map(f => ({ ...f, on_server: here.has(f.name), automatic: AUTO_RE.test(f.name) }));
  } catch (err) { throw asBackupError(err); }
}

/** Copy a backup from the cloud folder to this server's backups (then it can be restored). */
export async function fetchFromCloud(id) {
  const t = target();
  if (!t) throw new BackupError(400, 'Cloud backups are off');
  const user = ownerOf(t);
  const drive = backupDrive(t.provider);
  let f;
  try { f = (await drive.list(user, t.folder_id)).find(x => x.id === id); } catch (err) { throw asBackupError(err); }
  if (!f || !NAME_RE.test(f.name)) throw new BackupError(404, 'That backup isn’t in the cloud folder');
  if (listBackups().some(b => b.name === f.name)) return f.name;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = path.join(BACKUP_DIR, `.cloud-${Date.now()}-${Math.random().toString(36).slice(2)}.partial`);
  try {
    await pipeline(await drive.download(user, f.id), fs.createWriteStream(tmp));
    return adoptUpload(tmp, f.name);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw asBackupError(err);
  }
}

export function startCloudBackups() {
  try { for (const n of fs.readdirSync(BACKUP_DIR)) if (n.startsWith('.cloud-')) fs.rmSync(path.join(BACKUP_DIR, n), { force: true }); } catch { /* no folder yet */ }
  setTimeout(() => processQueue().catch(() => {}), 90_000).unref();
  setInterval(() => processQueue().catch(() => {}), 5 * 60_000).unref();
}
