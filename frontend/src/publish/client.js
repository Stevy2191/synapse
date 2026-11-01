// Published links: create/manage them, and keep end-to-end encrypted copies up to date.
//
// Encrypted links: the note is scrambled here in the browser (AES-256-GCM) with a random key that
// lives only in the link, after the "#" (browsers never send that part to the server) and in this
// device's storage, so this device can upload a fresh copy whenever the note is saved.
import api from '../api';
import { getWorkspaceNotes } from '../offline/sync';
import { useStore } from '../stores/useStore';

export const listLinks = noteId => api.get(`/publish/note/${noteId}`).then(r => r.data.links);
export const createLink = (noteId, opts) => api.post(`/publish/note/${noteId}`, opts).then(r => r.data.link);
export const updateLink = (id, fields) => api.patch(`/publish/${id}`, fields).then(r => r.data.link);
export const deleteLink = id => api.delete(`/publish/${id}`).then(() => { forgetKey(id); });

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || (err?.response ? fallback : 'You’re offline — publishing needs a connection');

// ───────────────────────── keys (this device only) ─────────────────────────

const KEYS = 'synapse-publish-keys';
function keys() { try { return JSON.parse(localStorage.getItem(KEYS) || '{}') || {}; } catch { return {}; } }
export function keyFor(id) { return keys()[id] || null; }
function saveKey(id, k) { try { localStorage.setItem(KEYS, JSON.stringify({ ...keys(), [id]: k })); } catch { /* private mode */ } }
function forgetKey(id) { const k = keys(); delete k[id]; try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch { /* ignore */ } }

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));

function bytesToB64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function importKey(k) {
  return crypto.subtle.importKey('raw', unb64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function cryptoAvailable() { return !!(window.crypto && crypto.subtle); }

export async function encryptPayload(payload, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(k), new TextEncoder().encode(JSON.stringify(payload)));
  return { iv: b64u(iv), data: bytesToB64(data) };
}

export async function decryptPayload(blob, k) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(blob.iv) }, await importKey(k), b64ToBytes(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export function linkUrl(link) {
  const base = `${location.origin}/p/${link.id}`;
  if (link.mode !== 'e2e') return base;
  const k = keyFor(link.id);
  return k ? `${base}#k=${k}` : null;
}

// ───────────────────────── encrypted copies ─────────────────────────

/** What a visitor needs to show the note: the note plus any drawings it embeds. */
async function payloadFor(noteId) {
  const ws = useStore.getState().activeWorkspace;
  const all = ws ? await getWorkspaceNotes(ws.id) : [];
  const n = all.find(x => x.id === noteId);
  if (!n) return null;
  const text = `${n.content || ''}${n.rich_content || ''}`;
  const titles = [...text.matchAll(/!\[\[([^\[\]\n]+)\]\]|data-drawing="([^"]+)"/g)].map(m => (m[1] || m[2]).trim().toLowerCase());
  const drawings = all.filter(d => d.note_type === 'draw' && titles.includes(d.title.toLowerCase()))
    .map(d => ({ id: d.id, title: d.title, note_type: d.note_type, canvas_data: d.canvas_data }));
  return {
    note: { id: n.id, title: n.title, content: n.content, rich_content: n.rich_content, editor_mode: n.editor_mode, note_type: n.note_type, canvas_data: n.canvas_data, tags: n.tags, updated_at: n.updated_at, position: 0, parent_id: null },
    drawings,
  };
}

/** Encrypt the note as it is now and upload it for one encrypted link (needs this device's key). */
export async function uploadEncrypted(link) {
  const k = keyFor(link.id);
  if (!k) return false;
  const payload = await payloadFor(link.note_id);
  if (!payload) return false;
  await api.put(`/publish/${link.id}/blob`, { blob: await encryptPayload(payload, k) }, { timeout: 60_000 });
  return true;
}

/** New encrypted link: make a key, create the link, upload the first copy. */
export async function createEncryptedLink(noteId, opts) {
  const k = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const link = await createLink(noteId, { ...opts, mode: 'e2e' });
  saveKey(link.id, k);
  await uploadEncrypted(link);
  return link;
}

// Notes I'm looking at that have encrypted links: refresh their copies after saves.
const encryptedLinks = new Map(); // noteId → [link]
const timers = new Map();

export function rememberLinks(noteId, links) {
  encryptedLinks.set(noteId, links.filter(l => l.mode === 'e2e' && keyFor(l.id)));
}

/** Call after a note is saved: re-encrypts its encrypted links a few seconds later. */
export function noteSaved(noteId) {
  if (!encryptedLinks.get(noteId)?.length) return;
  clearTimeout(timers.get(noteId));
  timers.set(noteId, setTimeout(async () => {
    for (const l of encryptedLinks.get(noteId) || []) {
      try { await uploadEncrypted(l); } catch { /* offline: next save tries again */ }
    }
  }, 3000));
}
