// Import: shared pieces for every source (Obsidian, Notion, Evernote, OneNote).
//
// A source reader fills an ImportBuilder with notes — each with Markdown or HTML, and "assets"
// (pictures, PDFs, other files) referenced by placeholders:
//   <img data-asset="N">            → the picture, resized, as a data URL (like pasted pictures)
//   <div data-pdf-asset="N"></div>  → a PDF block (file uploaded as an attachment)
//   <a data-file-asset="N">name</a> → a 📎 file chip (file uploaded as an attachment)
// finish() then picks unique titles, fixes [[links]], builds the HTML + Markdown copies and adds
// everything to the workspace in one go (offline-first, uploaded by the normal sync).
// Everything lands inside one new note: "Imported from <source> – <date>".
import DOMPurify from 'dompurify';
import { markdownToHtml, htmlToMarkdown } from '../components/editor/convert';
import { fitImage } from '../utils/image';
import { getWorkspaceNotes, importNotes } from '../offline/sync';
import { newId, queueFile, uploadPending } from '../pdf/files';

const MAX_FILE = 50 * 1024 * 1024; // the server's attachment limit
const MAX_NOTE = 12 * 1024 * 1024; // keep notes well under the server's 25 MB request limit

const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic' };
export const extOf = name => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();
export const isImageName = name => !!IMAGE_EXT[extOf(name)] && extOf(name) !== 'heic';
export const isPdfName = name => extOf(name) === 'pdf';
export function typed(blob, name) {
  if (blob.type && blob.type !== 'application/octet-stream') return blob;
  const t = IMAGE_EXT[extOf(name)] || (isPdfName(name) ? 'application/pdf' : '');
  return t ? new Blob([blob], { type: t }) : blob;
}
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class ImportBuilder {
  constructor(source) {
    this.source = source;
    this.notes = [];          // { key, parentKey, title, md?, html?, tags, assets: [], linkKey? }
    this.byKey = new Map();
    this.skipped = [];        // { what, why }
    this.counts = { pictures: 0, pdfs: 0, files: 0 };
  }

  /** Add a note. Returns its key. `linkKey` = the name other notes use in [[links]] (Obsidian). */
  add({ key, parentKey = null, title, md, html, tags = [] }) {
    key ||= `n${this.notes.length}`;
    const n = { key, parentKey, title: cleanTitle(title), md, html, tags: [...new Set(tags.map(t => String(t).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 30), assets: [] };
    this.notes.push(n);
    this.byKey.set(key, n);
    return n;
  }

  /** Register a picture / PDF / file for a note; returns the placeholder HTML. */
  asset(note, blob, name, { inline = false } = {}) {
    name = String(name || 'file').split('/').pop().slice(0, 200);
    blob = typed(blob, name);
    const i = note.assets.push({ blob, name }) - 1;
    if (/^image\//.test(blob.type) && blob.type !== 'image/heic') return `<img data-asset="${i}" alt="${escapeHtml(name.replace(/\.[^.]+$/, ''))}">`;
    if (blob.type === 'application/pdf' && !inline) return `<div data-pdf-asset="${i}"></div>`;
    return `<a data-file-asset="${i}">${escapeHtml(name)}</a>`;
  }

  skip(what, why) { this.skipped.push({ what, why }); }

  /**
   * Create the notes. `rewriteLinks(md, titleOf)` (optional) lets a source turn its own links into
   * [[Final title]] once titles are known. Returns { rootId, count, ... } for the report.
   */
  async finish(workspaceId, { rewriteLinks, onProgress } = {}) {
    if (!this.notes.length) throw new Error('Nothing to import — no notes were found in what you chose.');
    // Unique titles (links are by title): against the workspace and within this import.
    const taken = new Set((await getWorkspaceNotes(workspaceId)).map(n => n.title.toLowerCase()));
    const unique = t => {
      let out = t, i = 2;
      while (taken.has(out.toLowerCase())) out = `${t} (${i++})`;
      taken.add(out.toLowerCase());
      return out;
    };
    const day = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const root = { key: '__root', parentKey: null, title: unique(`Imported from ${this.source} – ${day}`), html: '', tags: [], assets: [] };
    for (const n of this.notes) {
      n.original = n.title;
      n.title = unique(n.title || 'Untitled');
      n.id = newId();
      if (!n.parentKey || !this.byKey.has(n.parentKey)) n.parentKey = '__root';
    }
    root.id = newId();
    const titleOf = key => this.byKey.get(key)?.title;

    // Parents before children
    const ordered = [];
    const kids = new Map();
    for (const n of this.notes) { if (!kids.has(n.parentKey)) kids.set(n.parentKey, []); kids.get(n.parentKey).push(n); }
    const walk = key => { for (const c of kids.get(key) || []) { ordered.push(c); walk(c.key); } };
    walk('__root');

    const out = [];
    let done = 0;
    for (const n of ordered) {
      onProgress?.(`Preparing note ${++done} of ${ordered.length}: ${n.title}`);
      let html;
      if (n.md != null) {
        let md = n.md;
        if (rewriteLinks) md = rewriteLinks(md, n, titleOf);
        html = markdownToHtml(md);
      } else {
        html = cleanHtml(n.html || '');
        if (rewriteLinks) html = rewriteLinks(html, n, titleOf, true);
      }
      html = await this.fillAssets(html, n);
      if (html.length > MAX_NOTE) {
        this.skip(n.title, 'too large even after shrinking pictures — imported without its pictures');
        html = html.replace(/<img\b[^>]*>/g, '<p><em>[picture left out]</em></p>');
      }
      out.push({ id: n.id, parent_id: n.parentKey === '__root' ? root.id : this.byKey.get(n.parentKey).id, title: n.title, rich_content: html, content: htmlToMarkdown(html), tags: n.tags });
    }
    const count = out.length;
    const summary = [
      `<p>${count} note${count === 1 ? '' : 's'} imported from ${escapeHtml(this.source)} on ${escapeHtml(new Date().toLocaleString())}.</p>`,
      this.skipped.length ? `<p><strong>Left out or changed:</strong></p><ul>${this.skipped.slice(0, 200).map(s => `<li><p>${escapeHtml(s.what)} — ${escapeHtml(s.why)}</p></li>`).join('')}</ul>` : '',
      '<p>Move these notes wherever you like, or delete this whole folder to undo the import.</p>',
    ].join('');
    onProgress?.(`Adding ${count + 1} notes…`);
    await importNotes(workspaceId, [{ id: root.id, parent_id: null, title: root.title, rich_content: summary, content: htmlToMarkdown(summary), tags: [] }, ...out]);
    // Files can only be uploaded once their notes are on the server: try again over the next minute.
    for (const ms of [0, 5000, 15000, 40000]) setTimeout(() => uploadPending().catch(() => {}), ms);
    return { rootId: root.id, rootTitle: root.title, count, ...this.counts, skipped: this.skipped };
  }

  /** Turn asset placeholders into pictures / PDF blocks / file chips. */
  async fillAssets(html, n) {
    if (!n.assets.length) return html;
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const tooBig = a => { if (a.blob.size > MAX_FILE) { this.skip(`${a.name} (in “${n.title}”)`, 'over 50 MB'); return true; } return false; };
    for (const img of doc.querySelectorAll('img[data-asset]')) {
      const a = n.assets[Number(img.getAttribute('data-asset'))];
      img.removeAttribute('data-asset');
      try {
        const file = new File([a.blob], a.name, { type: a.blob.type });
        // Many pictures in one note: make them smaller so the note stays a sensible size.
        img.setAttribute('src', await fitImage(file, n.assets.length > 20 ? 1000 : 1600));
        this.counts.pictures++;
      } catch {
        this.skip(`${a.name} (in “${n.title}”)`, 'picture couldn’t be read');
        img.remove();
      }
    }
    for (const el of doc.querySelectorAll('[data-pdf-asset]')) {
      const a = n.assets[Number(el.getAttribute('data-pdf-asset'))];
      if (tooBig(a)) { el.replaceWith(doc.createTextNode(`[${a.name} — too large]`)); continue; }
      const id = newId();
      await queueFile(id, a.blob, a.name, n.id, 'application/pdf');
      const div = doc.createElement('div');
      div.setAttribute('data-pdf', id);
      div.setAttribute('data-name', a.name);
      div.setAttribute('data-pages', '0');
      // A PDF block is a block of its own: lift it out of a paragraph.
      const p = el.closest('p');
      if (p && p.textContent.trim() === '') p.replaceWith(div); else if (p) { p.after(div); el.remove(); } else el.replaceWith(div);
      this.counts.pdfs++;
    }
    for (const el of doc.querySelectorAll('a[data-file-asset]')) {
      const a = n.assets[Number(el.getAttribute('data-file-asset'))];
      if (tooBig(a)) { el.replaceWith(doc.createTextNode(`[${a.name} — too large]`)); continue; }
      const id = newId();
      await queueFile(id, a.blob, a.name, n.id, a.blob.type || 'application/octet-stream');
      const chip = doc.createElement('a');
      chip.setAttribute('href', `/open-file?att=${id}`);
      chip.setAttribute('data-file', 'copy');
      chip.setAttribute('data-name', a.name);
      chip.setAttribute('data-size', String(a.blob.size));
      chip.textContent = `📎 ${a.name}`;
      el.replaceWith(chip);
      this.counts.files++;
    }
    return doc.body.innerHTML;
  }
}

export function cleanTitle(t) {
  return String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
}

/**
 * Tidy HTML from Evernote / OneNote for the editor: safe tags only, styles turned into bold /
 * italic / underline / strike-through, layout boxes flattened into paragraphs, to-dos → checklists.
 */
export function cleanHtml(html) {
  // OneNote marks to-dos with data-tag="to-do" / "to-do:completed"; the cleaner would drop the
  // latter (it looks like a web address), so translate the markers first.
  html = html.replace(/\bdata-tag="([^"]*)"/g, (m, v) => `data-tag="${/to-do:completed/.test(v) ? 'done' : /to-do/.test(v) ? 'todo' : 'other'}"`);
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'mark', 'code', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img', 'hr', 'input', 'font', 'cite'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'type', 'checked', 'colspan', 'rowspan', 'data-tag', 'data-asset', 'data-pdf-asset', 'data-file-asset', 'data-checked', 'data-type'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(`<body>${safe}</body>`, 'text/html');
  const body = doc.body;
  // Styles → real formatting; then drop every style
  for (const el of [...body.querySelectorAll('[style]')]) {
    const st = el.getAttribute('style').toLowerCase();
    const wrapIn = tag => { const w = doc.createElement(tag); while (el.firstChild) w.appendChild(el.firstChild); el.appendChild(w); };
    if (el.tagName === 'SPAN' || el.tagName === 'FONT') {
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) wrapIn('strong');
      if (/font-style\s*:\s*italic/.test(st)) wrapIn('em');
      if (/text-decoration[^;]*underline/.test(st)) wrapIn('u');
      if (/text-decoration[^;]*line-through/.test(st)) wrapIn('s');
      if (/background(-color)?\s*:\s*(?!\s*(transparent|white|#fff\b|#ffffff|rgb\(255,\s*255,\s*255\)))/.test(st)) wrapIn('mark');
    }
    el.removeAttribute('style');
  }
  for (const el of [...body.querySelectorAll('span, font, cite')]) el.replaceWith(...el.childNodes);
  for (const el of [...body.querySelectorAll('a')]) {
    const href = el.getAttribute('href') || '';
    if (!el.hasAttribute('data-file-asset') && !/^(https?:|mailto:)/i.test(href)) el.replaceWith(...el.childNodes);
  }
  // OneNote to-dos: <p data-tag="to-do"> / "to-do:completed"
  for (const el of [...body.querySelectorAll('[data-tag]')]) {
    const tag = el.getAttribute('data-tag') || '';
    el.removeAttribute('data-tag');
    if (tag !== 'todo' && tag !== 'done') continue;
    const ul = doc.createElement('ul'); ul.setAttribute('data-type', 'taskList');
    const li = doc.createElement('li'); li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', tag === 'done' ? 'true' : 'false');
    const p = doc.createElement('p'); while (el.firstChild) p.appendChild(el.firstChild);
    li.appendChild(p); ul.appendChild(li); el.replaceWith(ul);
  }
  // Evernote to-dos: <input type=checkbox> at the start of a line
  for (const box of [...body.querySelectorAll('input')]) {
    if (box.getAttribute('type') !== 'checkbox') { box.remove(); continue; }
    const line = box.closest('p, div, li') || box.parentElement;
    const checked = box.hasAttribute('checked');
    box.remove();
    if (!line || line === body) continue;
    if (line.tagName === 'LI' && line.parentElement) {
      line.parentElement.setAttribute('data-type', 'taskList');
      line.setAttribute('data-type', 'taskItem'); line.setAttribute('data-checked', String(checked));
      if (!line.querySelector(':scope > p')) { const p = doc.createElement('p'); while (line.firstChild) p.appendChild(line.firstChild); line.appendChild(p); }
      continue;
    }
    const ul = doc.createElement('ul'); ul.setAttribute('data-type', 'taskList');
    const li = doc.createElement('li'); li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', String(checked));
    const p = doc.createElement('p'); while (line.firstChild) p.appendChild(line.firstChild);
    li.appendChild(p); ul.appendChild(li); line.replaceWith(ul);
  }
  // Join neighbouring single-item checklists into one list
  for (const ul of [...body.querySelectorAll('ul[data-type="taskList"]')]) {
    const prev = ul.previousElementSibling;
    if (prev && prev.tagName === 'UL' && prev.getAttribute('data-type') === 'taskList') { while (ul.firstChild) prev.appendChild(ul.firstChild); ul.remove(); }
  }
  // Layout boxes: a div holding only inline content becomes a paragraph; other divs are unwrapped.
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|PRE|BLOCKQUOTE|HR)$/;
  for (const div of [...body.querySelectorAll('div')].reverse()) {
    if (div.hasAttribute('data-pdf-asset')) continue;
    const hasBlock = [...div.children].some(c => BLOCK.test(c.tagName) && !c.hasAttribute('data-pdf-asset'));
    if (hasBlock) { div.replaceWith(...div.childNodes); continue; }
    const p = doc.createElement('p');
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  }
  // A paragraph that is only <br> is an empty line; drop runs of them
  for (const p of [...body.querySelectorAll('p')]) {
    if (!p.textContent.trim() && !p.querySelector('img, a[data-file-asset], [data-pdf-asset]')) {
      const prev = p.previousElementSibling;
      if (!prev || (prev.tagName === 'P' && !prev.textContent.trim() && !prev.querySelector('img'))) p.remove();
      else p.innerHTML = '';
    }
  }
  // Loose inline content directly in the body → paragraphs
  let run = null;
  for (const node of [...body.childNodes]) {
    const inline = node.nodeType === 3 ? node.nodeValue.trim() !== '' : node.nodeType === 1 && !BLOCK.test(node.tagName) && !node.hasAttribute?.('data-pdf-asset');
    if (inline) { if (!run) { run = doc.createElement('p'); node.before(run); } run.appendChild(node); } else run = null;
  }
  return body.innerHTML;
}

// ───────────────────────── files (zip or folder) ─────────────────────────

/**
 * Read what the person chose — a .zip, several files, or a folder — into a list of
 * { path, blob }. Zips inside the zip (Notion splits big exports) are opened too.
 */
export async function readEntries(fileList, onProgress) {
  const { unzip } = await import('fflate');
  const out = [];
  const unzipTo = (buf, prefix) => new Promise((resolve, reject) => {
    unzip(buf, (err, files) => {
      if (err) { reject(new Error('That zip file couldn’t be opened')); return; }
      resolve(Object.entries(files).filter(([p]) => !p.endsWith('/')).map(([p, data]) => ({ path: prefix + p, data })));
    });
  });
  const addZip = async (buf, prefix, depth) => {
    for (const { path, data } of await unzipTo(buf, prefix)) {
      if (/\.zip$/i.test(path) && depth < 2) await addZip(data, '', depth + 1);
      else out.push({ path, blob: new Blob([data]) });
    }
  };
  for (const f of fileList) {
    const path = f.webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      onProgress?.(`Opening ${f.name}…`);
      await addZip(new Uint8Array(await f.arrayBuffer()), '', 0);
    } else out.push({ path, blob: f });
  }
  // Drop system junk
  return out.filter(e => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(e.path)).map(e => ({ ...e, path: e.path.replace(/\\/g, '/').replace(/^\/+/, '') }));
}

/** If every entry sits in one top folder (a zipped vault/export), drop that folder from the paths. */
export function stripCommonRoot(entries) {
  const first = entries[0]?.path.split('/')[0];
  if (!first || !entries.every(e => e.path.startsWith(`${first}/`))) return { entries, rootName: null };
  return { entries: entries.map(e => ({ ...e, path: e.path.slice(first.length + 1) })), rootName: first };
}

/** Very small YAML front matter reader: tags / aliases / title. */
export function frontMatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md, data: {} };
  const data = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { data[listKey].push(item[1].trim().replace(/^["']|["']$/g, '')); continue; }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) { listKey = null; continue; }
    const [, k, v] = kv;
    const key = k.toLowerCase();
    if (!v.trim()) { data[key] = []; listKey = key; continue; }
    listKey = null;
    const val = v.trim();
    if (/^\[.*\]$/.test(val)) data[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else data[key] = val.replace(/^["']|["']$/g, '');
  }
  return { body: md.slice(m[0].length), data };
}
export const tagList = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : []).map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);
