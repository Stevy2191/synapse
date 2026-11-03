// PDF files for PDF blocks.
//
// The PDF itself is an attachment on the server (one file per block, the id is chosen here so a block
// added offline already points at it). This device keeps a copy in IndexedDB (`pdfs`), so PDFs that were
// opened once also open offline; ones added offline wait there (`pending`) until they're uploaded.
// Markings are not in the file — they live in the block (see PdfNode.js).
import toast from 'react-hot-toast';
import api from '../api';
import { db } from '../offline/db';

const MAX_BYTES = 50 * 1024 * 1024;       // same as the server's upload limit
const CACHE_BYTES = 400 * 1024 * 1024;    // offline copies kept on this device (not counting unsent ones)

export function newId() { // a random UUID v4
  // crypto.randomUUID needs https; getRandomValues works on http://LAN addresses too.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function store() { try { return await db(); } catch { return null; } }
async function put(rec) { try { await (await store())?.put('pdfs', rec); } catch { /* storage full / private mode */ } }

/** Keep a PDF picked on this device and start uploading it. Returns the block attributes. */
export async function addPdf(file, noteId) {
  if (!file) throw new Error('No file');
  if (file.size > MAX_BYTES) throw new Error('That PDF is over 50 MB');
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') throw new Error('That file isn’t a PDF');
  const { loadPdf } = await import('./pdfjs');
  const pdf = await loadPdf(await file.arrayBuffer()).catch(() => { throw new Error('That PDF couldn’t be opened (damaged or password-protected?)'); });
  const pages = pdf.numPages;
  pdf.destroy();
  const id = newId();
  const name = (file.name || 'Document.pdf').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
  const blob = file.slice(0, file.size, 'application/pdf');
  await put({ id, blob, name, noteId, pending: true, size: file.size, usedAt: Date.now() });
  uploadPending().catch(() => {});
  return { id, name, pages };
}

let uploading = null;
/** Upload PDFs added on this device that haven't reached the server yet (safe to call often). */
export function uploadPending() {
  uploading ||= (async () => {
    const d = await store();
    if (!d || !navigator.onLine) return;
    for (const rec of await d.getAll('pdfs')) {
      if (!rec.pending) continue;
      const form = new FormData();
      form.append('file', new File([rec.blob], rec.name, { type: rec.mime || 'application/pdf' }));
      try {
        await api.post(`/attachments/note/${rec.noteId}?id=${rec.id}`, form, { timeout: 0 });
        await put({ ...rec, pending: false });
      } catch (err) {
        const s = err.response?.status;
        // 404: the note isn't on the server yet (made offline) — try again after the next sync.
        if (s === 409 || s === 400 || s === 413) {
          await put({ ...rec, pending: false });
          toast.error(`“${rec.name}” couldn’t be uploaded${s === 413 ? ' (too large)' : ''}`);
        }
      }
    }
  })().finally(() => { uploading = null; });
  return uploading;
}

/** Keep any file (Import) to be uploaded as an attachment of `noteId` with the given id. */
export async function queueFile(id, blob, name, noteId, mime) {
  await put({ id, blob, name, noteId, mime: mime || blob.type || 'application/octet-stream', pending: true, size: blob.size, usedAt: Date.now() });
}

export async function hasPending() {
  const d = await store();
  return !!d && (await d.getAll('pdfs')).some(r => r.pending);
}

async function trimCache(d) {
  const all = (await d.getAll('pdfs')).filter(r => !r.pending).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
  let total = 0;
  for (const r of all) {
    total += r.size || 0;
    if (total > CACHE_BYTES) await d.delete('pdfs', r.id);
  }
}

const memory = new Map(); // id → Promise<ArrayBuffer> (this tab)

/** The PDF's bytes: this device's copy, else downloaded (and kept for offline). */
export function pdfBytes(id) {
  if (!memory.has(id)) {
    const p = (async () => {
      const d = await store();
      const rec = d && await d.get('pdfs', id);
      if (rec?.blob) {
        put({ ...rec, usedAt: Date.now() });
        return rec.blob.arrayBuffer();
      }
      const { data, headers } = await api.get(`/attachments/${id}`, { responseType: 'arraybuffer', timeout: 0 });
      if (d) {
        const name = /filename\*=UTF-8''([^;]+)/.exec(headers['content-disposition'] || '')?.[1];
        await put({ id, blob: new Blob([data], { type: 'application/pdf' }), name: name ? decodeURIComponent(name) : 'Document.pdf', pending: false, size: data.byteLength, usedAt: Date.now() });
        trimCache(d).catch(() => {});
      }
      return data;
    })();
    memory.set(id, p);
    p.catch(() => memory.delete(id));
  }
  // pdf.js takes ownership of the buffer it's given, so hand out copies.
  return memory.get(id).then(b => b.slice(0));
}

export function pdfError(err) {
  if (err?.response?.status === 404) return 'This PDF isn’t on the server (it may still be uploading from another device).';
  if (!navigator.onLine || err?.code === 'ERR_NETWORK') return 'You’re offline and this PDF hasn’t been opened on this device before.';
  return err?.message || 'The PDF couldn’t be loaded';
}
