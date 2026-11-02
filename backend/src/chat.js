// Chat: tables, live delivery (Server-Sent Events) and push notifications.
//
// A chat is a conversation with its own members — on its own ("Vacation 2026") or about a note.
// Members are any people on this server; workspaces stay private. Messages are delivered live
// over one SSE stream per open app (plain HTTP, so it works behind any reverse proxy), and as a
// push notification when none of a person's open apps is on screen.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { publicHttpsAgent } from './netguard.js';
import { db, UPLOADS_DIR } from './db/index.js';
import { JWT_SECRET } from './config.js';
import { getSetting, setSetting } from './settings.js';

export const CHAT_UPLOADS = path.join(UPLOADS_DIR, 'chat');
fs.mkdirSync(CHAT_UPLOADS, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id TEXT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '💬',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_note ON chats(note_id) WHERE note_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);

  CREATE TABLE IF NOT EXISTS chat_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id TEXT,
    body TEXT NOT NULL DEFAULT '',
    reply_to TEXT,
    gif TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    edited_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, seq);

  CREATE TABLE IF NOT EXISTS chat_files (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id TEXT,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_chat_files_message ON chat_files(message_id);

  CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (message_id, user_id, emoji)
  );

  -- Nicknames: what I call someone (only I see it), like phone contacts.
  CREATE TABLE IF NOT EXISTS user_nicknames (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    PRIMARY KEY (owner_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

/** Delete chat files from disk (after their rows are gone or about to be). */
export function removeChatFiles(filenames) {
  for (const f of filenames) {
    try { fs.unlinkSync(path.join(CHAT_UPLOADS, path.basename(f))); } catch { /* already gone */ }
  }
}

// Uploaded but never sent (the message was abandoned): clean up after a day.
export function purgeOrphanChatFiles() {
  const rows = db.prepare(`SELECT id, filename FROM chat_files WHERE message_id IS NULL AND created_at < unixepoch() - 86400`).all();
  if (!rows.length) return;
  db.prepare(`DELETE FROM chat_files WHERE message_id IS NULL AND created_at < unixepoch() - 86400`).run();
  removeChatFiles(rows.map(r => r.filename));
}

// ───────────────────────── signed file links ─────────────────────────
// Pictures in messages are shown with <img>, which can't send the sign-in header, so their
// links carry a signature instead (valid for a week; the same link all day so browsers cache it).
export function signFile(id) {
  const exp = Math.floor(Date.now() / 86_400_000) * 86_400 + 8 * 86_400;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`chatfile.${id}.${exp}`).digest('base64url');
  return `/api/chats/files/${id}?exp=${exp}&sig=${sig}`;
}
export function checkFileSignature(id, exp, sig) {
  if (!/^\d+$/.test(String(exp)) || +exp < Date.now() / 1000 || typeof sig !== 'string') return false;
  const want = crypto.createHmac('sha256', JWT_SECRET).update(`chatfile.${id}.${exp}`).digest();
  let got;
  try { got = Buffer.from(sig, 'base64url'); } catch { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ───────────────────────── live delivery (SSE) ─────────────────────────
const connections = new Map(); // userId → Map(connId → { res, visible })

export function addConnection(userId, res) {
  const id = crypto.randomUUID();
  if (!connections.has(userId)) connections.set(userId, new Map());
  connections.get(userId).set(id, { res, visible: true });
  return id;
}
export function removeConnection(userId, id) {
  const conns = connections.get(userId);
  if (!conns) return;
  conns.delete(id);
  if (!conns.size) connections.delete(userId);
}
export function setVisible(userId, id, visible) {
  const c = connections.get(userId)?.get(id);
  if (c) c.visible = !!visible;
}
export function isOnScreen(userId) {
  for (const c of connections.get(userId)?.values() || []) if (c.visible) return true;
  return false;
}
export function onlineUserIds() {
  return [...connections.keys()];
}

/** Send an event to these people's open apps. */
export function sendTo(userIds, type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const uid of new Set(userIds)) {
    for (const c of connections.get(uid)?.values() || []) {
      try { c.res.write(payload); c.res.flush?.(); } catch { /* closed; removed on 'close' */ }
    }
  }
}

export function memberIds(chatId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE chat_id=?').all(chatId).map(r => r.user_id);
}

// Keep proxies from closing quiet streams.
setInterval(() => {
  for (const conns of connections.values()) {
    for (const c of conns.values()) { try { c.res.write(': ping\n\n'); c.res.flush?.(); } catch { /* ignore */ } }
  }
}, 25_000).unref();

// ───────────────────────── push notifications ─────────────────────────
function vapidKeys() {
  let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
  }
  return { pub, priv };
}
const VAPID = vapidKeys();
// Push services want a contact address; Apple rejects made-up "localhost" ones.
webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:synapse-admin@example.com', VAPID.pub, VAPID.priv);
export const VAPID_PUBLIC_KEY = VAPID.pub;

/** Send a push notification to all of a person's subscribed devices. */
export async function pushTo(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  await Promise.all(subs.map(async s => {
    try {
      // Push services are on the public internet; the guarded agent refuses private / local addresses.
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high', agent: publicHttpsAgent });
    } catch (err) {
      // 404/410: the subscription has ended (app removed, permission revoked).
      if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(s.endpoint);
      else console.warn('Push failed:', err.statusCode || err.message);
    }
  }));
}
