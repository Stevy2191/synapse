// Files from network folders, OneDrive and Google Drive (all through the Synapse server; online only).
import api from '../api';

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || (err?.response ? fallback : 'You’re offline — files need a connection to the server');

export const listSources = () => api.get('/files/sources').then(r => r.data.sources);
export const listFolder = (source, id = '') => api.get('/files/list', { params: { source, id } }).then(r => r.data);
export const attachCopy = (source, id, noteId) => api.post('/files/attach', { source, id, note_id: noteId }, { timeout: 120_000 }).then(r => r.data.attachment);

export async function uploadTo(source, parent, blob, name, onProgress) {
  const form = new FormData();
  form.append('source', source);
  form.append('parent', parent || '');
  form.append('name', name);
  form.append('file', blob, name);
  const { data } = await api.post('/files/upload', form, {
    timeout: 0,
    onUploadProgress: e => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return data.item;
}

/** Download a file (from a source, or a note attachment) as a Blob, with its name and type. */
export async function fetchFile({ source, id, att }) {
  const res = att
    ? await api.get(`/attachments/${encodeURIComponent(att)}`, { responseType: 'blob', timeout: 0 })
    : await api.get('/files/download', { params: { source, id, inline: '1' }, responseType: 'blob', timeout: 0 });
  const disp = res.headers['content-disposition'] || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const name = m ? decodeURIComponent(m[1]) : 'file';
  const type = res.headers['x-file-type'] || res.headers['content-type'] || res.data.type;
  return { blob: res.data, name, type };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Connect OneDrive / Google Drive: sign in in a popup; resolves when it reports back. */
export async function connectCloud(provider) {
  const popup = window.open('about:blank', 'synapse-connect', 'width=520,height=680');
  try {
    const { data } = await api.post(`/files/connect/${provider}`, { origin: location.origin });
    if (!popup) { location.href = data.url; return new Promise(() => {}); }
    popup.location.href = data.url;
  } catch (err) { popup?.close(); throw err; }
  return new Promise(resolve => {
    const onMsg = e => {
      if (e.origin !== location.origin || e.data?.type !== 'synapse-files-connected') return;
      cleanup(); resolve(!!e.data.ok);
    };
    const timer = setInterval(() => { if (popup.closed) { cleanup(); resolve(null); } }, 700);
    function cleanup() { window.removeEventListener('message', onMsg); clearInterval(timer); }
    window.addEventListener('message', onMsg);
  });
}
export const disconnectCloud = provider => api.delete(`/files/connect/${provider}`).then(r => r.data.sources);

export const bytes = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/** Where a file link in a note points. */
export function fileHref({ att, source, id, web_url: webUrl, name }) {
  if (att) return `/open-file?${new URLSearchParams({ att, name })}`;
  if (source && !source.startsWith('folder:') && webUrl) return webUrl;
  return `/open-file?${new URLSearchParams({ src: source, id, name })}`;
}
