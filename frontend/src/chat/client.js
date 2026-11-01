// Chat data layer: the list of chats, messages, people, and the live connection to the server.
//
// Chat needs the internet (it's live by nature): nothing is stored on the device. One stream per
// open app receives new messages, edits, reactions, typing and presence as they happen; after a
// lost connection the app reconnects and catches up.
import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import { handleShareEvent, loadShares } from '../shares/client';

export const useChat = create(() => ({
  connected: false,
  conn: null,            // id of this app's live connection (for "is it on screen")
  chats: [],             // summaries, newest activity first
  loaded: false,
  users: {},             // id → { id, username, display_name, nickname (mine for them), avatar, online }
  messages: {},          // chatId → [message] (oldest first)
  hasMore: {},           // chatId → bool (older messages exist)
  typing: {},            // chatId → { userId: until }
  openChatId: null,      // the chat currently on screen (main view or note panel)
}));

const set = useChat.setState;
const get = useChat.getState;
const me = () => useStore.getState().user?.id;

export const totalUnread = s => s.chats.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);

function sortChats(chats) {
  return [...chats].sort((a, b) => (b.last?.created_at || b.updated_at || 0) - (a.last?.created_at || a.updated_at || 0));
}
function upsertChat(chat) {
  set(s => ({ chats: sortChats([...s.chats.filter(c => c.id !== chat.id), chat]) }));
}
function upsertMessage(m) {
  set(s => {
    const list = s.messages[m.chat_id];
    if (!list) return {};
    const i = list.findIndex(x => x.id === m.id);
    const next = i >= 0 ? list.map(x => (x.id === m.id ? m : x)) : [...list, m].sort((a, b) => a.seq - b.seq);
    return { messages: { ...s.messages, [m.chat_id]: next } };
  });
}

// ───────────────────────── live stream ─────────────────────────

let controller = null;
let retry = 1000;
let started = false;

export function startChat() {
  if (started) return;
  started = true;
  connect();
  document.addEventListener('visibilitychange', reportVisibility);
  window.addEventListener('focus', reportVisibility);
  window.addEventListener('online', () => { if (!get().connected) { retry = 1000; connect(); } });
}

export function stopChat() {
  started = false;
  controller?.abort();
  controller = null;
  document.removeEventListener('visibilitychange', reportVisibility);
  window.removeEventListener('focus', reportVisibility);
  useChat.setState({ connected: false, conn: null, chats: [], loaded: false, messages: {}, hasMore: {}, typing: {}, users: {} }, false);
}

function onScreen() { return document.visibilityState === 'visible'; }
function reportVisibility() {
  const conn = get().conn;
  if (conn) api.post('/chats/presence', { conn, visible: onScreen() }).catch(() => {});
  if (onScreen()) markOpenChatRead();
}

async function connect() {
  if (!started) return;
  controller?.abort();
  controller = new AbortController();
  const token = (() => { try { return JSON.parse(localStorage.getItem('synapse-store') || '{}')?.state?.token; } catch { return null; } })();
  if (!token) return;
  try {
    // fetch (not EventSource) so the sign-in token goes in a header, not the URL.
    const res = await fetch('/api/chats/events', { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store' });
    if (res.status === 401) { started = false; return; }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    retry = 1000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let type = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) type = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { handle(type, JSON.parse(data)); } catch (e) { console.warn('chat event', e); } }
      }
    }
    throw new Error('stream ended');
  } catch (err) {
    if (err.name === 'AbortError' || !started) return;
    set({ connected: false, conn: null });
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30_000);
  }
}

function handle(type, data) {
  switch (type) {
    case 'hello':
      set({ connected: true, conn: data.conn });
      reportVisibility();
      // (Re)connected: refresh everything that may have changed meanwhile.
      loadChats();
      loadUsers();
      loadShares();
      for (const id of Object.keys(get().messages)) catchUp(id);
      break;
    case 'chat': upsertChat(data); break;
    case 'chat:removed':
      set(s => ({ chats: s.chats.filter(c => c.id !== data.id), openChatId: s.openChatId === data.id ? null : s.openChatId }));
      break;
    case 'message': onNewMessage(data); break;
    case 'message:update': upsertMessage(data); break;
    case 'typing':
      set(s => ({ typing: { ...s.typing, [data.chat_id]: { ...(s.typing[data.chat_id] || {}), [data.user_id]: Date.now() + 4000 } } }));
      setTimeout(() => set(s => ({ typing: { ...s.typing } })), 4100); // re-render to clear it
      break;
    case 'note:update':
    case 'note:lock':
    case 'share:changed':
      handleShareEvent(type, data);
      break;
    case 'presence':
      set(s => (s.users[data.user_id] ? { users: { ...s.users, [data.user_id]: { ...s.users[data.user_id], online: data.online } } } : {}));
      break;
    default:
  }
}

function onNewMessage(m) {
  upsertMessage(m);
  const mine = m.user_id === me();
  // Clear the sender's typing dot
  set(s => {
    const t = { ...(s.typing[m.chat_id] || {}) };
    delete t[m.user_id];
    return { typing: { ...s.typing, [m.chat_id]: t } };
  });
  const chat = get().chats.find(c => c.id === m.chat_id);
  if (!chat) { loadChats(); return; }
  const viewing = get().openChatId === m.chat_id && onScreen();
  const preview = { seq: m.seq, user_id: m.user_id, created_at: m.created_at, text: m.body || (m.gif ? 'GIF' : '📎 File') };
  upsertChat({ ...chat, last: preview, unread: mine || viewing ? chat.unread : chat.unread + 1, last_read: mine ? m.seq : chat.last_read });
  if (viewing && !mine) markRead(m.chat_id, m.seq);
  // A small heads-up when the message is for another chat (or the chat isn't on screen).
  if (!mine && !viewing && !m.gif?.system && onScreen()) {
    const mention = mentionsMe(m.body);
    if (!chat.muted || mention) {
      toast(`${userName(m.user_id)} · ${chat.name}: ${preview.text.slice(0, 80)}`, { icon: mention ? '🔔' : '💬', duration: 4000 });
    }
  }
}

function mentionsMe(body) {
  const u = useStore.getState().user;
  if (!u || !body) return false;
  return new RegExp(`(^|[^\\w@])@(${u.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|everyone|all)\\b`, 'i').test(body);
}

/** What to call someone: my nickname for them, else their own name, else their username. */
export function personName(u) {
  if (!u) return 'Someone';
  return u.nickname || u.display_name || u.username || 'Someone';
}

export function userName(id) {
  const u = get().users[id];
  return u ? personName(u) : 'Someone';
}

/** Set (or clear with '') my nickname for someone. Only I see it. */
export async function setNickname(userId, nickname) {
  try {
    const { data } = await api.put(`/chats/nicknames/${userId}`, { nickname });
    const nick = data.user.nickname;
    set(s => ({
      users: { ...s.users, [userId]: { ...(s.users[userId] || data.user), nickname: nick } },
      chats: s.chats.map(c => ({ ...c, members: c.members.map(m => (m.id === userId ? { ...m, nickname: nick } : m)) })),
    }));
    return true;
  } catch (err) { toast.error(errorText(err, 'Could not save the nickname')); return false; }
}

// ───────────────────────── loading ─────────────────────────

export async function loadChats() {
  try {
    const { data } = await api.get('/chats');
    set({ chats: sortChats(data.chats), loaded: true });
    // Keep the people list in step with chat members
    set(s => {
      const users = { ...s.users };
      for (const c of data.chats) for (const m of c.members) users[m.id] = { ...(users[m.id] || {}), ...m };
      return { users };
    });
  } catch { set({ loaded: true }); }
}

export async function loadUsers() {
  try {
    const { data } = await api.get('/chats/users');
    set({ users: Object.fromEntries(data.users.map(u => [u.id, u])) });
  } catch { /* offline */ }
}

export async function loadMessages(chatId) {
  const { data } = await api.get(`/chats/${chatId}/messages`, { params: { limit: 50 } });
  set(s => ({ messages: { ...s.messages, [chatId]: data.messages }, hasMore: { ...s.hasMore, [chatId]: data.has_more } }));
  return data.messages;
}

export async function loadOlder(chatId) {
  const list = get().messages[chatId] || [];
  if (!list.length) return 0;
  const { data } = await api.get(`/chats/${chatId}/messages`, { params: { before: list[0].seq, limit: 50 } });
  set(s => ({
    messages: { ...s.messages, [chatId]: [...data.messages, ...(s.messages[chatId] || [])] },
    hasMore: { ...s.hasMore, [chatId]: data.has_more },
  }));
  return data.messages.length;
}

async function catchUp(chatId) {
  const list = get().messages[chatId];
  if (!list) return;
  const after = list.length ? list[list.length - 1].seq : 0;
  try {
    const { data } = await api.get(`/chats/${chatId}/messages`, { params: { after, limit: 100 } });
    for (const m of data.messages) upsertMessage(m);
    if (data.has_more) loadMessages(chatId);
  } catch { /* try again on next reconnect */ }
}

// ───────────────────────── reading ─────────────────────────

export function setOpenChat(chatId) {
  set({ openChatId: chatId });
  if (chatId) markOpenChatRead();
}

function markOpenChatRead() {
  const id = get().openChatId;
  if (!id || !onScreen()) return;
  const list = get().messages[id];
  const chat = get().chats.find(c => c.id === id);
  const seq = list?.length ? list[list.length - 1].seq : chat?.last?.seq;
  if (seq) markRead(id, seq);
}

export function markRead(chatId, seq) {
  const chat = get().chats.find(c => c.id === chatId);
  if (!chat || (chat.last_read >= seq && chat.unread === 0)) return;
  upsertChat({ ...chat, unread: 0, last_read: Math.max(chat.last_read, seq) });
  api.post(`/chats/${chatId}/read`, { seq }).catch(() => {});
}

// ───────────────────────── actions ─────────────────────────

const errorText = (err, fallback) => err?.response?.data?.error || (err?.response ? fallback : 'You’re offline — chat needs a connection');

export async function createChat({ name, icon, note_id, member_ids }) {
  try {
    const { data } = await api.post('/chats', { name, icon, note_id, member_ids });
    upsertChat(data.chat);
    return data.chat;
  } catch (err) { toast.error(errorText(err, 'Could not start the chat')); throw err; }
}

export async function chatForNote(noteId) {
  try { return (await api.get(`/chats/by-note/${noteId}`)).data.chat; } catch { return null; }
}

export async function updateChat(chatId, fields) {
  try { const { data } = await api.patch(`/chats/${chatId}`, fields); upsertChat(data.chat); return data.chat; } catch (err) { toast.error(errorText(err, 'Could not change the chat')); return null; }
}

export async function addMembers(chatId, userIds) {
  try { await api.post(`/chats/${chatId}/members`, { user_ids: userIds }); return true; } catch (err) { toast.error(errorText(err, 'Could not add people')); return false; }
}

export async function removeMember(chatId, userId) {
  try {
    await api.delete(`/chats/${chatId}/members/${userId}`);
    if (userId === me()) set(s => ({ chats: s.chats.filter(c => c.id !== chatId), openChatId: s.openChatId === chatId ? null : s.openChatId }));
    return true;
  } catch (err) { toast.error(errorText(err, 'Could not remove them')); return false; }
}

export async function deleteChat(chatId) {
  try {
    await api.delete(`/chats/${chatId}`);
    set(s => ({ chats: s.chats.filter(c => c.id !== chatId), openChatId: s.openChatId === chatId ? null : s.openChatId }));
    return true;
  } catch (err) { toast.error(errorText(err, 'Could not delete the chat')); return false; }
}

/** Picture size, so the message has the right shape before the picture loads. */
function imageSize(file) {
  if (!file.type.startsWith('image/')) return Promise.resolve({});
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export async function uploadFile(chatId, file, onProgress) {
  const form = new FormData();
  const { width, height } = await imageSize(file);
  if (width) { form.append('width', width); form.append('height', height); }
  form.append('file', file, file.name || 'file');
  const { data } = await api.post(`/chats/${chatId}/files`, form, {
    timeout: 10 * 60_000,
    onUploadProgress: e => onProgress?.(e.total ? e.loaded / e.total : 0),
  });
  return data.file;
}

export async function sendMessage(chatId, { body = '', reply_to = null, gif = null, file_ids = [] }) {
  try {
    const { data } = await api.post(`/chats/${chatId}/messages`, { body, reply_to, gif, file_ids });
    onNewMessage(data.message);
    return data.message;
  } catch (err) { toast.error(errorText(err, 'Message not sent')); throw err; }
}

export async function editMessage(id, body) {
  try { const { data } = await api.patch(`/chats/messages/${id}`, { body }); upsertMessage(data.message); return true; } catch (err) { toast.error(errorText(err, 'Could not edit')); return false; }
}

export async function deleteMessage(id) {
  try { const { data } = await api.delete(`/chats/messages/${id}`); upsertMessage(data.message); } catch (err) { toast.error(errorText(err, 'Could not delete')); }
}

export async function toggleReaction(message, emoji) {
  // Show it straight away; the server's answer (and everyone else's screens) follow.
  const uid = me();
  const users = message.reactions[emoji] || [];
  const nextUsers = users.includes(uid) ? users.filter(u => u !== uid) : [...users, uid];
  const reactions = { ...message.reactions, [emoji]: nextUsers };
  if (!nextUsers.length) delete reactions[emoji];
  upsertMessage({ ...message, reactions });
  try { const { data } = await api.post(`/chats/messages/${message.id}/reactions`, { emoji }); upsertMessage(data.message); } catch (err) { upsertMessage(message); toast.error(errorText(err, 'Could not react')); }
}

let lastTyping = 0;
export function sendTyping(chatId) {
  if (Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  api.post(`/chats/${chatId}/typing`).catch(() => {});
}

export async function searchGifs(q) {
  const { data } = await api.get('/chats/gifs/search', { params: { q } });
  return data;
}

export async function fetchChatNote(chatId) {
  return (await api.get(`/chats/${chatId}/note`)).data;
}

// ───────────────────────── notifications ─────────────────────────

function b64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

/** 'on' | 'off' | 'blocked' | 'insecure' | 'unsupported' */
export async function notificationState() {
  // Browsers only allow notifications on https:// (or localhost) — on http://10.x.x.x they're off.
  if (!window.isSecureContext) return 'insecure';
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
  } catch { return 'off'; }
}

export async function enableNotifications() {
  if (!notificationsSupported()) {
    toast.error(/iPad|iPhone/.test(navigator.userAgent)
      ? 'On iPad/iPhone, first add Synapse to your Home Screen (Share → Add to Home Screen), then turn notifications on from there.'
      : 'This browser can’t show notifications.', { duration: 8000 });
    return false;
  }
  if (!window.isSecureContext) { toast.error('Notifications need Synapse to be opened over https://'); return false; }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { toast.error('Notifications were not allowed'); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { data } = await api.get('/chats/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.key) });
    await api.post('/chats/push/subscribe', { subscription: sub.toJSON() });
    toast.success('Notifications are on for this device');
    return true;
  } catch (err) {
    console.error(err);
    toast.error('Could not turn notifications on');
    return false;
  }
}

export async function disableNotifications() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.post('/chats/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    toast.success('Notifications are off for this device');
  } catch { toast.error('Could not turn notifications off'); }
}

/** Signing out: stop this device getting my notifications (quietly). */
export async function forgetPushOnThisDevice() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await api.post('/chats/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* nothing to do */ }
}
