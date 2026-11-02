// OCR — reading printed text in pictures, on the server (Tesseract via tesseract.js, all local).
//
// • recognize(image) — for "Copy text" / "Insert text below" on a picture, and scanned PDF pages.
// • A background job reads the pictures inside notes so search (here and on devices) finds words in
//   them; results are kept in ocr_cache by picture hash (imagehash.js).
// • English is built in. The admin can add languages (Settings → Server → Text recognition); each
//   is downloaded once into DATA_DIR/ocr-lang. Devices use the same files when they read text
//   offline (served at /ocr-assets).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createWorker } from 'tesseract.js';
import { db, indexNote } from './db/index.js';
import { DATA_DIR } from './config.js';
import { getSetting, setSetting } from './settings.js';
import { noteImages } from './imagehash.js';

const require = createRequire(import.meta.url);
export class OcrError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const LANG_DIR = path.join(DATA_DIR, 'ocr-lang');
const BUILTIN_ENG = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int', 'eng.traineddata.gz');
export const CORE_DIR = path.dirname(require.resolve('tesseract.js-core/package.json'));
export const WORKER_FILE = path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'dist', 'worker.min.js');

// Languages that can be added (Tesseract codes). Names are for the settings page.
export const LANGUAGES = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian', por: 'Portuguese', nld: 'Dutch',
  pol: 'Polish', ces: 'Czech', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', tur: 'Turkish',
  ell: 'Greek', rus: 'Russian', ukr: 'Ukrainian', heb: 'Hebrew', ara: 'Arabic', hin: 'Hindi', vie: 'Vietnamese',
  tha: 'Thai', jpn: 'Japanese', kor: 'Korean', chi_sim: 'Chinese (Simplified)', chi_tra: 'Chinese (Traditional)', tgl: 'Tagalog',
};
const LANG_URL = code => (process.env.OCR_LANG_URL || 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/{code}/4.0.0_best_int/{code}.traineddata.gz').replaceAll('{code}', code);

fs.mkdirSync(LANG_DIR, { recursive: true });
if (!fs.existsSync(path.join(LANG_DIR, 'eng.traineddata.gz'))) {
  try { fs.copyFileSync(BUILTIN_ENG, path.join(LANG_DIR, 'eng.traineddata.gz')); } catch (err) { console.error('OCR: could not set up English:', err.message); }
}

db.exec(`CREATE TABLE IF NOT EXISTS ocr_note_scan (note_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL)`);

const installed = () => Object.keys(LANGUAGES).filter(c => fs.existsSync(path.join(LANG_DIR, `${c}.traineddata.gz`)));

export function ocrSettings() {
  const have = installed();
  const chosen = (getSetting('ocr_languages') || 'eng').split('+').filter(c => have.includes(c));
  return {
    languages: chosen.length ? chosen : ['eng'],
    installed: have,
    available: LANGUAGES,
    index_pictures: getSetting('ocr_index') !== 'false',
    indexed: db.prepare('SELECT COUNT(*) AS n FROM ocr_cache').get().n,
    with_text: db.prepare("SELECT COUNT(*) AS n FROM ocr_cache WHERE text != ''").get().n,
    waiting: pendingNotes().length,
  };
}
const langString = () => ocrSettings().languages.join('+');

// ───────────────────────── one worker, one job at a time ─────────────────────────

let worker = null;
let workerLangs = '';
let idleTimer = null;
let queue = Promise.resolve();

async function getWorker() {
  const langs = langString();
  if (worker && workerLangs === langs) return worker;
  if (worker) { try { await worker.terminate(); } catch { /* gone */ } worker = null; }
  worker = await createWorker(langs, 1, { langPath: LANG_DIR, gzip: true, cacheMethod: 'none' });
  workerLangs = langs;
  return worker;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => { const w = worker; worker = null; try { await w?.terminate(); } catch { /* gone */ } }, 3 * 60_000);
  idleTimer.unref?.();
}

/** Read the text in a picture (Buffer or data URL). Resolves { text, confidence }. */
export function recognize(image) {
  const buf = Buffer.isBuffer(image) ? image : Buffer.from(String(image).replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) return Promise.reject(new OcrError(400, 'No picture'));
  if (buf.length > 20 * 1024 * 1024) return Promise.reject(new OcrError(413, 'That picture is too big (over 20 MB)'));
  const job = queue.then(async () => {
    clearTimeout(idleTimer);
    try {
      const w = await getWorker();
      const r = await w.recognize(buf);
      return { text: tidy(r.data.text), confidence: Math.round(r.data.confidence || 0) };
    } catch (err) {
      throw new OcrError(400, /read|format|image/i.test(String(err?.message || err)) ? 'That picture couldn’t be read' : `Text recognition failed: ${err?.message || err}`);
    } finally { scheduleIdle(); }
  });
  queue = job.catch(() => {});
  return job;
}

// Tesseract output: drop empty lines at the ends and runs of blank lines, keep line breaks.
const tidy = t => String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ───────────────────────── settings / languages ─────────────────────────

export function updateOcrSettings(body) {
  if (body.languages !== undefined) {
    const have = installed();
    const list = (Array.isArray(body.languages) ? body.languages : String(body.languages).split('+')).filter(c => have.includes(c));
    if (!list.length) throw new OcrError(400, 'Choose at least one language');
    setSetting('ocr_languages', list.join('+'));
    // Pictures read with the old languages are read again.
    db.exec('DELETE FROM ocr_cache; DELETE FROM ocr_note_scan;');
  }
  if (body.index_pictures !== undefined) setSetting('ocr_index', body.index_pictures ? 'true' : 'false');
  return ocrSettings();
}

/** Download a language once (needs the server to reach the internet). */
export async function addLanguage(code) {
  if (!LANGUAGES[code]) throw new OcrError(400, 'Unknown language');
  const dest = path.join(LANG_DIR, `${code}.traineddata.gz`);
  if (fs.existsSync(dest)) return ocrSettings();
  let res;
  try { res = await fetch(LANG_URL(code)); } catch {
    throw new OcrError(502, 'The server couldn’t download it — check that it can reach the internet');
  }
  if (!res.ok) throw new OcrError(502, `Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100_000 || buf[0] !== 0x1f || buf[1] !== 0x8b) throw new OcrError(502, 'The download didn’t look right — try again later');
  fs.writeFileSync(`${dest}.partial`, buf);
  fs.renameSync(`${dest}.partial`, dest);
  return ocrSettings();
}

export function removeLanguage(code) {
  if (code === 'eng') throw new OcrError(400, 'English is built in');
  fs.rmSync(path.join(LANG_DIR, `${code}.traineddata.gz`), { force: true });
  const left = (getSetting('ocr_languages') || 'eng').split('+').filter(c => c !== code);
  setSetting('ocr_languages', left.length ? left.join('+') : 'eng');
  return ocrSettings();
}

// ───────────────────────── reading the pictures in notes ─────────────────────────

const lookupStmt = db.prepare('SELECT hash, text FROM ocr_cache WHERE hash=?');
/** Text for pictures the browser already has (by hash): { hash: text } — unknown ones are left out. */
export function lookup(hashes) {
  const out = {};
  for (const h of hashes.slice(0, 2000)) {
    const row = lookupStmt.get(String(h));
    if (row) out[row.hash] = row.text;
  }
  return out;
}

function pendingNotes(limit = 1000) {
  return db.prepare(`
    SELECT n.id, n.updated_at FROM notes n LEFT JOIN ocr_note_scan s ON s.note_id = n.id
    WHERE n.deleted_at IS NULL AND (n.rich_content LIKE '%data:image/%' OR n.content LIKE '%data:image/%')
      AND (s.updated_at IS NULL OR s.updated_at != n.updated_at)
    LIMIT ?`).all(limit);
}

let indexing = false;
async function indexPictures() {
  if (indexing || getSetting('ocr_index') === 'false') return;
  indexing = true;
  const started = Date.now();
  try {
    for (const { id } of pendingNotes(20)) {
      const note = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
      if (!note) continue;
      for (const img of noteImages(note)) {
        if (lookupStmt.get(img.hash)) continue;
        let r = { text: '', confidence: 0 };
        try { r = await recognize(img.dataUrl); } catch { /* unreadable picture: remember it as empty */ }
        db.prepare('INSERT OR REPLACE INTO ocr_cache (hash, text, lang, confidence) VALUES (?, ?, ?, ?)').run(img.hash, r.text, langString(), r.confidence);
        if (Date.now() - started > 90_000) break; // keep each round short
      }
      db.prepare('INSERT OR REPLACE INTO ocr_note_scan (note_id, updated_at) VALUES (?, ?)').run(note.id, note.updated_at);
      indexNote(note); // so server search (and Ask AI) finds the words in its pictures
      if (Date.now() - started > 90_000) break;
    }
  } catch (err) {
    console.error('OCR indexing:', err.message);
  } finally {
    indexing = false;
  }
}

export function startOcrIndexing() {
  setTimeout(indexPictures, 30_000).unref();
  setInterval(indexPictures, 2 * 60_000).unref();
}
export const indexNow = () => indexPictures();

export async function closeOcr() {
  clearTimeout(idleTimer);
  const w = worker; worker = null;
  try { await w?.terminate(); } catch { /* gone */ }
}
