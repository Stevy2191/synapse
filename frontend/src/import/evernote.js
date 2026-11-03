// Evernote: .enex files (File → Export Notebook… in Evernote). Each file is one notebook; each
// <note> has a title, tags, ENML content and its files as base64 <resource>s, which the content
// refers to by MD5 hash (<en-media hash="…">).
import SparkMD5 from 'spark-md5';
import { ImportBuilder, escapeHtml } from './common';

function b64ToBytes(s) {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importEvernote(files, workspaceId, onProgress) {
  const enex = [...files].filter(f => /\.enex$/i.test(f.name));
  if (!enex.length) throw new Error('Pick one or more .enex files (in Evernote: right-click a notebook → Export notebook).');
  const b = new ImportBuilder('Evernote');
  const many = enex.length > 1;
  let total = 0;
  for (const f of enex) {
    onProgress?.(`Reading ${f.name}…`);
    const xml = new DOMParser().parseFromString(await f.text(), 'application/xml');
    if (xml.querySelector('parsererror')) { b.skip(f.name, 'not a readable Evernote export'); continue; }
    const book = f.name.replace(/\.enex$/i, '');
    // One file: its notes go straight into the import folder; several: one note per notebook.
    const parentKey = many ? b.add({ key: `nb:${book}:${total}`, title: book, html: '' }).key : null;
    const notes = [...xml.getElementsByTagName('note')];
    for (const [i, el] of notes.entries()) {
      onProgress?.(`${book}: note ${i + 1} of ${notes.length}`);
      const title = el.getElementsByTagName('title')[0]?.textContent || 'Untitled';
      const tags = [...el.getElementsByTagName('tag')].map(t => t.textContent);
      const n = b.add({ parentKey, title, html: '', tags });
      // Files, by MD5 of their bytes
      const byHash = new Map();
      for (const r of el.getElementsByTagName('resource')) {
        const data = r.getElementsByTagName('data')[0];
        if (!data) continue;
        const bytes = b64ToBytes(data.textContent || '');
        const mime = r.getElementsByTagName('mime')[0]?.textContent || 'application/octet-stream';
        const name = r.getElementsByTagName('file-name')[0]?.textContent || `file.${mime.split('/')[1] || 'bin'}`;
        byHash.set(SparkMD5.ArrayBuffer.hash(bytes.buffer), { blob: new Blob([bytes], { type: mime }), name, used: false });
      }
      n.html = enmlToHtml(el.getElementsByTagName('content')[0]?.textContent || '', byHash, b, n);
      // Files the note didn't show inline: add them at the end
      const extra = [...byHash.values()].filter(r => !r.used);
      if (extra.length) n.html += `<p></p>${extra.map(r => `<p>${b.asset(n, r.blob, r.name)}</p>`).join('')}`;
      const created = el.getElementsByTagName('created')[0]?.textContent;
      if (created && /^\d{8}T/.test(created)) {
        const d = new Date(`${created.slice(0, 4)}-${created.slice(4, 6)}-${created.slice(6, 8)}T${created.slice(9, 11)}:${created.slice(11, 13)}:00Z`);
        n.html += `<p><em>Created in Evernote on ${escapeHtml(d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</em></p>`;
      }
      const source = el.querySelector('note-attributes > source-url')?.textContent;
      if (source && /^https?:/i.test(source)) n.html += `<p><em>Clipped from <a href="${escapeHtml(source)}">${escapeHtml(source)}</a></em></p>`;
      total++;
    }
  }
  return b.finish(workspaceId, { onProgress });
}

/** ENML (Evernote's XHTML) → plain HTML with asset placeholders. */
function enmlToHtml(enml, byHash, b, n) {
  // ENML is XHTML: <en-todo/> is self-closing, which the HTML reader doesn't understand (it would
  // swallow the rest of the line), so close those tags explicitly first.
  const xhtml = enml.replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').replace(/<(en-[a-z]+)([^>]*?)\/>/gi, '<$1$2></$1>');
  const doc = new DOMParser().parseFromString(xhtml, 'text/html');
  const root = doc.querySelector('en-note') || doc.body;
  for (const m of [...root.querySelectorAll('en-media')]) {
    const r = byHash.get((m.getAttribute('hash') || '').toLowerCase());
    if (!r) { m.remove(); continue; }
    r.used = true;
    const holder = doc.createElement('span');
    holder.innerHTML = b.asset(n, r.blob, r.name);
    const ph = holder.firstChild;
    // PDFs/blocks can't sit inside a line
    if (ph.tagName === 'DIV') { const line = m.closest('div, p'); (line && line !== root ? line : m).after(ph); m.remove(); } else m.replaceWith(ph);
  }
  for (const t of [...root.querySelectorAll('en-todo')]) {
    const box = doc.createElement('input');
    box.setAttribute('type', 'checkbox');
    if (t.getAttribute('checked') === 'true') box.setAttribute('checked', '');
    t.replaceWith(box);
  }
  for (const c of [...root.querySelectorAll('en-crypt')]) {
    const p = doc.createElement('em');
    p.textContent = '[encrypted text — not imported; decrypt it in Evernote first]';
    c.replaceWith(p);
  }
  for (const a of [...root.querySelectorAll('a[href^="evernote:"]')]) a.replaceWith(...a.childNodes); // links to other Evernote notes
  return root.innerHTML;
}
