// Same picture hash as the server (backend/src/imagehash.js) — keep the two in sync.
export function imageHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const IMG_RE = /data:image\/(?:png|jpe?g|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=]+/g;
const cache = new Map(); // note id + updated → hashes (hashing big pictures isn't free)

/** Hashes of the (non-tiny) pictures in a note. */
export function noteImageHashes(note) {
  const key = `${note.id}:${note.updated_at}:${(note.rich_content || '').length}:${(note.content || '').length}`;
  if (cache.has(key)) return cache.get(key);
  const out = new Set();
  for (const text of [note.rich_content || '', note.content || '']) {
    if (!text.includes('data:image/')) continue;
    for (const m of text.matchAll(IMG_RE)) if (m[0].length >= 3000) out.add(imageHash(m[0]));
  }
  const list = [...out];
  cache.set(key, list);
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return list;
}
