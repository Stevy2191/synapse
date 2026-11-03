// Settings → Server → Backups (admins only), plus signed download links.
import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import { requireAdmin } from '../middleware/auth.js';
import {
  backupStatus, updateBackupSettings, runBackup, deleteBackup, downloadLink, checkDownload, backupPath,
  prepareRestore, adoptUpload, BackupError, BACKUP_DIR,
} from '../backups.js';
import { cloudStatus, setCloud, copyToCloud, listCloud, fetchFromCloud } from '../cloudBackups.js';

const router = Router();

// Download with a short-lived signed link (made by an admin below), so the browser can stream it.
router.get('/download/:name', (req, res) => {
  const { name } = req.params;
  if (!checkDownload(name, req.query.exp, req.query.sig)) return res.status(403).json({ error: 'This download link has expired — try again' });
  let file;
  try { file = backupPath(name); } catch (err) { return res.status(err.status || 404).json({ error: err.message }); }
  res.download(file, name);
});

router.use(requireAdmin);

const wrapErr = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof BackupError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

const status = req => ({ ...backupStatus(), cloud: cloudStatus(req.user) });
router.get('/', wrapErr((req, res) => res.json(status(req))));

// Copies in OneDrive / Google Drive (cloudBackups.js)
router.patch('/cloud', wrapErr(async (req, res) => {
  await setCloud(req.user, req.body || {});
  res.json(status(req));
}));
router.get('/cloud/files', wrapErr(async (req, res) => res.json({ files: await listCloud() })));
router.post('/cloud/files/:id/fetch', wrapErr(async (req, res) => {
  const name = await fetchFromCloud(String(req.params.id));
  res.json({ name, ...status(req) });
}));
router.post('/cloud/copy/:name', wrapErr((req, res) => {
  copyToCloud(req.params.name);
  res.json(status(req));
}));

router.patch('/settings', wrapErr((req, res) => {
  updateBackupSettings(req.body || {});
  res.json(status(req));
}));

router.post('/run', wrapErr(async (req, res) => {
  const result = await runBackup('manual');
  res.json({ result, ...status(req) });
}));

router.post('/:name/link', wrapErr((req, res) => res.json({ url: downloadLink(req.params.name) })));

router.delete('/:name', wrapErr((req, res) => {
  deleteBackup(req.params.name);
  res.json(status(req));
}));

// Restore: checks and unpacks the backup, saves a safety backup of today's data, then restarts
// Synapse (Docker starts it again), which swaps the data in before opening the database.
router.post('/:name/restore', wrapErr(async (req, res) => {
  const r = await prepareRestore(req.params.name, req.body?.password || '');
  res.json({ ok: true, restarting: true, ...r });
  console.log(`♻️  Restore of ${req.params.name} requested by ${req.user.username} — restarting.`);
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800);
}));

// Bring in a backup file (e.g. from an old server). Large files can also just be copied into the
// backups folder — they show up in the list.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); cb(null, BACKUP_DIR); } catch { cb(null, os.tmpdir()); } },
    filename: (req, file, cb) => cb(null, `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}.partial`),
  }),
});
router.post('/upload', upload.single('file'), wrapErr((req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const name = adoptUpload(req.file.path, req.file.originalname);
    res.json({ name, ...status(req) });
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    throw err;
  }
}));

export default router;
