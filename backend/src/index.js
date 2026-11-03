import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
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
import { closeBrowser } from './exporter.js';
import chatRoutes from './routes/chats.js';
import aiRoutes from './routes/ai.js';
import shareRoutes from './routes/shares.js';
import { ownerRouter as publishRoutes, publicRouter } from './routes/publish.js';
import { purgeOrphanChatFiles } from './chat.js';
import backupRoutes from './routes/backups.js';
import fileRoutes from './routes/files.js';
import ocrRoutes from './routes/ocr.js';
import meetingRoutes from './routes/meetings.js';
import { startMeetings } from './meetings.js';
import { startOcrIndexing, closeOcr, LANG_DIR, CORE_DIR, WORKER_FILE } from './ocr.js';
import { startBackups } from './backups.js';
import { startCloudBackups } from './cloudBackups.js';
import { startReminders } from './reminders.js';
import { attachCollab } from './collab.js';
import homeRoutes from './routes/home.js';
import reminderRoutes from './routes/reminders.js';
import commentRoutes from './routes/comments.js';
import inboxRoutes from './routes/inbox.js';
import { pruneActivity } from './activity.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Which proxies may tell us the visitor's real address (X-Forwarded-For). By default only ones on this
// machine or a private network (Caddy, Nginx Proxy Manager, a Docker network) — so someone connecting
// straight from the internet can't fake their address to dodge the sign-in limits.
// TRUST_PROXY overrides it (e.g. "1" for one hop of anything, or a list of addresses).
const TRUST_PROXY = process.env.TRUST_PROXY?.trim();
app.set('trust proxy', TRUST_PROXY ? (/^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY) : 'loopback, linklocal, uniquelocal');

// Security headers. The Content-Security-Policy only lets the browser run Synapse's own scripts, so
// even if something slipped HTML into a page it couldn't run code. Popups we open (OneDrive / Google
// sign-in) must stay linked to the app window (COOP). Routes that serve files set their own, stricter CSP.
const DRAWIO_ORIGIN = (() => { try { return new URL(process.env.DRAWIO_URL || 'https://embed.diagrams.net').origin; } catch { return 'https://embed.diagrams.net'; } })();
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],            // text recognition runs WebAssembly
      workerSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],  // pictures linked from the web, GIFs
      mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'data:', 'blob:', (req) => `ws://${req.headers.host}`, (req) => `wss://${req.headers.host}`],
      frameSrc: ["'self'", 'blob:', DRAWIO_ORIGIN, 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],                             // no one can frame Synapse (clickjacking)
      manifestSrc: ["'self'"],
    },
  },
}));
// Chat's live stream must not be held back for compression.
app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/chats/events') && !req.path.startsWith('/api/ai/') && compression.filter(req, res) }));
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
// Which build of the app this server has; open apps compare it with their own (appUpdate.js).
const BUILD_ID = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(FRONTEND_DIST, 'build.json'), 'utf8')).build || null; } catch { return null; }
})();
app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ drawio_url: DRAWIO_URL, trash_days: TRASH_DAYS, build: BUILD_ID });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', securityRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/calendars', calendarRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/team', inboxRoutes); // /api/team/inbox, /api/team/activity/:wsId
app.use('/api/ai', aiRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/publish', publishRoutes);
app.use('/api/public', publicRouter);  // published notes: no sign-in

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Text recognition on devices (when offline) uses the same engine and language files as the
// server; they're served from here so devices never need the internet for it.
app.get('/ocr-assets/worker.min.js', (req, res) => res.sendFile(WORKER_FILE, { maxAge: '7d' }));
app.use('/ocr-assets/core', express.static(CORE_DIR, { maxAge: '7d', index: false }));
app.use('/ocr-assets/lang', express.static(LANG_DIR, { maxAge: '7d', index: false }));

// Frontend (single-page app)
// Vite puts content-hashed files in /assets, so they can be cached forever.
app.use('/assets', express.static(path.join(FRONTEND_DIST, 'assets'), { maxAge: '1y', immutable: true }));
// The service worker and the app's entry files must always be fresh — a cached copy (in the
// browser or a reverse proxy) keeps people on an old version of the app.
const ALWAYS_FRESH = /(^|\/)(sw\.js|registerSW\.js|push-sw\.js|workbox-[\w-]+\.js|index\.html|manifest\.webmanifest|build\.json)$/;
app.use(express.static(FRONTEND_DIST, {
  index: false,
  setHeaders: (res, file) => { if (ALWAYS_FRESH.test(file)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); },
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
startBackups();
startCloudBackups();
startReminders();
pruneActivity();
setInterval(pruneActivity, 24 * 60 * 60 * 1000).unref();
startOcrIndexing();
startMeetings();
purgeOrphanChatFiles();
setInterval(purgeOrphanChatFiles, 6 * 60 * 60 * 1000).unref();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 Synapse running on port ${PORT}`);
});
attachCollab(server); // live editing together: WebSocket at /api/collab

// Stop cleanly when Docker stops or replaces the container (synapse update/restart): close the
// database so its lock is released — this matters on network shares, where a killed process can
// leave a lock behind. (In a container, Node ignores SIGTERM unless it handles it itself.)
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Stopping (${signal})…`);
  server.close();
  Promise.race([Promise.all([closeBrowser(), closeOcr()]), new Promise(r => setTimeout(r, 3000))]).finally(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
