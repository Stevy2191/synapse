// Chat API: conversations, members, messages, files, reactions, live events, GIF search, push.
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getSetting } from '../settings.js';
import {
  CHAT_UPLOADS, removeChatFiles, signFile, checkFileSignature, addConnection, removeConnection, setVisible,
  isOnScreen, onlineUserIds, sendTo, memberIds, pushTo, VAPID_PUBLIC_KEY,
} from '../chat.js';

const router = Router();

const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'application/pdf', 'text/plain', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
]);

// Files are opened with a signed link (pictures are shown with <img>, which can't sign in).
router.get('/files/:id', (req, res) => {
  if (!checkFileSignature(req.params.id, req.query.exp, req.query.sig)) return res.status(403).json({ error: 'Link expired' });
  const f = db.prepare('SELECT * FROM chat_files WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(CHAT_UPLOADS, path.basename(f.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  const inline = INLINE_TYPES.has(f.mime_type) && req.query.download === undefined;
  res.setHeader('Content-Type', INLINE_TYPES.has(f.mime_type) ? f.mime_type : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
  res.sendFile(filePath);
});

router.use(requireAuth);

const sendLimit = rateLimit({ windowMs: 60_000, max: 120, message: 'You’re sending messages very fast — wait a moment' });

// ───────────────────────── helpers ─────────────────────────

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const wrap = fn => (req, res, next) => { try { const r = fn(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } };

function membership(chatId, userId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  if (!chat) throw new HttpError(404, 'Chat not found');
  const member = db.prepare('SELECT * FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, userId);
  if (!member) throw new HttpError(404, 'Chat not found');
  return { chat, member };
}

const userRow = db.prepare('SELECT id, username, display_name, avatar FROM users WHERE id=?');
const nickRow = db.prepare('SELECT nickname FROM user_nicknames WHERE owner_id=? AND target_id=?');
/** How `viewerId` sees this person: their nickname for them, else the person's own name. */
const nameOf = (id, viewerId = null) => {
  const nick = viewerId && nickRow.get(viewerId, id)?.nickname;
  if (nick) return nick;
  const u = userRow.get(id);
  return u ? (u.display_name || u.username) : 'Someone';
};

function chatSummary(chat, userId) {
  const me = db.prepare('SELECT last_read, muted FROM chat_members WHERE chat_id=? AND user_id=?').get(chat.id, userId) || {};
  const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, n.nickname FROM chat_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN user_nicknames n ON n.owner_id=? AND n.target_id=u.id
    WHERE m.chat_id=? ORDER BY m.joined_at`).all(userId, chat.id);
  const last = db.prepare(`SELECT seq, id, user_id, body, gif, created_at, deleted_at,
      (SELECT COUNT(*) FROM chat_files f WHERE f.message_id=chat_messages.id) AS files
    FROM chat_messages WHERE chat_id=? ORDER BY seq DESC LIMIT 1`).get(chat.id);
  const unread = db.prepare(`SELECT COUNT(*) AS c FROM chat_messages WHERE chat_id=? AND seq>? AND deleted_at IS NULL AND (user_id IS NULL OR user_id<>?)`)
    .get(chat.id, me.last_read || 0, userId).c;
  const note = chat.note_id ? db.prepare('SELECT id, title, deleted_at FROM notes WHERE id=?').get(chat.note_id) : null;
  return {
    id: chat.id, name: chat.name, icon: chat.icon, owner_id: chat.owner_id, created_at: chat.created_at, updated_at: chat.updated_at,
    note: note ? { id: note.id, title: note.title, deleted: !!note.deleted_at, mine: chat.owner_id === userId } : chat.note_id ? { id: chat.note_id, title: 'Deleted note', deleted: true } : null,
    members, last_read: me.last_read || 0, muted: !!me.muted, unread,
    last: last ? { seq: last.seq, user_id: last.user_id, created_at: last.created_at, text: last.deleted_at ? 'Message deleted' : last.body || (last.gif ? 'GIF' : last.files ? '📎 File' : '') } : null,
  };
}

function detailMessages(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const marks = ids.map(() => '?').join(',');
  const files = db.prepare(`SELECT * FROM chat_files WHERE message_id IN (${marks})`).all(...ids);
  const reactions = db.prepare(`SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN (${marks}) ORDER BY created_at`).all(...ids);
  const replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))];
  const replies = replyIds.length
    ? db.prepare(`SELECT id, user_id, body, gif, deleted_at FROM chat_messages WHERE id IN (${replyIds.map(() => '?').join(',')})`).all(...replyIds)
    : [];
  return rows.map(r => {
    const rx = {};
    for (const x of reactions) if (x.message_id === r.id) (rx[x.emoji] ||= []).push(x.user_id);
    const rep = r.reply_to && replies.find(x => x.id === r.reply_to);
    return {
      seq: r.seq, id: r.id, chat_id: r.chat_id, user_id: r.user_id,
      body: r.deleted_at ? '' : r.body,
      gif: r.deleted_at || !r.gif ? null : JSON.parse(r.gif),
      created_at: r.created_at, edited_at: r.edited_at, deleted: !!r.deleted_at,
      reply_to: r.reply_to ? (rep ? { id: rep.id, user_id: rep.user_id, text: rep.deleted_at ? 'Message deleted' : (rep.body || (rep.gif ? 'GIF' : '📎 File')).slice(0, 160) } : { id: r.reply_to, text: 'Message deleted' }) : null,
      files: r.deleted_at ? [] : files.filter(f => f.message_id === r.id).map(f => ({
        id: f.id, name: f.original_name, mime: f.mime_type, size: f.size, width: f.width, height: f.height, url: signFile(f.id),
      })),
      reactions: rx,
    };
  });
}
const messageById = id => detailMessages([db.prepare('SELECT * FROM chat_messages WHERE id=?').get(id)].filter(Boolean))[0];

function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || fallback;
}
function cleanIcon(icon) {
  const i = String(icon ?? '').trim();
  return i && [...i].length <= 4 && i.length <= 16 ? i : '💬';
}
function validUserIds(ids) {
  if (!Array.isArray(ids)) return [];
  const exists = db.prepare('SELECT id FROM users WHERE id=?');
  return [...new Set(ids.filter(x => typeof x === 'string'))].filter(id => exists.get(id));
}
function ownsNote(noteId, userId) {
  return db.prepare(`SELECT n.id, n.title FROM notes n JOIN workspaces w ON w.id=n.workspace_id
    WHERE n.id=? AND w.user_id=? AND n.deleted_at IS NULL`).get(noteId, userId);
}

function broadcastChat(chatId, extraUserIds = []) {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  if (!chat) return;
  for (const uid of new Set([...memberIds(chatId), ...extraUserIds])) {
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(chatId, uid);
    if (isMember) sendTo([uid], 'chat', chatSummary(chat, uid));
    else sendTo([uid], 'chat:removed', { id: chatId });
  }
}

// ───────────────────────── people ─────────────────────────

router.get('/users', (req, res) => {
  const users = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, n.nickname FROM users u
    LEFT JOIN user_nicknames n ON n.owner_id=? AND n.target_id=u.id
    ORDER BY COALESCE(n.nickname, u.display_name, u.username) COLLATE NOCASE`).all(req.user.id);
  const online = new Set(onlineUserIds());
  res.json({ users: users.map(u => ({ ...u, online: online.has(u.id) })) });
});

// Set (or clear, with an empty name) my nickname for someone. Only I see it.
router.put('/nicknames/:userId', wrap((req, res) => {
  const target = userRow.get(req.params.userId);
  if (!target) throw new HttpError(404, 'Person not found');
  const nick = String(req.body?.nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (nick) db.prepare(`INSERT INTO user_nicknames (owner_id, target_id, nickname) VALUES (?,?,?)
    ON CONFLICT(owner_id, target_id) DO UPDATE SET nickname=excluded.nickname`).run(req.user.id, target.id, nick);
  else db.prepare('DELETE FROM user_nicknames WHERE owner_id=? AND target_id=?').run(req.user.id, target.id);
  res.json({ user: { ...target, nickname: nick || null } });
}));

// ───────────────────────── live events ─────────────────────────

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: don't hold the stream back
  });
  const connId = addConnection(req.user.id, res);
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ conn: connId })}\n\n`);
  sendPresence(req.user.id);
  req.on('close', () => { removeConnection(req.user.id, connId); sendPresence(req.user.id); });
});

function sendPresence(userId) {
  const chats = db.prepare('SELECT chat_id FROM chat_members WHERE user_id=?').all(userId).map(r => r.chat_id);
  const people = new Set();
  for (const c of chats) for (const m of memberIds(c)) people.add(m);
  sendTo([...people], 'presence', { user_id: userId, online: onlineUserIds().includes(userId) });
}

router.post('/presence', (req, res) => {
  setVisible(req.user.id, req.body?.conn, req.body?.visible);
  res.json({ ok: true });
});

// ───────────────────────── chats ─────────────────────────

router.get('/', (req, res) => {
  const chats = db.prepare(`SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.user_id=? ORDER BY c.updated_at DESC`).all(req.user.id);
  res.json({ chats: chats.map(c => chatSummary(c, req.user.id)) });
});

router.post('/', wrap((req, res) => {
  const { name, icon, note_id, member_ids } = req.body || {};
  let note = null;
  if (note_id) {
    note = ownsNote(note_id, req.user.id);
    if (!note) throw new HttpError(404, 'Note not found');
    const existing = db.prepare('SELECT * FROM chats WHERE note_id=?').get(note_id);
    if (existing) {
      const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?').get(existing.id, req.user.id);
      if (isMember) return res.json({ chat: chatSummary(existing, req.user.id) });
      throw new HttpError(409, 'This note already has a chat');
    }
  }
  const id = uuid();
  const members = validUserIds(member_ids).filter(u => u !== req.user.id);
  db.transaction(() => {
    db.prepare('INSERT INTO chats (id, owner_id, note_id, name, icon) VALUES (?,?,?,?,?)')
      .run(id, req.user.id, note?.id || null, cleanName(name, note?.title || 'New chat'), cleanIcon(icon || (note ? '📄' : '💬')));
    const add = db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?,?)');
    add.run(id, req.user.id);
    for (const u of members) add.run(id, u);
  })();
  broadcastChat(id);
  res.json({ chat: chatSummary(db.prepare('SELECT * FROM chats WHERE id=?').get(id), req.user.id) });
}));

router.get('/by-note/:noteId', (req, res) => {
  const chat = db.prepare(`SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id AND m.user_id=? WHERE c.note_id=?`).get(req.user.id, req.params.noteId);
  res.json({ chat: chat ? chatSummary(chat, req.user.id) : null });
});

router.get('/:id', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  res.json({ chat: chatSummary(chat, req.user.id) });
}));

router.patch('/:id', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  const body = req.body || {};
  if (body.name !== undefined || body.icon !== undefined) {
    db.prepare('UPDATE chats SET name=?, icon=? WHERE id=?')
      .run(body.name !== undefined ? cleanName(body.name, chat.name) : chat.name, body.icon !== undefined ? cleanIcon(body.icon) : chat.icon, chat.id);
  }
  if (body.muted !== undefined) {
    db.prepare('UPDATE chat_members SET muted=? WHERE chat_id=? AND user_id=?').run(body.muted ? 1 : 0, chat.id, req.user.id);
  }
  broadcastChat(chat.id);
  res.json({ chat: chatSummary(db.prepare('SELECT * FROM chats WHERE id=?').get(chat.id), req.user.id) });
}));

router.delete('/:id', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  if (chat.owner_id !== req.user.id) throw new HttpError(403, 'Only the person who started the chat can delete it');
  const members = memberIds(chat.id);
  const files = db.prepare('SELECT filename FROM chat_files WHERE chat_id=?').all(chat.id).map(f => f.filename);
  db.transaction(() => {
    db.prepare('DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE chat_id=?)').run(chat.id);
    db.prepare('DELETE FROM chats WHERE id=?').run(chat.id);
  })();
  removeChatFiles(files);
  sendTo(members, 'chat:removed', { id: chat.id });
  res.json({ ok: true });
}));

// Anyone in a chat can add people; the starter can remove people; anyone can leave.
router.post('/:id/members', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  const add = db.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?,?)');
  const ids = validUserIds(req.body?.user_ids);
  for (const u of ids) add.run(chat.id, u);
  if (ids.length) systemMessage(chat.id, req.user.id, `added ${ids.map(nameOf).join(', ')}`);
  broadcastChat(chat.id);
  res.json({ chat: chatSummary(chat, req.user.id) });
}));

router.delete('/:id/members/:userId', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  const target = req.params.userId;
  const self = target === req.user.id;
  if (!self && chat.owner_id !== req.user.id) throw new HttpError(403, 'Only the person who started the chat can remove people');
  db.prepare('DELETE FROM chat_members WHERE chat_id=? AND user_id=?').run(chat.id, target);
  const left = db.prepare('SELECT user_id FROM chat_members WHERE chat_id=? ORDER BY joined_at').all(chat.id);
  if (!left.length) {
    const files = db.prepare('SELECT filename FROM chat_files WHERE chat_id=?').all(chat.id).map(f => f.filename);
    db.prepare('DELETE FROM chats WHERE id=?').run(chat.id);
    removeChatFiles(files);
  } else {
    if (target === chat.owner_id) db.prepare('UPDATE chats SET owner_id=? WHERE id=?').run(left[0].user_id, chat.id);
    systemMessage(chat.id, req.user.id, self ? 'left the chat' : `removed ${nameOf(target)}`);
    broadcastChat(chat.id);
  }
  sendTo([target], 'chat:removed', { id: chat.id });
  res.json({ ok: true });
}));

function systemMessage(chatId, userId, text) {
  const id = uuid();
  db.prepare(`INSERT INTO chat_messages (id, chat_id, user_id, body, gif) VALUES (?,?,?,?,?)`).run(id, chatId, userId, text, JSON.stringify({ system: true }));
  db.prepare('UPDATE chats SET updated_at=unixepoch() WHERE id=?').run(chatId);
  sendTo(memberIds(chatId), 'message', messageById(id));
}

// The note a chat is about, for members to read (they don't need to own it).
router.get('/:id/note', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  if (!chat.note_id) throw new HttpError(404, 'This chat isn’t about a note');
  const note = db.prepare(`SELECT id, title, content, rich_content, editor_mode, note_type, canvas_data, tags, updated_at, created_at, position, parent_id
    FROM notes WHERE id=? AND deleted_at IS NULL`).get(chat.note_id);
  if (!note) throw new HttpError(404, 'The note has been deleted');
  res.json({ note, owner: nameOf(chat.owner_id, req.user.id) });
}));

// ───────────────────────── messages ─────────────────────────

router.get('/:id/messages', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const before = parseInt(req.query.before, 10);
  const after = parseInt(req.query.after, 10);
  let rows;
  if (after >= 0) rows = db.prepare('SELECT * FROM chat_messages WHERE chat_id=? AND seq>? ORDER BY seq LIMIT ?').all(chat.id, after, limit);
  else if (before > 0) rows = db.prepare('SELECT * FROM chat_messages WHERE chat_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(chat.id, before, limit).reverse();
  else rows = db.prepare('SELECT * FROM chat_messages WHERE chat_id=? ORDER BY seq DESC LIMIT ?').all(chat.id, limit).reverse();
  res.json({ messages: detailMessages(rows), has_more: rows.length === limit });
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHAT_UPLOADS),
    filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10)),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

router.post('/:id/files', (req, res, next) => {
  try { membership(req.params.id, req.user.id); next(); } catch (e) { next(e); }
}, upload.single('file'), wrap((req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  const id = uuid();
  const name = (req.file.originalname || 'file').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
  const dim = v => (Number.isInteger(+v) && +v > 0 && +v < 100000 ? +v : null);
  db.prepare('INSERT INTO chat_files (id, chat_id, user_id, filename, original_name, mime_type, size, width, height) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.params.id, req.user.id, req.file.filename, name, req.file.mimetype || 'application/octet-stream', req.file.size, dim(req.body.width), dim(req.body.height));
  res.json({ file: { id, name, mime: req.file.mimetype, size: req.file.size } });
}));

function cleanGif(gif) {
  if (!gif || typeof gif !== 'object') return null;
  const ok = u => typeof u === 'string' && u.length < 2000 && /^https:\/\/[^\s"'<>]+$/i.test(u);
  if (!ok(gif.url)) return null;
  return {
    url: gif.url, preview: ok(gif.preview) ? gif.preview : gif.url,
    width: Number.isFinite(+gif.width) ? +gif.width : null, height: Number.isFinite(+gif.height) ? +gif.height : null,
    title: typeof gif.title === 'string' ? gif.title.slice(0, 120) : '',
  };
}

router.post('/:id/messages', sendLimit, wrap(async (req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').slice(0, 8000);
  const gif = cleanGif(req.body?.gif);
  const fileIds = Array.isArray(req.body?.file_ids) ? req.body.file_ids.filter(x => typeof x === 'string').slice(0, 20) : [];
  const files = fileIds.map(fid => db.prepare('SELECT id FROM chat_files WHERE id=? AND chat_id=? AND user_id=? AND message_id IS NULL').get(fid, chat.id, req.user.id)).filter(Boolean);
  if (!body.trim() && !gif && !files.length) throw new HttpError(400, 'Empty message');
  let replyTo = typeof req.body?.reply_to === 'string' ? req.body.reply_to : null;
  if (replyTo && !db.prepare('SELECT 1 FROM chat_messages WHERE id=? AND chat_id=?').get(replyTo, chat.id)) replyTo = null;

  const id = uuid();
  db.transaction(() => {
    db.prepare('INSERT INTO chat_messages (id, chat_id, user_id, body, reply_to, gif) VALUES (?,?,?,?,?,?)')
      .run(id, chat.id, req.user.id, body, replyTo, gif ? JSON.stringify(gif) : null);
    const attach = db.prepare('UPDATE chat_files SET message_id=? WHERE id=?');
    for (const f of files) attach.run(id, f.id);
    const seq = db.prepare('SELECT seq FROM chat_messages WHERE id=?').get(id).seq;
    db.prepare('UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?').run(seq, chat.id, req.user.id);
    db.prepare('UPDATE chats SET updated_at=unixepoch() WHERE id=?').run(chat.id);
  })();
  const message = messageById(id);
  const members = memberIds(chat.id);
  sendTo(members, 'message', message);
  res.json({ message });
  notifyMembers(chat, message, members).catch(err => console.warn('Notify failed:', err.message));
}));

async function notifyMembers(chat, message, members) {
  const mentioned = new Set();
  const everyone = /(^|\s)@(everyone|all)\b/i.test(message.body);
  for (const m of message.body.matchAll(/(^|[^\w@])@([A-Za-z0-9_.-]{1,40})/g)) {
    const u = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(m[2]);
    if (u) mentioned.add(u.id);
  }
  const text = message.body ? message.body.replace(/\s+/g, ' ').slice(0, 180) : message.gif ? 'sent a GIF' : `sent ${message.files.length > 1 ? `${message.files.length} files` : message.files[0]?.mime?.startsWith('image/') ? 'a picture' : 'a file'}`;
  for (const uid of members) {
    if (uid === message.user_id) continue;
    const member = db.prepare('SELECT muted FROM chat_members WHERE chat_id=? AND user_id=?').get(chat.id, uid);
    const isMention = mentioned.has(uid) || everyone;
    if (member?.muted && !isMention) continue;
    if (isOnScreen(uid)) continue; // they'll see it in the app
    const sender = nameOf(message.user_id, uid);
    await pushTo(uid, {
      title: isMention ? `${sender} mentioned you in ${chat.name}` : `${sender} · ${chat.name}`,
      body: text, chatId: chat.id, url: `/?chat=${chat.id}`, tag: `chat-${chat.id}`,
    });
  }
}

router.patch('/messages/:mid', wrap((req, res) => {
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(req.params.mid);
  if (!msg) throw new HttpError(404, 'Message not found');
  membership(msg.chat_id, req.user.id);
  if (msg.user_id !== req.user.id || msg.deleted_at) throw new HttpError(403, 'You can only edit your own messages');
  const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').slice(0, 8000);
  const hasOther = msg.gif || db.prepare('SELECT 1 FROM chat_files WHERE message_id=?').get(msg.id);
  if (!body.trim() && !hasOther) throw new HttpError(400, 'Empty message');
  db.prepare('UPDATE chat_messages SET body=?, edited_at=unixepoch() WHERE id=?').run(body, msg.id);
  const message = messageById(msg.id);
  sendTo(memberIds(msg.chat_id), 'message:update', message);
  res.json({ message });
}));

router.delete('/messages/:mid', wrap((req, res) => {
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(req.params.mid);
  if (!msg) throw new HttpError(404, 'Message not found');
  const { chat } = membership(msg.chat_id, req.user.id);
  if (msg.user_id !== req.user.id && chat.owner_id !== req.user.id) throw new HttpError(403, 'You can only delete your own messages');
  const files = db.prepare('SELECT filename FROM chat_files WHERE message_id=?').all(msg.id).map(f => f.filename);
  db.transaction(() => {
    db.prepare(`UPDATE chat_messages SET body='', gif=NULL, deleted_at=unixepoch() WHERE id=?`).run(msg.id);
    db.prepare('DELETE FROM chat_files WHERE message_id=?').run(msg.id);
    db.prepare('DELETE FROM chat_reactions WHERE message_id=?').run(msg.id);
  })();
  removeChatFiles(files);
  const message = messageById(msg.id);
  sendTo(memberIds(msg.chat_id), 'message:update', message);
  res.json({ message });
}));

router.post('/messages/:mid/reactions', wrap((req, res) => {
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id=? AND deleted_at IS NULL').get(req.params.mid);
  if (!msg) throw new HttpError(404, 'Message not found');
  membership(msg.chat_id, req.user.id);
  const emoji = String(req.body?.emoji || '').trim();
  if (!emoji || emoji.length > 16 || [...emoji].length > 4) throw new HttpError(400, 'Invalid reaction');
  const had = db.prepare('SELECT 1 FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?').get(msg.id, req.user.id, emoji);
  if (had) db.prepare('DELETE FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(msg.id, req.user.id, emoji);
  else db.prepare('INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(msg.id, req.user.id, emoji);
  const message = messageById(msg.id);
  sendTo(memberIds(msg.chat_id), 'message:update', message);
  res.json({ message });
}));

router.post('/:id/read', wrap((req, res) => {
  const { chat, member } = membership(req.params.id, req.user.id);
  const seq = parseInt(req.body?.seq, 10);
  if (seq > member.last_read) {
    db.prepare('UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?').run(seq, chat.id, req.user.id);
    sendTo([req.user.id], 'chat', chatSummary(chat, req.user.id)); // clears badges on other devices
  }
  res.json({ ok: true });
}));

router.post('/:id/typing', wrap((req, res) => {
  const { chat } = membership(req.params.id, req.user.id);
  sendTo(memberIds(chat.id).filter(u => u !== req.user.id), 'typing', { chat_id: chat.id, user_id: req.user.id });
  res.json({ ok: true });
}));

// ───────────────────────── GIFs ─────────────────────────
// Search goes through the server so the API key stays private. An admin adds a key from
// GIPHY or Tenor in Settings → Server; without one, people can still paste a GIF link.

router.get('/gifs/search', wrap(async (req, res) => {
  const provider = getSetting('gif_provider') || 'giphy';
  const key = getSetting('gif_api_key');
  if (!key) return res.json({ enabled: false, results: [] });
  const q = String(req.query.q || '').trim().slice(0, 100);
  try {
    let results;
    if (provider === 'tenor') {
      const url = new URL(q ? 'https://tenor.googleapis.com/v2/search' : 'https://tenor.googleapis.com/v2/featured');
      url.search = new URLSearchParams({ key, client_key: 'synapse', limit: '24', media_filter: 'gif,tinygif', contentfilter: 'medium', ...(q ? { q } : {}) });
      const data = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
      results = (data.results || []).map(r => ({
        url: r.media_formats?.gif?.url, preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
        width: r.media_formats?.gif?.dims?.[0], height: r.media_formats?.gif?.dims?.[1], title: r.content_description || '',
      }));
    } else {
      const url = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
      url.search = new URLSearchParams({ api_key: key, limit: '24', rating: 'pg-13', ...(q ? { q } : {}) });
      const data = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
      results = (data.data || []).map(g => ({
        url: g.images?.original?.url, preview: g.images?.fixed_width?.url || g.images?.original?.url,
        width: +g.images?.original?.width, height: +g.images?.original?.height, title: g.title || '',
      }));
    }
    res.json({ enabled: true, provider, results: results.filter(r => r.url?.startsWith('https://')) });
  } catch (err) {
    throw new HttpError(502, 'GIF search isn’t reachable right now');
  }
}));

// ───────────────────────── push subscriptions ─────────────────────────

router.get('/push/key', (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));

router.post('/push/subscribe', wrap((req, res) => {
  const s = req.body?.subscription;
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000
    || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') throw new HttpError(400, 'Invalid subscription');
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`)
    .run(s.endpoint, req.user.id, s.keys.p256dh.slice(0, 200), s.keys.auth.slice(0, 100));
  res.json({ ok: true });
}));

router.post('/push/unsubscribe', wrap((req, res) => {
  if (typeof req.body?.endpoint === 'string') db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(req.body.endpoint, req.user.id);
  res.json({ ok: true });
}));

router.post('/push/test', wrap(async (req, res) => {
  await pushTo(req.user.id, { title: 'Synapse', body: 'Notifications are working 🎉', url: '/', tag: 'test' });
  res.json({ ok: true });
}));

router.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  next(err);
});

export default router;
