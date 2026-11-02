// Text recognition (OCR) API — see ocr.js.
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { recognize, lookup, ocrSettings, updateOcrSettings, addLanguage, removeLanguage, indexNow, OcrError } from '../ocr.js';

const router = Router();
router.use(requireAuth);

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof OcrError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};
const limiter = rateLimit({ windowMs: 60_000, max: 60, message: 'That’s a lot of pictures at once — wait a minute' });

// Read the text in one picture (a data: URL).
router.post('/image', limiter, wrap(async (req, res) => {
  const image = String(req.body?.image || '');
  if (!/^data:image\/[\w.+-]+;base64,/.test(image)) return res.status(400).json({ error: 'Send a picture' });
  res.json(await recognize(image));
}));

// Text already read from pictures this device has (looked up by picture hash).
router.post('/lookup', (req, res) => {
  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes : [];
  res.json({ texts: lookup(hashes) });
});

// Languages in use (devices reading offline use the same ones).
router.get('/config', (req, res) => { const s = ocrSettings(); res.json({ languages: s.languages }); });

router.get('/settings', requireAdmin, (req, res) => res.json(ocrSettings()));
router.patch('/settings', requireAdmin, wrap(async (req, res) => {
  const s = updateOcrSettings(req.body || {});
  indexNow();
  res.json(s);
}));
router.post('/languages/:code', requireAdmin, wrap(async (req, res) => res.json(await addLanguage(req.params.code))));
router.delete('/languages/:code', requireAdmin, wrap(async (req, res) => res.json(removeLanguage(req.params.code))));

export default router;
