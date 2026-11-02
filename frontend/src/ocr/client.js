// Text recognition (OCR) in the browser.
//   readText(picture, { handwriting }) — printed text: the Synapse server reads it; when the server
//     can't be reached, this device reads it itself (Tesseract, files served by Synapse and kept for
//     offline use). Handwriting: the person's AI assistant (needs a vision model; online).
//   readPdf(file) — the PDF's own text where it has some, OCR for scanned pages.
//   Search: refreshOcrIndex() fetches the text the server has read from pictures in notes, so local
//     search finds words inside pictures (ocrTextFor(note)).
import api from '../api';
import { db } from '../offline/db';
import { useStore } from '../stores/useStore';
import { noteImageHashes } from './hash';

export const errorText = (err, fallback = 'Couldn’t read the text') =>
  err?.response?.data?.error || err?.message || fallback;

// ───────────────────────── pictures → data URL (resized) ─────────────────────────

async function toImage(src) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** A canvas or picture as a data URL no bigger than `max` px (keeps OCR fast and uploads small). */
export async function pictureDataUrl(src, max = 2600, type = 'image/png') {
  if (typeof src === 'string' && src.length < 6_000_000 && /^data:image\/(png|jpeg|webp);/.test(src)) {
    const img = await toImage(src);
    if (Math.max(img.naturalWidth, img.naturalHeight) <= max) return src;
    src = img;
  }
  const img = src instanceof HTMLCanvasElement || src instanceof HTMLImageElement ? src : await toImage(src);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // transparent → white (reads better)
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.92);
}

// ───────────────────────── reading on this device (offline) ─────────────────────────

let localWorker = null;
let localLangs = '';
const langs = () => { try { return localStorage.getItem('synapse-ocr-langs') || 'eng'; } catch { return 'eng'; } };

async function getLocalWorker() {
  const l = langs();
  if (localWorker && localLangs === l) return localWorker;
  if (localWorker) { try { await localWorker.terminate(); } catch { /* gone */ } }
  const { createWorker } = await import('tesseract.js');
  localWorker = await createWorker(l, 1, {
    workerPath: '/ocr-assets/worker.min.js',
    corePath: '/ocr-assets/core',
    langPath: '/ocr-assets/lang',
    gzip: true,
  });
  localLangs = l;
  return localWorker;
}

async function readLocally(dataUrl, onProgress) {
  onProgress?.('Reading on this device…');
  const w = await getLocalWorker();
  const r = await w.recognize(dataUrl);
  return { text: String(r.data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), confidence: Math.round(r.data.confidence || 0), local: true };
}

/** Get this device ready to read text offline (downloads the reader once, in the background). */
export function prepareOffline() {
  try { if (localStorage.getItem('synapse-ocr-ready') === langs()) return; } catch { return; }
  const go = async () => {
    try {
      await getLocalWorker();
      localStorage.setItem('synapse-ocr-ready', langs());
      setTimeout(async () => { const w = localWorker; localWorker = null; try { await w?.terminate(); } catch { /* gone */ } }, 1000);
    } catch { /* try again another time */ }
  };
  (window.requestIdleCallback || (f => setTimeout(f, 3000)))(go);
}

async function syncLangs() {
  try {
    const { data } = await api.get('/ocr/config');
    const l = (data.languages || ['eng']).join('+');
    if (l !== langs()) { localStorage.setItem('synapse-ocr-langs', l); localStorage.removeItem('synapse-ocr-ready'); }
  } catch { /* offline */ }
}

// ───────────────────────── reading ─────────────────────────

/**
 * Read the text in a picture (data URL, Blob/File, <img> or <canvas>).
 * handwriting: use the AI assistant (vision model) instead of OCR.
 */
export async function readText(src, { handwriting = false, onProgress } = {}) {
  onProgress?.('Getting the picture ready…');
  if (handwriting) {
    const image = await pictureDataUrl(src, 2000, 'image/jpeg');
    onProgress?.('Asking your AI to read it…');
    const ws = useStore.getState().activeWorkspace;
    try {
      const { data } = await api.post('/ai/read-image', { image, workspace_id: ws?.id }, { timeout: 180_000 });
      return { text: data.text, ai: true };
    } catch (err) {
      if (!err.response) throw new Error('Reading handwriting needs a connection (it uses your AI assistant)');
      throw err;
    }
  }
  const image = await pictureDataUrl(src);
  onProgress?.('Reading the text…');
  try {
    const { data } = await api.post('/ocr/image', { image }, { timeout: 120_000 });
    syncLangs().then(prepareOffline);
    return data;
  } catch (err) {
    if (err.response) throw err; // the server answered with a real problem
    return readLocally(image, onProgress); // offline: read it here
  }
}

/** Text of a PDF: its own text where it has some, OCR for scanned pages. */
export async function readPdf(file, { onProgress } = {}) {
  onProgress?.('Opening the PDF…');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  const max = Math.min(pdf.numPages, 50);
  for (let i = 1; i <= max; i++) {
    onProgress?.(`Reading page ${i} of ${max}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let text = '';
    let lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
      text += it.str;
      if (it.hasEOL) text += '\n';
      lastY = y;
    }
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.replace(/\s/g, '').length < 20) {
      // A scanned page: draw it and read the picture.
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      text = (await readText(c, { onProgress: m => onProgress?.(`Page ${i} of ${max}: ${m.toLowerCase()}`) })).text;
    }
    if (text) pages.push(text);
  }
  return { text: pages.join('\n\n'), pages: max, total: pdf.numPages };
}

// ───────────────────────── words in pictures, for search ─────────────────────────

const texts = new Map(); // picture hash → text ('' = no text)
let loaded = null;

function loadTexts() {
  loaded ||= (async () => {
    try {
      const tx = (await db()).transaction('ocr');
      for (let c = await tx.store.openCursor(); c; c = await c.continue()) texts.set(c.key, c.value);
    } catch { /* no store yet */ }
  })();
  return loaded;
}
export function resetOcrIndex() { texts.clear(); loaded = null; }

/** Words read from the pictures in a note ('' if none / not read yet). */
export function ocrTextFor(note) {
  const hashes = noteImageHashes(note);
  if (!hashes.length) return '';
  return hashes.map(h => texts.get(h)).filter(Boolean).join('\n');
}

let refreshing = false;
/** Ask the server for the text of pictures this device has but hasn't got text for yet. */
export async function refreshOcrIndex(notes) {
  if (refreshing) return;
  refreshing = true;
  try {
    await loadTexts();
    const want = new Set();
    for (const n of notes) for (const h of noteImageHashes(n)) if (!texts.has(h)) want.add(h);
    if (!want.size) return;
    const list = [...want];
    const d = await db();
    for (let i = 0; i < list.length; i += 500) {
      const { data } = await api.post('/ocr/lookup', { hashes: list.slice(i, i + 500) });
      const tx = d.transaction('ocr', 'readwrite');
      for (const [h, t] of Object.entries(data.texts || {})) { texts.set(h, t); tx.store.put(t, h); }
      await tx.done;
    }
  } catch { /* offline: next time */ } finally { refreshing = false; }
}

export const ocrReady = () => loadTexts();
