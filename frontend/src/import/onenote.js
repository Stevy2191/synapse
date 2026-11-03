// OneNote: read through the person's Microsoft account (server: files.js oneNote*). Notebook →
// section groups → sections → pages (sub-pages nested under their page) become notes.
import api from '../api';
import { ImportBuilder } from './common';

export const oneNoteStatus = () => api.get('/files/onenote/status').then(r => r.data);
export const oneNoteNotebooks = () => api.get('/files/onenote/notebooks', { timeout: 120000 }).then(r => r.data.notebooks);

/** Open the Microsoft sign-in asking for OneNote access too; resolves when the popup reports back. */
export function connectOneNote() {
  return new Promise((resolve, reject) => {
    const popup = window.open('', 'synapse-onenote', 'width=520,height=680');
    api.post('/files/connect/onedrive', { origin: window.location.origin, onenote: true }).then(({ data }) => {
      if (!popup) { window.location.href = data.url; return; }
      popup.location.href = data.url;
      const onMsg = e => {
        if (e.origin !== window.location.origin || e.data?.type !== 'synapse-files-connected') return;
        window.removeEventListener('message', onMsg);
        clearInterval(t);
        if (e.data.ok === false) reject(new Error(e.data.error || 'Sign-in failed')); else resolve();
      };
      window.addEventListener('message', onMsg);
      const t = setInterval(() => { if (popup.closed) { clearInterval(t); window.removeEventListener('message', onMsg); setTimeout(resolve, 300); } }, 700);
    }).catch(err => { popup?.close(); reject(new Error(err.response?.data?.error || err.message)); });
  });
}

/**
 * Import the chosen sections. `picked` = [{ notebook, path: [group names…], section: {id, name} }].
 */
export async function importOneNote(picked, workspaceId, onProgress) {
  const b = new ImportBuilder('OneNote');
  const folders = new Map(); // "notebook/group/…" → key
  const folder = (parts) => {
    let parentKey = null, path = '';
    for (const name of parts) {
      path += `/${name}`;
      if (!folders.has(path)) folders.set(path, b.add({ key: `f:${path}`, parentKey, title: name, html: '' }).key);
      parentKey = folders.get(path);
    }
    return parentKey;
  };
  const books = new Set(picked.map(p => p.notebook));
  for (const [si, p] of picked.entries()) {
    // One notebook: its sections go straight into the import folder.
    const sectionKey = folder([...(books.size > 1 ? [p.notebook] : []), ...p.path, p.section.name]);
    onProgress?.(`Section ${si + 1} of ${picked.length}: ${p.section.name} — listing pages…`);
    const { data } = await api.get(`/files/onenote/sections/${encodeURIComponent(p.section.id)}/pages`, { timeout: 120000 });
    const stack = []; // [level] → key, for sub-pages
    for (const [i, pg] of data.pages.entries()) {
      onProgress?.(`${p.section.name}: page ${i + 1} of ${data.pages.length} — ${pg.title}`);
      let html = '';
      try {
        ({ html } = (await api.get(`/files/onenote/pages/${encodeURIComponent(pg.id)}`, { timeout: 180000 })).data);
      } catch (err) { b.skip(pg.title, err.response?.data?.error || 'couldn’t be read'); continue; }
      const parentKey = (pg.level > 0 && stack[pg.level - 1]) || sectionKey;
      const n = b.add({ parentKey, title: pg.title, html: '' });
      stack[pg.level] = n.key;
      stack.length = pg.level + 1;
      n.html = await pageBody(html, b, n);
    }
  }
  return b.finish(workspaceId, { onProgress });
}

/** The page body: title removed (it's the note title), attached files downloaded as assets. */
async function pageBody(html, b, n) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelector('title')?.remove();
  for (const o of [...doc.querySelectorAll('object[data]')]) {
    const url = o.getAttribute('data');
    const name = o.getAttribute('data-attachment') || 'file';
    try {
      const res = await api.get('/files/onenote/resource', { params: { u: url }, responseType: 'blob', timeout: 0 });
      const type = res.headers['x-file-type'] || '';
      const holder = doc.createElement('div');
      holder.innerHTML = b.asset(n, type ? new Blob([res.data], { type }) : res.data, name);
      o.replaceWith(holder.firstChild);
    } catch { b.skip(`${name} (in “${n.title}”)`, 'attached file couldn’t be downloaded'); o.remove(); }
  }
  // Pictures arrive as data URLs; turn them into assets so they're resized like everything else.
  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) { img.remove(); continue; }
    const blob = await (await fetch(src)).blob();
    const holder = doc.createElement('span');
    holder.innerHTML = b.asset(n, blob, img.getAttribute('alt') || 'picture.png');
    img.replaceWith(holder.firstChild);
  }
  return doc.body.innerHTML;
}
