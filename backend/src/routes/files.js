// File integrations API: network folders, OneDrive and Google Drive (see files.js).
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { noteAccess } from '../shares.js';
import {
  sourcesFor, listFiles, downloadFile, uploadFile, attachCopy, startConnect, finishConnect, disconnect,
  adminView, updateAdmin, FileError,
} from '../files.js';

const router = Router();

// Types a browser may show inline; everything else downloads (so a file can't run script here).
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'application/pdf', 'text/plain',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm']);

const wrap = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof FileError) return res.status(err.status).json({ error: err.message });
    if (err?.cause?.code === 'ECONNREFUSED' || err?.cause?.code === 'ENOTFOUND' || err?.name === 'TypeError' && /fetch/i.test(err.message)) {
      return res.status(502).json({ error: 'Couldn’t reach the cloud service from the server — check its internet connection' });
    }
    next(err);
  }
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The provider sends the browser back here after sign-in (no Synapse sign-in header on this
// request — the one-time "state" says who started it). Tells the opener window and closes.
router.get('/oauth/:provider/callback', async (req, res) => {
  let ok = true;
  let message;
  try {
    const r = await finishConnect(req.params.provider, req.query);
    message = `Connected${r.account ? ` as ${r.account}` : ''}.`;
  } catch (err) {
    ok = false;
    message = err instanceof FileError ? err.message : 'Something went wrong while connecting.';
    if (!(err instanceof FileError)) console.error('File connect failed:', err);
  }
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  // Keep the link to the Synapse window that opened this sign-in popup, so we can tell it we're done.
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synapse</title>
<style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#0f0f14;color:#e5e7eb;text-align:center}p{max-width:420px;line-height:1.5}b{color:${ok ? '#34d399' : '#f87171'}}</style></head>
<body><div><p><b>${ok ? '✓' : '✗'}</b> ${esc(message)}</p><p style="color:#9ca3af">You can close this window.</p></div>
<script>try{window.opener&&window.opener.postMessage({type:'synapse-files-connected',ok:${ok}},location.origin)}catch(e){}setTimeout(function(){window.close()},${ok ? 1200 : 6000})</script></body></html>`);
});

router.use(requireAuth);

router.get('/sources', (req, res) => res.json({ sources: sourcesFor(req.user) }));

router.get('/list', wrap(async (req, res) => {
  res.json(await listFiles(req.user, String(req.query.source || ''), String(req.query.id || '')));
}));

router.get('/download', wrap(async (req, res) => {
  const f = await downloadFile(req.user, String(req.query.source || ''), String(req.query.id || ''));
  const inline = req.query.inline === '1' && INLINE.has(f.mime);
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-File-Type', f.mime);
  if (f.size) res.setHeader('Content-Length', f.size);
  f.stream.on('error', err => { console.error('File download failed:', err.message); res.destroy(); });
  f.stream.pipe(res);
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
router.post('/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const name = String(req.body.name || req.file.originalname || 'file');
  const item = await uploadFile(req.user, String(req.body.source || ''), String(req.body.parent || ''), name, req.file.buffer, req.file.mimetype);
  res.json({ item });
}));

// Copy a file into a note (Attach a copy).
router.post('/attach', wrap(async (req, res) => {
  const { source, id, note_id: noteId } = req.body || {};
  const access = noteAccess(String(noteId || ''), req.user.id);
  if (!access || (access.role !== 'owner' && access.role !== 'edit')) return res.status(404).json({ error: 'Note not found' });
  res.json({ attachment: await attachCopy(req.user, String(source || ''), String(id || ''), noteId) });
}));

router.post('/connect/:provider', wrap(async (req, res) => {
  res.json(startConnect(req.user, req.params.provider, String(req.body?.origin || '')));
}));
router.delete('/connect/:provider', (req, res) => { disconnect(req.user, req.params.provider); res.json({ sources: sourcesFor(req.user) }); });

router.get('/admin', requireAdmin, (req, res) => res.json(adminView()));
router.patch('/admin', requireAdmin, wrap(async (req, res) => res.json(updateAdmin(req.body || {}))));

export default router;
