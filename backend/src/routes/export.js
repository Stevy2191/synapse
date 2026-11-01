// Export helpers that need the server: PDF printing and pictures of equations/charts for Word.
// Word, Markdown and HTML files themselves are made in the browser (so they also work offline).
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { CHROMIUM, renderPdf, renderImages } from '../exporter.js';

const router = express.Router();
// Exports carry every picture in the notes, so they can be much larger than a normal save.
router.use(express.json({ limit: '150mb' }));
router.use(requireAuth);

router.get('/status', (req, res) => res.json({ pdf: !!CHROMIUM }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many exports at once — wait a minute and try again' });

const safeName = s => String(s || 'Export').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Export';

router.post('/pdf', limiter, async (req, res, next) => {
  const { html, pageSize, landscape, title } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'Nothing to export' });
  try {
    const pdf = await renderPdf(html, { pageSize, landscape, footer: safeName(title) });
    const name = `${safeName(title)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(pdf);
  } catch (err) {
    if (!err.status) console.error('PDF export failed:', err);
    next(Object.assign(err, { status: err.status || 500 }));
  }
});

router.post('/images', limiter, async (req, res, next) => {
  const { css, items } = req.body || {};
  if (!Array.isArray(items) || items.length > 500 || items.some(i => typeof i !== 'string')) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (items.length === 0) return res.json({ images: [] });
  try {
    res.json({ images: await renderImages(typeof css === 'string' ? css : '', items) });
  } catch (err) {
    if (!err.status) console.error('Export picture rendering failed:', err);
    next(Object.assign(err, { status: err.status || 500 }));
  }
});

export default router;
