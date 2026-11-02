// Meetings API (see meetings.js) + admin speech-model management (speech/models.js).
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { noteAccess } from '../shares.js';
import { DATA_DIR } from '../config.js';
import { getSetting, setSetting } from '../settings.js';
import {
  createMeeting, getMeeting, publicMeeting, renameSpeakers, deleteAudio, retry, audioPath, audioLink, checkAudioLink,
  getPrefs, savePrefs, queuePosition, MeetingError,
} from '../meetings.js';
import { modelsStatus, startDownload, chooseModel, removeModel } from '../speech/models.js';

const router = Router();

// The audio player: signed link, no sign-in header (supports seeking via Range).
router.get('/audio/:id', (req, res) => {
  if (!checkAudioLink(req.params.id, req.query.exp, req.query.sig)) return res.status(403).json({ error: 'This link has expired' });
  const m = getMeeting(req.params.id);
  const file = audioPath(m);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'The recording was deleted' });
  res.setHeader('Content-Type', m.audio_mime?.startsWith('video/') ? m.audio_mime.replace('video/', 'audio/') : (m.audio_mime || 'audio/webm'));
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file, { headers: { 'Cache-Control': 'private, max-age=3600' } });
});

router.use(requireAuth);

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof MeetingError || err.status) return res.status(err.status || 500).json({ error: err.message });
    next(err);
  }
};

function access(req, needEdit) {
  const m = getMeeting(req.params.id);
  if (!m) throw new MeetingError(404, 'Meeting not found');
  if (m.user_id === req.user.id) return m;
  const a = m.note_id ? noteAccess(m.note_id, req.user.id) : null;
  if (!a || (needEdit && a.role !== 'edit' && a.role !== 'owner')) throw new MeetingError(404, 'Meeting not found');
  return m;
}

const tmpDir = path.join(DATA_DIR, '.meeting-uploads');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 1024 * 1024 * 1024, files: 1 } }); // 1 GB

router.post('/', upload.single('audio'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No recording' });
  const b = req.body || {};
  if (b.note_id) {
    const a = noteAccess(String(b.note_id), req.user.id);
    if (!a || (a.role !== 'owner' && a.role !== 'edit')) { fs.rmSync(req.file.path, { force: true }); return res.status(404).json({ error: 'Note not found' }); }
  }
  try { res.json({ meeting: createMeeting(req.user.id, req.file, b) }); } catch (err) { fs.rmSync(req.file.path, { force: true }); throw err; }
}));

router.get('/prefs', (req, res) => res.json(getPrefs(req.user.id)));
router.put('/prefs', wrap(async (req, res) => res.json(savePrefs(req.user.id, req.body || {}))));

router.get('/admin', requireAdmin, (req, res) => res.json({ ...modelsStatus(), workers: parseInt(getSetting('speech_workers'), 10) || 0 }));
router.post('/admin/download', requireAdmin, wrap(async (req, res) => res.json(startDownload(String(req.body?.model || '')))));
router.post('/admin/choose', requireAdmin, wrap(async (req, res) => res.json(chooseModel(String(req.body?.model || '')))));
router.delete('/admin/models/:id', requireAdmin, wrap(async (req, res) => res.json(removeModel(req.params.id))));
router.patch('/admin', requireAdmin, wrap(async (req, res) => {
  const n = parseInt(req.body?.workers, 10);
  setSetting('speech_workers', n >= 1 && n <= 8 ? n : 0);
  res.json({ ...modelsStatus(), workers: n >= 1 && n <= 8 ? n : 0 });
}));

router.get('/:id', wrap(async (req, res) => {
  const m = access(req, false);
  res.json({ meeting: { ...publicMeeting(m), queue_position: m.status === 'queued' ? queuePosition(m.id) : 0 } });
}));
router.get('/:id/audio-link', wrap(async (req, res) => { const m = access(req, false); res.json({ url: m.audio_file ? audioLink(m.id) : null }); }));
router.patch('/:id/speakers', wrap(async (req, res) => { const m = access(req, true); res.json({ meeting: renameSpeakers(m.id, req.body?.names || {}) }); }));
router.post('/:id/retry', wrap(async (req, res) => { const m = access(req, true); res.json({ meeting: retry(m.id, req.body || {}) }); }));
router.delete('/:id/audio', wrap(async (req, res) => { const m = access(req, true); res.json({ meeting: deleteAudio(m.id) }); }));

export default router;
