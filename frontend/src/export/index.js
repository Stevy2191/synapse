// Export notes as PDF, Word, Markdown or a web page. Loaded only when someone exports.
import api from '../api';
import { getWorkspaceNotes } from '../offline/sync';
import { pickNotes, buildDocument } from './render';
import { buildMarkdown, safeFileName } from './markdown';

export function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The browser's own print dialog (Save as PDF) — used when the server can't make the PDF. */
function printInBrowser(html) {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => {
      setTimeout(() => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* ignore */ }
        setTimeout(() => frame.remove(), 60_000);
        resolve();
      }, 300); // let fonts and pictures settle
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

async function serverError(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error; } catch { return null; }
  }
  return data?.error || null;
}

/**
 * Run an export and download the result.
 * format: 'pdf' | 'docx' | 'markdown' | 'html'; scope: 'note' | 'subtree' | 'workspace'.
 * Returns { printed: true } when the PDF went to the browser's print dialog instead.
 */
export async function runExport({ format, scope, noteId, workspace, pageSize = 'A4', pageBreaks = true, onProgress = () => {}, deliver = null, fileName = null }) {
  // deliver(blob, name): where the file goes (default: the browser's downloads). fileName overrides the name.
  const out = async (data, name, type) => {
    if (!deliver) { download(data, name, type); return; }
    await deliver(data instanceof Blob ? data : new Blob([data], { type }), fileName || name);
  };
  const all = await getWorkspaceNotes(workspace.id);
  const notes = pickNotes(all, scope, noteId);
  if (!notes.length) throw new Error('Nothing to export');
  const title = scope === 'workspace' ? workspace.name || 'Workspace' : notes[0].title || 'Untitled';

  if (format === 'markdown') {
    onProgress('Collecting notes…');
    const md = await buildMarkdown(notes, all, title);
    await out(md.data, md.name, md.type);
    return {};
  }

  const doc = await buildDocument(notes, all, {
    title, pageBreaks,
    onProgress: (i, n) => onProgress(n > 1 ? `Preparing note ${i + 1} of ${n}…` : 'Preparing the note…'),
  });
  const name = safeFileName(title);

  if (format === 'html') {
    await out(doc.html, `${name}.html`, 'text/html');
    return {};
  }

  if (format === 'docx') {
    const { htmlToDocx } = await import('./docx');
    const blob = await htmlToDocx(doc, { title, pageSize, pageBreaks, onProgress });
    await out(blob, `${name}.docx`, blob.type);
    return {};
  }

  // PDF: made by the server (exact, with page numbers); the print dialog if it can't.
  onProgress('Making the PDF…');
  try {
    const res = await api.post('/export/pdf', { html: doc.html, pageSize, title }, { responseType: 'blob', timeout: 180_000 });
    await out(res.data, `${name}.pdf`, 'application/pdf');
    return {};
  } catch (err) {
    const offline = !err.response; // no answer at all: offline, or server unreachable
    const unavailable = err.response?.status === 503;
    if ((offline || unavailable) && deliver) throw new Error('The server couldn’t make the PDF, so it can’t be saved there — choose Word or Web page, or download it instead');
    if (offline || unavailable) {
      await printInBrowser(doc.html);
      return { printed: true };
    }
    throw new Error((await serverError(err)) || 'Could not make the PDF');
  }
}
