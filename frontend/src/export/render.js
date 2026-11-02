// Turning notes into one clean, printable HTML document — the starting point for every export.
//
// Notes are stored as the editor's HTML (Write mode) or Markdown. Both are brought to the same
// HTML, then everything that only works inside the app is replaced with something static:
// equations are typeset, Mermaid charts drawn, code coloured, diagrams and drawings become
// pictures, toggles are opened, links between notes point inside the document.
import { markdownToHtml } from '../components/editor/convert';
import { renderMath, renderMermaid } from '../components/editor/embeds';
import { highlightToHtml, languageLabel } from '../components/editor/codeLanguages';
import { CALLOUTS } from '../components/editor/blocks';
import { load as loadDrawing } from '../components/freedraw/model';
import { toSvg, resolvePaper } from '../components/freedraw/render';
import { flowchartSvg } from './flowchart';
import { exportCss } from './styles';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const svgDataUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { const t = JSON.parse(tags || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

const byPosition = (a, b) => (a.position - b.position) || ((a.created_at || 0) - (b.created_at || 0));

/**
 * The notes to export, in sidebar order, each with its `depth` below the export's top.
 * scope: 'note' (just this one), 'subtree' (it and everything inside it), 'workspace'.
 */
export function pickNotes(all, scope, rootId) {
  const children = new Map();
  for (const n of all) {
    const key = n.parent_id && all.some(p => p.id === n.parent_id) ? n.parent_id : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(n);
  }
  for (const list of children.values()) list.sort(byPosition);
  const out = [];
  const walk = (n, depth) => {
    out.push({ ...n, depth });
    for (const c of children.get(n.id) || []) walk(c, depth + 1);
  };
  if (scope === 'workspace') for (const n of children.get(null) || []) walk(n, 0);
  else {
    const root = all.find(n => n.id === rootId);
    if (!root) return [];
    if (scope === 'note') out.push({ ...root, depth: 0 });
    else walk(root, 0);
  }
  return out;
}

/** A Free Draw note as SVG (light paper unless the drawing chose dark), or null when empty. */
export function drawingSvg(note) {
  const doc = loadDrawing(note.canvas_data);
  if (!doc.elements.length) return null;
  return toSvg(doc, resolvePaper(doc.paper, true));
}

function noteSourceHtml(note) {
  if (note.editor_mode === 'rich' && note.rich_content) return note.rich_content;
  return markdownToHtml(note.content || '');
}

async function inlineImage(img) {
  const src = img.getAttribute('src') || '';
  if (!src || src.startsWith('data:')) return;
  try {
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error();
    img.setAttribute('src', await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    }));
  } catch {
    // Can't be fetched (offline, or the site doesn't allow it): show the address instead.
    const span = img.ownerDocument.createElement('span');
    span.className = 'x-missing';
    span.textContent = `[picture: ${src}]`;
    img.replaceWith(span);
  }
}

function replaceWikiLinks(root, linkTarget) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest('pre, code, a') ? NodeFilter.FILTER_REJECT : /\[\[[^\[\]\n]+\]\]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of node.nodeValue.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
      frag.append(node.nodeValue.slice(last, m.index));
      const [target, alias] = m[1].split('|').map(s => s.trim());
      const id = linkTarget(target);
      const el = doc.createElement(id ? 'a' : 'span');
      if (id) el.className = 'x-link'; // a note that isn't in this document: plain text
      if (id) el.setAttribute('href', `#note-${id}`);
      el.textContent = alias || target;
      frag.append(el);
      last = m.index + m[0].length;
    }
    frag.append(node.nodeValue.slice(last));
    node.replaceWith(frag);
  }
}

/** The body of one note as export HTML. */
async function renderBody(note, ctx) {
  if (note.note_type === 'draw') {
    const svg = drawingSvg(note);
    return svg ? `<figure class="x-figure"><img alt="${esc(note.title)}" src="${svgDataUrl(svg)}"></figure>` : '<p class="x-missing">Empty drawing</p>';
  }
  if (note.note_type === 'diagram') {
    const svg = flowchartSvg(note.canvas_data);
    return svg ? `<figure class="x-figure"><img alt="${esc(note.title)}" src="${svgDataUrl(svg)}"></figure>` : '<p class="x-missing">Empty flowchart</p>';
  }

  const doc = new DOMParser().parseFromString(`<body>${noteSourceHtml(note)}</body>`, 'text/html');
  const body = doc.body;
  const make = (tag, cls, html) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; };

  // Code blocks (Mermaid charts are drawn)
  for (const code of [...body.querySelectorAll('pre > code')]) {
    const pre = code.parentElement;
    const lang = ([...code.classList].find(c => c.startsWith('language-')) || '').slice(9);
    const text = code.textContent;
    if (lang === 'mermaid') {
      const r = text.trim() ? await renderMermaid(text, { light: true }) : {};
      if (r.svg) { pre.replaceWith(make('div', 'x-mermaid', r.svg)); continue; }
    }
    const out = make('pre', 'x-code');
    if (lang && lang !== 'plaintext' && lang !== 'text') out.append(make('span', 'x-code-lang', esc(languageLabel(lang))));
    out.append(make('code', 'hljs', highlightToHtml(text, lang || '')));
    pre.replaceWith(out);
  }
  // Math
  for (const el of [...body.querySelectorAll('[data-type="inline-math"]')]) {
    el.replaceWith(make('span', 'x-math', renderMath(el.getAttribute('data-latex') || '', false)));
  }
  for (const el of [...body.querySelectorAll('[data-type="block-math"]')]) {
    el.replaceWith(make('div', 'x-math-block', renderMath(el.getAttribute('data-latex') || '', true)));
  }
  // draw.io / Excalidraw diagrams → their saved picture
  for (const fig of [...body.querySelectorAll('figure[data-diagram]')]) {
    const src = fig.querySelector('img')?.getAttribute('src');
    if (src?.startsWith('data:image/')) {
      const out = make('figure', 'x-figure');
      const img = doc.createElement('img');
      img.setAttribute('src', src);
      img.setAttribute('alt', fig.getAttribute('data-diagram') === 'excalidraw' ? 'Excalidraw drawing' : 'draw.io diagram');
      out.append(img);
      fig.replaceWith(out);
    } else fig.remove();
  }
  // Embedded Free Draw notes
  for (const el of [...body.querySelectorAll('[data-drawing]')]) {
    const title = el.getAttribute('data-drawing') || '';
    const drawing = ctx.all.find(n => n.note_type === 'draw' && n.title.toLowerCase() === title.toLowerCase());
    const svg = drawing && drawingSvg(drawing);
    if (svg) {
      const out = make('figure', 'x-figure');
      const img = doc.createElement('img');
      img.setAttribute('src', svgDataUrl(svg));
      img.setAttribute('alt', title);
      out.append(img);
      el.replaceWith(out);
    } else el.replaceWith(make('p', 'x-missing', esc(drawing ? `Empty drawing “${title}”` : `Drawing “${title}” not found`)));
  }
  // Videos → a link
  for (const el of [...body.querySelectorAll('[data-video]')]) {
    const url = el.getAttribute('data-video') || '';
    el.replaceWith(make('p', 'x-video', `▶ Video: <a href="${esc(url)}">${esc(url)}</a>`));
  }
  // Meeting recordings: the transcript, as text
  for (const el of [...body.querySelectorAll('div[data-meeting], div[data-local-id]')]) {
    let segs = [], speakers = {};
    try { segs = JSON.parse(el.getAttribute('data-segments') || '[]'); } catch { /* none */ }
    try { speakers = JSON.parse(el.getAttribute('data-speakers') || '{}'); } catch { /* none */ }
    const clockT = t => { const x = Math.floor(t || 0); const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const ss = String(x % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
    const who = i => (i === null || i === undefined ? 'Someone' : speakers[i] || `Speaker ${i + 1}`);
    const box = make('div', 'x-meeting', `<div class="x-meeting-title">🎙 ${esc(el.getAttribute('data-title') || 'Meeting')}${Number(el.getAttribute('data-duration')) ? ` · ${clockT(Number(el.getAttribute('data-duration')))}` : ''}</div>`);
    for (const s of segs) box.append(make('p', 'x-meeting-line', `<b>${esc(who(s.speaker))}</b> <span class="x-meeting-time">${clockT(s.start)}</span> ${esc(s.text)}`));
    if (!segs.length) box.append(make('p', 'x-meeting-line', '<i>Transcript not ready yet.</i>'));
    el.replaceWith(box);
  }
  // Callouts
  for (const el of [...body.querySelectorAll('[data-callout]')]) {
    const type = CALLOUTS[el.getAttribute('data-callout')] ? el.getAttribute('data-callout') : 'info';
    el.className = 'x-callout';
    el.setAttribute('data-callout', type);
    el.prepend(make('div', 'x-callout-title', esc(CALLOUTS[type].label)));
  }
  // Toggles: always open on paper
  for (const det of [...body.querySelectorAll('details')].reverse()) {
    const box = make('div', 'x-toggle');
    const summary = det.querySelector(':scope > summary');
    // Task lists (a toggle holding a checklist): "3 of 5 remaining", like in the editor.
    const items = [...det.querySelectorAll('li[data-checked]')].filter(li => li.closest('details') === det && li.textContent.trim());
    const left = items.filter(li => li.getAttribute('data-checked') !== 'true').length;
    const count = items.length ? ` <span class="x-task-count">${left ? `${left} of ${items.length} remaining` : `All ${items.length} done`}</span>` : '';
    const lvl = parseInt(summary?.getAttribute('data-level'), 10) || 0;
    box.append(make('div', `x-toggle-summary${lvl ? ` x-level-${lvl}` : ''}`, (summary ? summary.innerHTML : '') + count));
    const content = make('div', 'x-toggle-body');
    for (const child of [...det.childNodes]) {
      if (child === summary) continue;
      if (child.nodeType === 1 && child.getAttribute('data-type') === 'detailsContent') content.append(...child.childNodes);
      else content.append(child);
    }
    box.append(content);
    det.replaceWith(box);
  }
  // Checklists
  for (const ul of [...body.querySelectorAll('ul[data-type="taskList"]')]) {
    ul.className = 'x-tasks';
    ul.removeAttribute('data-type');
    for (const li of [...ul.children].filter(c => c.tagName === 'LI')) {
      const done = li.getAttribute('data-checked') === 'true';
      li.querySelectorAll(':scope > label, :scope > input').forEach(x => x.remove());
      const content = make('div');
      const inner = li.querySelector(':scope > div');
      if (inner && li.children.length === 1) content.append(...inner.childNodes);
      else content.append(...li.childNodes);
      li.textContent = '';
      li.className = done ? 'done' : '';
      li.append(make('span', 'x-box', done ? '☑' : '☐'), content);
    }
  }
  // Table of contents (built from this note's headings)
  for (const el of [...body.querySelectorAll('[data-toc]')]) {
    const toc = make('div', 'x-toc', '<div class="x-toc-head">Contents</div>');
    const hs = [...body.querySelectorAll('h1, h2, h3, h4')];
    const top = Math.min(3, ...hs.map(h => +h.tagName[1]));
    for (const h of hs) {
      const item = make('div', 'x-toc-item');
      item.style.paddingLeft = `${(+h.tagName[1] - top) * 16}px`;
      item.textContent = h.textContent;
      toc.append(item);
    }
    el.replaceWith(toc);
  }
  // Leftovers from the editor
  body.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  body.querySelectorAll('input').forEach(el => el.remove());
  await Promise.all([...body.querySelectorAll('img')].map(inlineImage));
  replaceWikiLinks(body, ctx.linkTarget);
  return body.innerHTML;
}

function noteHeader(note) {
  const tags = parseTags(note.tags);
  const date = note.updated_at ? new Date(note.updated_at * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const meta = [date && `<span>Updated ${esc(date)}</span>`, ...tags.map(t => `<span class="x-tag">#${esc(t)}</span>`)].filter(Boolean).join('');
  return `<h1 class="x-title">${esc(note.title || 'Untitled')}</h1>${meta ? `<div class="x-meta">${meta}</div>` : ''}`;
}

/**
 * Build the export document.
 * notes: from pickNotes(); all: every note in the workspace (for drawings and links).
 * Returns { html: a complete standalone page, body: the inner HTML, css }.
 */
export async function buildDocument(notes, all, { title, pageBreaks = true, onProgress } = {}) {
  const ids = new Map(notes.map(n => [n.title.toLowerCase(), n.id]));
  const ctx = { all, linkTarget: t => ids.get(String(t).toLowerCase()) || null };
  const parts = [];
  if (notes.length > 1) {
    parts.push(`<nav class="x-contents"><h2>Contents</h2>${notes.map(n =>
      `<a href="#note-${esc(n.id)}" style="padding-left:${n.depth * 16}px">${esc(n.title || 'Untitled')}</a>`).join('')}</nav>`);
  }
  for (let i = 0; i < notes.length; i++) {
    onProgress?.(i, notes.length);
    const n = notes[i];
    parts.push(`<article class="x-note" id="note-${esc(n.id)}">${noteHeader(n)}<div class="x-body">${await renderBody(n, ctx)}</div></article>`);
  }
  const css = await exportCss();
  const body = `<main class="x-doc${pageBreaks ? ' x-pagebreaks' : ''}">${parts.join('\n')}</main>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="generator" content="Synapse"><style>${css}</style></head>
<body>${body}</body></html>`;
  return { html, body, css };
}
