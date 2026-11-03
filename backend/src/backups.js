// Automatic backups (Settings → Server → Backups).
//
// A backup is one file: a .tar.gz holding a consistent copy of the database (taken live with
// SQLite's backup API, so Synapse keeps running), every uploaded file, and a small manifest. With a
// backup password set, the whole file is encrypted (AES-256-GCM, key from the password via scrypt)
// and gets a ".enc" ending — without the password nobody, including us, can open it.
//
// Where: /backups when that folder is mounted into the container (the installer mounts
// ./backups next to the data folder; `synapse backups-to <folder>` points it at a NAS), otherwise
// DATA_DIR/backups. BACKUP_DIR overrides both.
//
// The password itself is never stored. The derived key is kept (encrypted with the server secret)
// so scheduled backups can run unattended; a check value in each backup's header tells us which
// password a backup needs.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import Database from 'better-sqlite3';
import { db } from './db/index.js';
import { DATA_DIR, UPLOADS_DIR, JWT_SECRET } from './config.js';
import { getSetting, setSetting } from './settings.js';
import { aiKeyHex, reencryptAiKeys } from './ai.js';
import { PENDING_DIR, FIXUPS_FILE } from './restore.js';

const APP_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function pickBackupDir() {
  if (process.env.BACKUP_DIR) return path.resolve(process.env.BACKUP_DIR);
  try { if (fs.statSync('/backups').isDirectory()) return '/backups'; } catch { /* not mounted */ }
  return path.join(DATA_DIR, 'backups');
}
export const BACKUP_DIR = pickBackupDir();
// What the folder is called on the server itself (the compose file passes it in), for the UI.
const HOST_LABEL = process.env.SYNAPSE_BACKUPS_HOST || '';

const NAME_RE = /^synapse-backup-[A-Za-z0-9._-]{1,120}\.tar\.gz(\.enc)?$/;
const AUTO_RE = /^synapse-backup-\d{4}-\d\d-\d\d-\d{4}\.tar\.gz(\.enc)?$/;
const SAFETY_RE = /-before-restore\.tar\.gz(\.enc)?$/;
const MAGIC = Buffer.from('SYNAPSE-BACKUP-ENC1\n'); // 20 bytes
const HEADER_LEN = MAGIC.length + 16 + 16 + 12;     // magic, salt, password check, iv
const TAG_LEN = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ───────────────────────── settings ─────────────────────────

const DEFAULT_TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function backupSettings() {
  return {
    schedule: getSetting('backup_schedule') || 'daily',  // off | daily | weekly
    time: getSetting('backup_time') || '02:00',
    day: Number(getSetting('backup_day') ?? 0),          // weekly: 0 = Sunday
    timezone: getSetting('backup_tz') || DEFAULT_TZ,
    keep: Number(getSetting('backup_keep') || 14),
    password_set: !!storedKey(),
    password_unreadable: !!getSetting('backup_key_enc') && !storedKey(),
  };
}

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function updateBackupSettings(body) {
  if (body.schedule !== undefined) {
    if (!['off', 'daily', 'weekly'].includes(body.schedule)) throw new BackupError(400, 'Unknown schedule');
    setSetting('backup_schedule', body.schedule);
  }
  if (body.time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) throw new BackupError(400, 'Time must look like 02:00');
    setSetting('backup_time', body.time);
  }
  if (body.day !== undefined) {
    const d = Number(body.day);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new BackupError(400, 'Unknown day');
    setSetting('backup_day', d);
  }
  if (body.timezone !== undefined) {
    if (!validTz(body.timezone)) throw new BackupError(400, 'Unknown time zone');
    setSetting('backup_tz', body.timezone);
  }
  if (body.keep !== undefined) {
    const k = Number(body.keep);
    if (!Number.isInteger(k) || k < 1 || k > 365) throw new BackupError(400, 'Keep between 1 and 365 backups');
    setSetting('backup_keep', k);
  }
  if (body.password !== undefined) {
    if (body.password === '' || body.password === null) clearKey();
    else {
      if (String(body.password).length < 8) throw new BackupError(400, 'The backup password needs at least 8 characters');
      setPassword(String(body.password));
    }
  }
  return backupSettings();
}

// ───────────────────────── the backup password ─────────────────────────

// The derived key is stored encrypted with the server secret, never the password itself.
const WRAP = crypto.createHash('sha256').update(`synapse-backup-key:${JWT_SECRET}`).digest();
function wrap(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', WRAP, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join(':');
}
function unwrap(text) {
  try {
    const [iv, tag, enc] = String(text).split(':').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', WRAP, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]);
  } catch { return null; }
}

const deriveKey = (password, salt) => crypto.scryptSync(String(password).normalize('NFC'), salt, 32, SCRYPT);
const checkValue = key => crypto.createHmac('sha256', key).update('synapse-backup-check').digest().subarray(0, 16);

/** { key, salt, check } for the current backup password, or null when there's none. */
function storedKey() {
  const enc = getSetting('backup_key_enc');
  const salt = getSetting('backup_salt');
  if (!enc || !salt) return null;
  const key = unwrap(enc);
  if (!key || key.length !== 32) return null;
  return { key, salt: Buffer.from(salt, 'base64'), check: checkValue(key) };
}
function saveKey(key, salt) {
  setSetting('backup_salt', salt.toString('base64'));
  setSetting('backup_key_enc', wrap(key));
}
function setPassword(password) {
  const salt = crypto.randomBytes(16);
  saveKey(deriveKey(password, salt), salt);
}
function clearKey() {
  db.prepare("DELETE FROM settings WHERE key IN ('backup_key_enc','backup_salt')").run();
}

// ───────────────────────── files ─────────────────────────

function ensureDir() {
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (err) {
    throw new BackupError(500, `Can't use the backup folder (${err.code || err.message})`);
  }
}

function safeName(name) {
  if (!NAME_RE.test(String(name || ''))) throw new BackupError(400, 'Not a backup file name');
  return path.join(BACKUP_DIR, name);
}

/** Read an encrypted backup's header, or null for a plain one. */
function readHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEADER_LEN);
    if (fs.readSync(fd, buf, 0, HEADER_LEN, 0) < HEADER_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    let o = MAGIC.length;
    const salt = buf.subarray(o, o += 16);
    const check = buf.subarray(o, o += 16);
    const iv = buf.subarray(o, o += 12);
    return { salt: Buffer.from(salt), check: Buffer.from(check), iv: Buffer.from(iv) };
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function kindOf(name) {
  if (SAFETY_RE.test(name)) return 'before-restore';
  if (AUTO_RE.test(name)) return 'automatic';
  if (/-manual(-\d+)?\.tar\.gz/.test(name)) return 'manual';
  if (/^synapse-backup-\d{8}-\d{6}\.tar\.gz$/.test(name)) return 'command';
  return 'other';
}

export function listBackups() {
  let names = [];
  try { names = fs.readdirSync(BACKUP_DIR); } catch { /* no folder yet */ }
  const key = storedKey();
  return names.filter(n => NAME_RE.test(n)).map(name => {
    const file = path.join(BACKUP_DIR, name);
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const header = name.endsWith('.enc') ? readHeader(file) : null;
    return {
      name,
      size: st.size,
      created_at: Math.floor(st.mtimeMs / 1000),
      kind: kindOf(name),
      encrypted: name.endsWith('.enc'),
      // Does the current backup password open it? (false → it needs an older password)
      current_password: header ? !!key && crypto.timingSafeEqual(header.check, key.check) : null,
    };
  }).filter(Boolean).sort((a, b) => b.created_at - a.created_at || b.name.localeCompare(a.name));
}

export function deleteBackup(name) {
  const file = safeName(name);
  if (!fs.existsSync(file)) throw new BackupError(404, 'Backup not found');
  fs.rmSync(file);
}

export function backupPath(name) {
  const file = safeName(name);
  if (!fs.existsSync(file)) throw new BackupError(404, 'Backup not found');
  return file;
}

// Short-lived signed download links (a plain link can't carry the sign-in header).
const sign = (name, exp) => crypto.createHmac('sha256', JWT_SECRET).update(`backup.${name}.${exp}`).digest('base64url');
export function downloadLink(name) {
  backupPath(name);
  const exp = Math.floor(Date.now() / 1000) + 300;
  return `/api/backups/download/${encodeURIComponent(name)}?exp=${exp}&sig=${sign(name, exp)}`;
}
export function checkDownload(name, exp, sig) {
  if (!name || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(name, exp));
  const got = Buffer.from(String(sig));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Bring in a backup file someone uploaded (from another server, or an older copy). */
export function adoptUpload(tmpPath, originalName) {
  ensureDir();
  const encrypted = !!readHeader(tmpPath);
  let name = path.basename(String(originalName || ''));
  if (!NAME_RE.test(name) || name.endsWith('.enc') !== encrypted) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    name = `synapse-backup-uploaded-${stamp}.tar.gz${encrypted ? '.enc' : ''}`;
  }
  if (!encrypted) {
    // A plain backup starts with gzip's magic bytes.
    const head = Buffer.alloc(2);
    const fd = fs.openSync(tmpPath, 'r');
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    if (head[0] !== 0x1f || head[1] !== 0x8b) { fs.rmSync(tmpPath, { force: true }); throw new BackupError(400, 'That isn’t a Synapse backup file'); }
  }
  let dest = path.join(BACKUP_DIR, name);
  if (fs.existsSync(dest)) dest = dest.replace('synapse-backup-', `synapse-backup-${Date.now()}-`);
  try { fs.renameSync(tmpPath, dest); } catch { fs.copyFileSync(tmpPath, dest); fs.rmSync(tmpPath, { force: true }); }
  return path.basename(dest);
}

// ───────────────────────── making a backup ─────────────────────────

let running = null; // only one backup/restore at a time

function stampNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function writeBackup(suffix) {
  ensureDir();
  const key = storedKey();
  let name = `synapse-backup-${stampNow()}${suffix}.tar.gz${key ? '.enc' : ''}`;
  if (fs.existsSync(path.join(BACKUP_DIR, name))) name = name.replace('.tar.gz', `-${Date.now() % 100000}.tar.gz`);
  const dest = path.join(BACKUP_DIR, name);
  const partial = `${dest}.partial`;
  const work = fs.mkdtempSync(path.join(DATA_DIR, '.backup-'));
  try {
    await db.backup(path.join(work, 'synapse.db'));
    const manifest = { format: 1, app: 'synapse', app_version: APP_VERSION, created_at: Math.floor(Date.now() / 1000) };
    // Saved AI keys stay usable on a new server only in password-protected backups.
    if (key) manifest.ai_key = aiKeyHex();
    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.symlinkSync(UPLOADS_DIR, path.join(work, 'uploads'));

    const pack = tar.c({ gzip: { level: 6 }, cwd: work, follow: true, portable: true }, ['manifest.json', 'synapse.db', 'uploads']);
    if (key) {
      const iv = crypto.randomBytes(12);
      fs.writeFileSync(partial, Buffer.concat([MAGIC, key.salt, key.check, iv]));
      const cipher = crypto.createCipheriv('aes-256-gcm', key.key, iv);
      await pipeline(pack, cipher, fs.createWriteStream(partial, { flags: 'a' }));
      fs.appendFileSync(partial, cipher.getAuthTag());
    } else {
      await pipeline(pack, fs.createWriteStream(partial));
    }
    fs.renameSync(partial, dest);
    return { name, size: fs.statSync(dest).size };
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function prune() {
  const keep = backupSettings().keep;
  const all = listBackups();
  const autos = all.filter(b => b.kind === 'automatic');
  const safety = all.filter(b => b.kind === 'before-restore');
  for (const b of [...autos.slice(keep), ...safety.slice(3)]) {
    try { fs.rmSync(path.join(BACKUP_DIR, b.name)); } catch { /* ignore */ }
  }
}

function recordResult(result) {
  setSetting('backup_last', JSON.stringify(result));
}
export function lastResult() {
  try { return JSON.parse(getSetting('backup_last') || 'null'); } catch { return null; }
}

/** Make a backup now. kind: 'automatic' | 'manual' | 'before-restore'. */
export async function runBackup(kind = 'manual') {
  if (running) throw new BackupError(409, 'A backup or restore is already running');
  const started = Date.now();
  const suffix = kind === 'automatic' ? '' : `-${kind}`;
  running = writeBackup(suffix);
  try {
    const r = await running;
    if (kind === 'automatic') prune();
    const result = { ok: true, at: Math.floor(started / 1000), kind, name: r.name, size: r.size, seconds: Math.round((Date.now() - started) / 100) / 10 };
    recordResult(result);
    import('./cloudBackups.js').then(m => m.afterBackup(r.name, kind)).catch(() => {}); // copy to OneDrive / Google Drive
    console.log(`💾 Backup saved: ${path.join(BACKUP_DIR, r.name)} (${(r.size / 1048576).toFixed(1)} MB)`);
    return result;
  } catch (err) {
    const message = err instanceof BackupError ? err.message : `${err.code ? `${err.code}: ` : ''}${err.message}`;
    recordResult({ ok: false, at: Math.floor(started / 1000), kind, error: message });
    console.error('❌ Backup failed:', err);
    throw err instanceof BackupError ? err : new BackupError(500, `Backup failed — ${message}`);
  } finally {
    running = null;
  }
}

// ───────────────────────── restoring ─────────────────────────

/** Unpack a backup into `dir`, decrypting with `key` when it's encrypted. */
async function unpack(file, dir, key) {
  // Backups made here hold manifest.json, synapse.db and uploads/; ones made with the
  // `synapse backup` command hold the same things inside data/. Nothing else is unpacked.
  const filter = (p, entry) => {
    const type = entry?.type;
    if (type && type !== 'File' && type !== 'Directory' && type !== 'OldFile' && type !== 'ContiguousFile') return false;
    const rel = p.replace(/^(\.\/)+/, '').replace(/^data\//, '');
    return rel === 'manifest.json' || rel === 'synapse.db' || rel === 'uploads' || rel === 'uploads/' || rel.startsWith('uploads/');
  };
  const extract = tar.x({ cwd: dir, filter, strict: false });
  if (!key) { await pipeline(fs.createReadStream(file), extract); return; }
  const header = readHeader(file);
  const size = fs.statSync(file).size;
  const tag = Buffer.alloc(TAG_LEN);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  fs.closeSync(fd);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.iv);
  decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(file, { start: HEADER_LEN, end: size - TAG_LEN - 1 }), decipher, extract);
}

function checkDatabase(file) {
  let d;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    if (d.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('damaged');
    const admins = d.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin'").get().c;
    if (!admins) throw new Error('no admin');
  } catch (err) {
    throw new BackupError(400, err.message === 'no admin'
      ? 'This backup has no admin account, so it can’t be restored'
      : 'The database in this backup is damaged or isn’t a Synapse database');
  } finally { try { d?.close(); } catch { /* ignore */ } }
}

/**
 * Check a backup, unpack it, make a safety backup of the current data, then hand it to the
 * restart (restore.js finishes the job before the database opens). Returns the safety backup.
 */
export async function prepareRestore(name, password) {
  const file = backupPath(name);
  if (running) throw new BackupError(409, 'A backup or restore is already running');
  let key = null;
  let salt = null;
  const header = name.endsWith('.enc') ? readHeader(file) : null;
  if (name.endsWith('.enc')) {
    if (!header) throw new BackupError(400, 'This encrypted backup is damaged');
    const mine = storedKey();
    if (password) {
      key = deriveKey(password, header.salt);
      if (!crypto.timingSafeEqual(checkValue(key), header.check)) throw new BackupError(401, 'Wrong backup password');
    } else if (mine && crypto.timingSafeEqual(mine.check, header.check)) {
      key = mine.key;
    } else {
      throw new BackupError(401, 'This backup needs the password it was made with');
    }
    salt = header.salt;
  }

  const staging = path.join(DATA_DIR, 'restore-staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  running = Promise.resolve();
  try {
    try { await unpack(file, staging, key); } catch (err) {
      if (err instanceof BackupError) throw err;
      throw new BackupError(400, key ? 'This backup is damaged (it doesn’t match its password check)' : 'This backup file is damaged or isn’t a Synapse backup');
    }
    if (fs.existsSync(path.join(staging, 'data', 'synapse.db'))) { // made with `synapse backup`
      for (const n of fs.readdirSync(path.join(staging, 'data'))) fs.renameSync(path.join(staging, 'data', n), path.join(staging, n));
      fs.rmSync(path.join(staging, 'data'), { recursive: true, force: true });
    }
    if (!fs.existsSync(path.join(staging, 'synapse.db'))) throw new BackupError(400, 'This file isn’t a Synapse backup (no database inside)');
    checkDatabase(path.join(staging, 'synapse.db'));
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8')); } catch { /* older/foreign: fine */ }

    running = null;
    const safety = await runBackup('before-restore');
    running = Promise.resolve();

    // Things the restored database can't know: this server's secret-protected values.
    const fixups = { restored_from: name, at: Math.floor(Date.now() / 1000) };
    if (manifest.ai_key) fixups.ai_key = manifest.ai_key;
    // Backup settings belong to the backup system, not to the data: keep today's (schedule,
    // password, latest result…) rather than the ones stored in the backup. A new server without
    // a backup password takes the password of the backup being restored.
    fixups.settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'backup\\_%' ESCAPE '\\' AND key != 'backup_restored'").all();
    if (!storedKey() && key) fixups.backup_key = wrap(Buffer.concat([key, salt]));
    fs.writeFileSync(path.join(staging, 'fixups.json'), JSON.stringify(fixups), { mode: 0o600 });
    fs.writeFileSync(path.join(staging, 'ready'), '');
    fs.rmSync(PENDING_DIR, { recursive: true, force: true });
    fs.renameSync(staging, PENDING_DIR);
    return { safety: safety.name, manifest: { app_version: manifest.app_version || null, created_at: manifest.created_at || null } };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  } finally {
    running = null;
  }
}

/** After a restore (startup): re-protect AI keys and the backup password for this server. */
function finishRestore() {
  if (!fs.existsSync(FIXUPS_FILE)) return;
  try {
    const f = JSON.parse(fs.readFileSync(FIXUPS_FILE, 'utf8'));
    if (f.ai_key) {
      const n = reencryptAiKeys(f.ai_key);
      if (n) console.log(`♻️  Re-protected ${n} saved AI key(s) for this server.`);
    }
    db.prepare("DELETE FROM settings WHERE key LIKE 'backup\\_%' ESCAPE '\\'").run();
    for (const { key, value } of f.settings || []) setSetting(key, value);
    const both = f.backup_key ? unwrap(f.backup_key) : null;
    if (both?.length === 48) saveKey(both.subarray(0, 32), both.subarray(32));
    setSetting('backup_restored', JSON.stringify({ name: f.restored_from, at: f.at }));
    console.log(`♻️  Restored from ${f.restored_from}.`);
  } catch (err) {
    console.error('Restore follow-up failed:', err);
  } finally {
    fs.rmSync(FIXUPS_FILE, { force: true });
  }
}

// ───────────────────────── schedule ─────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function localParts(tz, when = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(when).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: WEEKDAYS.indexOf(parts.weekday) };
}

/** When the next automatic backup should run (unix seconds), for the UI. */
export function nextRun() {
  const s = backupSettings();
  if (s.schedule === 'off') return null;
  const now = Date.now();
  const lastSlot = getSetting('backup_last_slot');
  // Step through the next 8 days in the chosen time zone.
  for (let i = 0; i <= 8 * 24 * 60; i += 5) {
    const t = new Date(now + i * 60_000);
    const p = localParts(s.timezone, t);
    if (p.date === lastSlot) continue;
    if (s.schedule === 'weekly' && p.weekday !== s.day) continue;
    if (p.time >= s.time) return Math.floor(t.getTime() / 1000);
  }
  return null;
}

async function tick() {
  const s = backupSettings();
  if (s.schedule === 'off' || running) return;
  const now = localParts(s.timezone);
  if (s.schedule === 'weekly' && now.weekday !== s.day) return;
  if (now.time < s.time || getSetting('backup_last_slot') === now.date) return;
  setSetting('backup_last_slot', now.date); // once per day, even if it fails (it says so in Settings)
  try { await runBackup('automatic'); } catch { /* recorded */ }
}

export function startBackups() {
  finishRestore();
  fs.rmSync(path.join(DATA_DIR, 'restore-staging'), { recursive: true, force: true });
  try {
    for (const n of fs.readdirSync(DATA_DIR)) if (n.startsWith('.backup-')) fs.rmSync(path.join(DATA_DIR, n), { recursive: true, force: true });
    for (const n of fs.readdirSync(BACKUP_DIR)) if (n.endsWith('.partial')) fs.rmSync(path.join(BACKUP_DIR, n), { force: true });
  } catch { /* nothing to tidy */ }
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 5 * 60_000).unref();
}

export function backupStatus() {
  const restored = (() => { try { return JSON.parse(getSetting('backup_restored') || 'null'); } catch { return null; } })();
  return {
    settings: backupSettings(),
    folder: BACKUP_DIR,
    folder_host: HOST_LABEL,
    folder_mounted: BACKUP_DIR === '/backups',
    inside_data: BACKUP_DIR.startsWith(path.resolve(DATA_DIR) + path.sep),
    last: lastResult(),
    next_run: nextRun(),
    running: !!running,
    restored,
    backups: listBackups(),
  };
}
