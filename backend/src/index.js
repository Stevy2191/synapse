import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import multer from 'multer';

import { FRONTEND_DIST, TRASH_DAYS } from './config.js';
import { db } from './db/index.js';
import { prepareSetupCode } from './setup.js';
import authRoutes from './routes/auth.js';
import securityRoutes from './routes/security.js';
import calendarRoutes from './routes/calendars.js';
import { startCalendarSync } from './calendars.js';
import workspaceRoutes from './routes/workspaces.js';
import noteRoutes, { purgeTrash } from './routes/notes.js';
import attachmentRoutes from './routes/attachments.js';
import adminRoutes from './routes/admin.js';
import exportRoutes from './routes/export.js';
import chatRoutes from './routes/chats.js';
import { purgeOrphanChatFiles } from './chat.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first proxy (Nginx Proxy Manager / Cloudflare) so req.ip is the real client.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
// Chat's live stream must not be held back for compression.
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/chats/events') && compression.filter(req, res) }));
// The frontend is served from this same origin, so CORS is only needed if CORS_ORIGIN is set.
if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*') {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()) }));
}
// Export has its own, larger body limit, so it's mounted before the general JSON parser.
app.use('/api/export', exportRoutes);
app.use(express.json({ limit: '25mb' })); // drawings with pasted pictures can be large

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Synapse' }));

// Settings the app needs before sign-in. DRAWIO_URL: where the draw.io editor is loaded from —
// diagrams.net by default, or your own copy (docker run jgraph/drawio) to keep it all self-hosted.
const DRAWIO_URL = (() => {
  try {
    const u = new URL(process.env.DRAWIO_URL || 'https://embed.diagrams.net');
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch { return 'https://embed.diagrams.net'; }
})();
app.get('/api/config', (req, res) => res.json({ drawio_url: DRAWIO_URL, trash_days: TRASH_DAYS }));

app.use('/api/auth', authRoutes);
app.use('/api/auth', securityRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/calendars', calendarRoutes);
app.use('/api/chats', chatRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Frontend (single-page app)
// Vite puts content-hashed files in /assets, so they can be cached forever.
app.use('/assets', express.static(path.join(FRONTEND_DIST, 'assets'), { maxAge: '1y', immutable: true }));
app.use(express.static(FRONTEND_DIST, { index: false }));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), err => {
    if (err) res.status(500).send('Frontend not built. Run `npm run build` in frontend/.');
  });
});

// Errors -> JSON
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 50MB)' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Note is too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

prepareSetupCode(db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
startCalendarSync();
// Empty old notes out of the Trash now and every 6 hours.
purgeTrash();
setInterval(purgeTrash, 6 * 60 * 60 * 1000).unref();
purgeOrphanChatFiles();
setInterval(purgeOrphanChatFiles, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 Synapse running on port ${PORT}`);
});
