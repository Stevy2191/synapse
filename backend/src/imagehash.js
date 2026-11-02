// Pictures inside notes are stored as data: URLs. OCR results are kept per picture, keyed by a
// quick hash of its data URL — the browser computes the same hash (frontend/src/ocr/hash.js), so it
// can look up the text for the pictures it has without sending them.

/** cyrb53: fast 53-bit string hash, as a base-36 string. Must match the browser's copy. */
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

/** The pictures in a note (Write-mode HTML and Markdown), deduplicated: [{ hash, dataUrl }]. */
export function noteImages(note) {
  const seen = new Map();
  for (const text of [note.rich_content || '', note.content || '']) {
    for (const m of text.matchAll(IMG_RE)) {
      if (m[0].length < 3000) continue; // icons / tiny images: nothing to read
      const hash = imageHash(m[0]);
      if (!seen.has(hash)) seen.set(hash, m[0]);
    }
  }
  return [...seen].map(([hash, dataUrl]) => ({ hash, dataUrl }));
}
