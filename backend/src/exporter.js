// PDF export and picture rendering with a headless Chromium.
//
// The browser builds a complete, self-contained HTML page for the notes being exported (pictures,
// fonts and charts are all inlined as data: URLs). Here we only print that page to PDF, or take
// pictures of small pieces of it (equations, charts) for Word documents.
//
// Safety: the page is not allowed to load anything from the network — every request other than
// data: URLs is blocked — so an exported note can't make the server fetch internal addresses.
import fs from 'fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser', // Alpine (Docker image)
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium', // development sandbox
].filter(Boolean);

export const CHROMIUM = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;

const IDLE_CLOSE_MS = 2 * 60 * 1000; // close the browser when nobody has exported for a while
const JOB_TIMEOUT_MS = 90 * 1000;
const MAX_JOBS = 2;

let browserPromise = null;
let idleTimer = null;
let running = 0;
const waiting = [];

function getBrowser() {
  if (!CHROMIUM) throw Object.assign(new Error('PDF export is not available on this server (Chromium not found)'), { status: 503 });
  browserPromise ||= puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none', '--no-first-run'],
  }).then(b => {
    b.on('disconnected', () => { browserPromise = null; });
    return b;
  }).catch(err => { browserPromise = null; throw err; });
  return browserPromise;
}

async function closeIfIdle() {
  if (running > 0 || !browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { await (await p).close(); } catch { /* already gone */ }
}

/** Run `fn(page)` on a fresh, network-blocked page; at most MAX_JOBS at once. */
async function withPage(fn) {
  if (running >= MAX_JOBS) await new Promise(r => waiting.push(r));
  running++;
  clearTimeout(idleTimer);
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') req.continue();
      else req.abort('blockedbyclient');
    });
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Export took too long'), { status: 504 })), JOB_TIMEOUT_MS); });
    try { return await Promise.race([fn(page), timeout]); } finally { clearTimeout(timer); }
  } finally {
    if (page) page.close().catch(() => {});
    running--;
    waiting.shift()?.();
    if (running === 0) { idleTimer = setTimeout(closeIfIdle, IDLE_CLOSE_MS); idleTimer.unref?.(); }
  }
}

async function load(page, html) {
  await page.setContent(html, { waitUntil: 'load', timeout: JOB_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Print a full HTML document to PDF. */
export function renderPdf(html, { pageSize = 'A4', landscape = false, footer = '' } = {}) {
  return withPage(async page => {
    await load(page, html);
    return Buffer.from(await page.pdf({
      format: pageSize === 'Letter' ? 'Letter' : 'A4',
      landscape: !!landscape,
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:9px -apple-system,'Segoe UI',sans-serif;color:#888;padding:0 16mm;display:flex;justify-content:space-between">
        <span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    }));
  });
}

/**
 * Pictures (PNG data URLs) of small HTML pieces — equations, charts — for Word documents,
 * which can't show HTML. `css` styles all of them. A piece that fails comes back as null.
 */
export function renderImages(css, items) {
  return withPage(async page => {
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 2 });
    const body = items.map((html, i) => `<div class="piece" id="p${i}">${html}</div>`).join('\n');
    await load(page, `<!doctype html><html><head><meta charset="utf-8"><style>${css}
      html, body { margin: 0; background: transparent; }
      .piece { display: inline-block; padding: 2px 3px; margin: 0 0 8px; max-width: 980px; }
      .piece > * { margin: 0 !important; }</style></head><body>${body}</body></html>`);
    const out = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const el = await page.$(`#p${i}`);
        const box = el && await el.boundingBox();
        if (!box || box.width < 1 || box.height < 1) { out.push(null); continue; }
        const png = await el.screenshot({ type: 'png', omitBackground: true, encoding: 'base64' });
        out.push({ src: `data:image/png;base64,${png}`, width: Math.round(box.width), height: Math.round(box.height) });
      } catch { out.push(null); }
    }
    return out;
  });
}

/** Shut the PDF browser down (when Synapse stops). */
export async function closeBrowser() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { await (await p).close(); } catch { /* already gone */ }
}
