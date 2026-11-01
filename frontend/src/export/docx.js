// Word (.docx) export: the export HTML (see render.js) rewritten as a real Word document —
// headings, lists, checklists, tables, code, callouts and pictures — not a web page in disguise,
// so it opens properly in Word, Word on iPad, Google Docs and LibreOffice.
//
// Word can't show equations, Mermaid charts or SVG pictures made by the browser, so those are
// turned into PNG pictures first: by the server when it's reachable (best quality), otherwise in
// the browser where possible (equations then fall back to their LaTeX text).
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, InternalHyperlink, Bookmark, ImageRun, Table, TableRow,
  TableCell, WidthType, HeadingLevel, AlignmentType, BorderStyle, ShadingType, LevelFormat, LineRuleType,
} from 'docx';
import api from '../api';

const PAGE_WIDTH_PX = 624; // 6.5in of text width at 96 dpi
const MONO = 'Consolas';
const CALLOUT_COLORS = { info: '6366F1', tip: '10B981', warning: 'F59E0B', danger: 'EF4444' };

// ───────────────────────── pictures ─────────────────────────

function dataUrlBytes(src) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  if (m[2]) {
    const bin = atob(m[3]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { mime: m[1] || '', bytes: out };
  }
  return { mime: m[1] || '', bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Any picture the browser can show → PNG (via a canvas). Fails for SVGs the browser won't draw. */
async function toPng(src, maxWidth = 1600) {
  const img = await loadImage(src);
  let w = img.naturalWidth || img.width || 600, h = img.naturalHeight || img.height || 400;
  const cssW = w, cssH = h;
  const scale = Math.min(2, maxWidth / w);
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { src: c.toDataURL('image/png'), width: cssW, height: cssH };
}

const WORD_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

/**
 * Work out a Word-ready picture for every image, equation and chart in `root`.
 * Returns a Map element → { type, data, width, height } (or { text } as a fallback).
 */
async function preparePictures(root, css, onProgress) {
  const pics = new Map();
  const forServer = []; // [element, html]
  for (const el of root.querySelectorAll('.x-math, .x-math-block, .x-mermaid')) forServer.push([el, el.outerHTML]);
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:image/svg')) forServer.push([img, `<img src="${src.replace(/"/g, '&quot;')}" style="max-width:${PAGE_WIDTH_PX}px">`]);
  }

  // 1. Server pictures (equations, charts, SVGs)
  let fromServer = [];
  if (forServer.length) {
    onProgress?.('Drawing equations and charts…');
    try {
      const res = await api.post('/export/images', { css, items: forServer.map(([, html]) => html) }, { timeout: 120000 });
      fromServer = res.data.images || [];
    } catch { fromServer = []; }
  }
  for (let i = 0; i < forServer.length; i++) {
    const [el] = forServer[i];
    let pic = fromServer[i];
    if (!pic) {
      // Fallbacks in the browser
      try {
        if (el.tagName === 'IMG') pic = await toPng(el.getAttribute('src'));
        else if (el.classList.contains('x-mermaid')) {
          const svg = el.querySelector('svg');
          if (svg) {
            if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            pic = await toPng(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`);
          }
        }
      } catch { pic = null; }
    }
    if (pic) {
      const d = dataUrlBytes(pic.src);
      pics.set(el, { type: 'png', data: d.bytes, width: pic.width, height: pic.height });
    } else if (el.matches('.x-math, .x-math-block')) {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent || el.textContent;
      pics.set(el, { text: tex, block: el.classList.contains('x-math-block') });
    } else if (el.classList.contains('x-mermaid')) pics.set(el, { text: '[Mermaid chart]', block: true });
    else pics.set(el, { text: `[${el.getAttribute('alt') || 'picture'}]` });
  }

  // 2. Ordinary pictures: PNG/JPEG/GIF go in as they are, anything else (WebP…) is converted.
  for (const img of root.querySelectorAll('img')) {
    if (pics.has(img)) continue;
    const src = img.getAttribute('src') || '';
    try {
      const d = dataUrlBytes(src);
      let type = d && WORD_TYPES[d.mime];
      let pic;
      if (type) {
        const el = await loadImage(src);
        pic = { type, data: d.bytes, width: el.naturalWidth, height: el.naturalHeight };
      } else {
        const p = await toPng(src);
        type = 'png';
        pic = { type, data: dataUrlBytes(p.src).bytes, width: p.width, height: p.height };
      }
      const w = parseFloat(img.getAttribute('width'));
      if (w > 0 && pic.width) { pic.height = pic.height * (w / pic.width); pic.width = w; }
      pics.set(img, pic);
    } catch { pics.set(img, { text: `[${img.getAttribute('alt') || 'picture'}]` }); }
  }
  return pics;
}

function imageRun(pic, maxWidth = PAGE_WIDTH_PX) {
  let { width = 400, height = 300 } = pic;
  if (width > maxWidth) { height = height * (maxWidth / width); width = maxWidth; }
  return new ImageRun({ type: pic.type, data: pic.data, transformation: { width: Math.round(width), height: Math.round(height) } });
}

// ───────────────────────── text ─────────────────────────

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'FIGURE', 'HR', 'DIV', 'SECTION', 'ARTICLE', 'NAV', 'MAIN', 'HEADER', 'FOOTER']);
const isBlock = n => n.nodeType === 1 && (BLOCK_TAGS.has(n.tagName) || n.matches('.x-math-block, .x-mermaid'));

function hex(color) {
  if (!color) return null;
  const c = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return m[1].split('').map(x => x + x).join('').toUpperCase();
  m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (m) return [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}

/** Inline content of `node` → TextRuns, links and pictures. */
function inlines(node, fmt, ctx) {
  const out = [];
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      const text = n.nodeValue.replace(/\s+/g, ' ');
      if (text) out.push(new TextRun({ text, ...fmt }));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const pic = ctx.pics.get(n);
    if (pic) {
      out.push(pic.data ? imageRun(pic) : new TextRun({ text: pic.text, ...fmt, font: n.matches('.x-math') ? 'Cambria Math' : fmt.font }));
      continue;
    }
    const tag = n.tagName;
    const f = { ...fmt };
    if (tag === 'STRONG' || tag === 'B') f.bold = true;
    if (tag === 'EM' || tag === 'I') f.italics = true;
    if (tag === 'U') f.underline = {};
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') f.strike = true;
    if (tag === 'SUP') f.superScript = true;
    if (tag === 'SUB') f.subScript = true;
    if (tag === 'CODE') { f.font = MONO; f.shading = { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }; f.size = 19; }
    if (tag === 'MARK') {
      const bg = hex(n.getAttribute('data-color') || n.style.backgroundColor) || 'FEF08A';
      f.shading = { type: ShadingType.CLEAR, fill: bg, color: 'auto' };
    }
    const color = hex(n.style?.color);
    if (color) f.color = color;
    if (tag === 'BR') { out.push(new TextRun({ text: '', break: 1 })); continue; }
    if (tag === 'IMG') continue; // only reached when the picture failed entirely
    if (tag === 'A') {
      const href = n.getAttribute('href') || '';
      const runs = inlines(n, { ...f, style: 'Hyperlink' }, ctx);
      if (href.startsWith('#note-')) out.push(new InternalHyperlink({ anchor: bookmarkId(href.slice(6)), children: runs }));
      else if (/^(https?:|mailto:)/i.test(href)) out.push(new ExternalHyperlink({ link: href, children: runs }));
      else out.push(...runs);
      continue;
    }
    if (n.classList.contains('x-link')) { out.push(...inlines(n, { ...f, color: '4F46E5' }, ctx)); continue; }
    out.push(...inlines(n, f, ctx));
  }
  return out;
}

const bookmarkId = id => `n_${String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}`;

function alignment(el) {
  const a = el?.style?.textAlign;
  return { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[a];
}

// ───────────────────────── blocks ─────────────────────────

/**
 * ctx: { pics, box: paragraph options added inside callouts/quotes, list: { level, marker } }
 * `marker` is used by the first paragraph of a list item (bullet, number or ☐/☑).
 */
function paragraph(children, ctx, extra = {}) {
  const opts = { ...ctx.box, ...extra, children };
  const list = ctx.list;
  if (list) {
    if (list.marker && !list.marker.used) {
      list.marker.used = true;
      if (list.marker.numbering) opts.numbering = list.marker.numbering;
      else {
        opts.indent = { left: 360 * (list.level + 1), hanging: 300 };
        opts.children = [new TextRun({ text: `${list.marker.prefix}\t`, ...(list.marker.done ? { color: '9CA3AF' } : {}) }), ...children];
        opts.tabStops = [{ type: 'left', position: 360 * (list.level + 1) }];
      }
    } else opts.indent = { left: 360 * (list.level + 1) };
  }
  return new Paragraph(opts);
}

function blocks(parent, ctx) {
  const out = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const runs = inlinesFromList(buffer, ctx);
    const hasText = buffer.some(n => n.textContent.trim());
    if (runs.length && (hasText || runs.some(r => r instanceof ImageRun))) out.push(paragraph(runs, ctx));
    buffer = [];
  };
  for (const n of parent.childNodes) {
    if (isBlock(n)) { flush(); out.push(...block(n, ctx)); } else buffer.push(n);
  }
  flush();
  return out;
}

function inlinesFromList(nodes, ctx) {
  const holder = { childNodes: nodes };
  return inlines(holder, ctx.fmt || {}, ctx);
}

function codeParagraphs(pre, ctx) {
  const lang = pre.querySelector('.x-code-lang')?.textContent;
  const code = pre.querySelector('code') || pre;
  const lines = code.textContent.replace(/\n$/, '').split('\n');
  const shade = { type: ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' };
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB', space: 4 };
  const out = [];
  if (lang) out.push(new Paragraph({ ...ctx.box, spacing: { before: 120, after: 0 }, children: [new TextRun({ text: lang.toUpperCase(), size: 15, bold: true, color: '9CA3AF' })] }));
  out.push(new Paragraph({
    ...ctx.box,
    shading: shade,
    border: { top: border, bottom: border, left: border, right: border },
    spacing: { before: lang ? 40 : 120, after: 120 },
    children: lines.map((line, i) => new TextRun({ text: line || ' ', font: MONO, size: 18, break: i ? 1 : 0 })),
  }));
  return out;
}

let listInstance = 0;

function listBlocks(listEl, ctx) {
  const ordered = listEl.tagName === 'OL';
  const tasks = listEl.classList.contains('x-tasks');
  const level = ctx.list ? ctx.list.level + 1 : 0;
  const instance = ++listInstance;
  const out = [];
  for (const li of listEl.children) {
    if (li.tagName !== 'LI') continue;
    let marker;
    let content = li;
    if (tasks) {
      const done = li.classList.contains('done');
      marker = { prefix: done ? '☑' : '☐', done };
      content = li.querySelector(':scope > div') || li;
    } else if (ordered) marker = { numbering: { reference: 'ordered', level: Math.min(level, 8), instance } };
    else marker = { numbering: { reference: 'bullets', level: Math.min(level, 8) } };
    const itemCtx = { ...ctx, list: { level, marker }, fmt: tasks && li.classList.contains('done') ? { ...(ctx.fmt || {}), color: '9CA3AF', strike: true } : ctx.fmt };
    const items = blocks(content, itemCtx);
    if (!marker.used) items.unshift(paragraph([new TextRun('')], itemCtx)); // empty item
    out.push(...items);
  }
  return out;
}

function tableBlock(table, ctx) {
  const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr, :scope > tfoot > tr')];
  if (!rows.length) return [];
  const cols = Math.max(...rows.map(r => [...r.children].reduce((s, c) => s + (+c.getAttribute('colspan') || 1), 0)));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(tr => new TableRow({
      children: [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH').map(cell => {
        const head = cell.tagName === 'TH';
        const cellCtx = { ...ctx, box: {}, list: null, fmt: head ? { ...(ctx.fmt || {}), bold: true } : ctx.fmt };
        const children = blocks(cell, cellCtx);
        return new TableCell({
          children: children.length ? children : [new Paragraph('')],
          columnSpan: +cell.getAttribute('colspan') || undefined,
          rowSpan: +cell.getAttribute('rowspan') || undefined,
          shading: head ? { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
        });
      }),
    })),
  }), new Paragraph('')];
}

function block(el, ctx) {
  const pic = ctx.pics.get(el);
  if (pic) {
    if (pic.data) return [new Paragraph({ ...ctx.box, alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 }, children: [imageRun(pic)] })];
    return [paragraph([new TextRun({ text: pic.text, font: el.matches('.x-math-block') ? 'Cambria Math' : MONO, color: '6B7280' })], ctx, { alignment: AlignmentType.CENTER })];
  }
  const tag = el.tagName;
  const cls = el.classList;
  if (/^H[1-6]$/.test(tag)) {
    const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][+tag[1] - 1];
    if (cls.contains('x-title')) {
      const note = el.closest('.x-note');
      const runs = inlines(el, {}, ctx);
      return [new Paragraph({
        heading: HeadingLevel.TITLE,
        pageBreakBefore: ctx.notesSeen++ > 0 ? ctx.pageBreaks : ctx.hasContents,
        children: note ? [new Bookmark({ id: bookmarkId(note.id.slice(5)), children: runs })] : runs,
      })];
    }
    return [new Paragraph({ ...ctx.box, heading: level, alignment: alignment(el), children: inlines(el, {}, ctx) })];
  }
  if (tag === 'P') {
    if (cls.contains('x-video')) return [paragraph(inlines(el, { color: '4B5563' }, ctx), ctx)];
    const runs = inlines(el, ctx.fmt || {}, ctx);
    return [paragraph(runs.length ? runs : [new TextRun('')], ctx, { alignment: alignment(el) })];
  }
  if (tag === 'UL' || tag === 'OL') return listBlocks(el, ctx);
  if (tag === 'LI') return blocks(el, ctx);
  if (tag === 'PRE') return codeParagraphs(el, ctx);
  if (tag === 'TABLE') return tableBlock(el, ctx);
  if (tag === 'HR') return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }, children: [] })];
  if (tag === 'BLOCKQUOTE') {
    const box = { ...ctx.box, indent: { left: 240 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D1D5DB', space: 10 } } };
    return blocks(el, { ...ctx, box, fmt: { ...(ctx.fmt || {}), color: '4B5563' } });
  }
  if (cls.contains('x-meta')) {
    return [new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: [...el.children].map(c => c.textContent).join('   '), color: '6B7280', size: 18 })] })];
  }
  if (cls.contains('x-callout')) {
    const color = CALLOUT_COLORS[el.getAttribute('data-callout')] || CALLOUT_COLORS.info;
    const box = {
      ...ctx.box,
      shading: { type: ShadingType.CLEAR, fill: tint(color), color: 'auto' },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color, space: 8 } },
      indent: { left: 200, right: 120 },
    };
    const title = el.querySelector(':scope > .x-callout-title');
    const out = title ? [new Paragraph({ ...box, spacing: { before: 160 }, children: [new TextRun({ text: title.textContent, bold: true, color })] })] : [];
    const inner = el.cloneNode(false);
    for (const c of [...el.childNodes]) if (c !== title) inner.appendChild(c);
    out.push(...blocks(inner, { ...ctx, box }));
    for (const c of [...inner.childNodes]) el.appendChild(c); // put them back
    return out;
  }
  if (cls.contains('x-toggle-summary')) return [paragraph([new TextRun({ text: '▾ ', color: '9CA3AF' }), ...inlines(el, { bold: true }, ctx)], ctx)];
  if (cls.contains('x-toc-head') || cls.contains('x-contents')) {
    if (cls.contains('x-contents')) {
      const out = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] })];
      for (const a of el.querySelectorAll('a')) {
        out.push(new Paragraph({
          indent: { left: (parseInt(a.style.paddingLeft, 10) || 0) * 15 },
          children: [new InternalHyperlink({ anchor: bookmarkId(a.getAttribute('href').slice(6)), children: [new TextRun({ text: a.textContent, style: 'Hyperlink' })] })],
        }));
      }
      return out;
    }
    return [paragraph([new TextRun({ text: el.textContent, bold: true })], ctx)];
  }
  if (cls.contains('x-toc-item')) {
    return [paragraph([new TextRun({ text: el.textContent, color: '4B5563' })], ctx, { indent: { left: (parseInt(el.style.paddingLeft, 10) || 0) * 15 } })];
  }
  return blocks(el, ctx);
}

/** A pale version of a colour, for callout backgrounds. */
function tint(hexColor) {
  const n = parseInt(hexColor, 16);
  const mix = c => Math.round(c + (255 - c) * 0.9).toString(16).padStart(2, '0');
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix).join('').toUpperCase();
}

// ───────────────────────── document ─────────────────────────

/** Build a .docx Blob from export HTML made by buildDocument(). */
export async function htmlToDocx({ body, css }, { title, pageSize = 'A4', pageBreaks = true, onProgress } = {}) {
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
  const root = doc.body;
  const pics = await preparePictures(root, css, onProgress);
  onProgress?.('Writing the Word document…');
  listInstance = 0;
  const ctx = { pics, box: {}, list: null, fmt: null, pageBreaks, notesSeen: 0, hasContents: !!root.querySelector('.x-contents') };
  const children = blocks(root, ctx);

  const bulletChars = ['•', '◦', '▪'];
  const size = pageSize === 'Letter' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };
  const document = new Document({
    title,
    creator: 'Synapse',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: '1F2330' }, paragraph: { spacing: { after: 100, line: 288, lineRule: LineRuleType.AUTO } } },
        title: { run: { font: 'Calibri', size: 48, bold: true, color: '111827' }, paragraph: { spacing: { after: 80 } } },
        heading1: { run: { font: 'Calibri', size: 34, bold: true, color: '111827' }, paragraph: { spacing: { before: 320, after: 120 } } },
        heading2: { run: { font: 'Calibri', size: 29, bold: true, color: '111827' }, paragraph: { spacing: { before: 280, after: 100 } } },
        heading3: { run: { font: 'Calibri', size: 25, bold: true, color: '111827' }, paragraph: { spacing: { before: 240, after: 80 } } },
        heading4: { run: { font: 'Calibri', size: 22, bold: true, color: '111827' } },
        hyperlink: { run: { color: '4F46E5', underline: {} } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i, format: LevelFormat.BULLET, text: bulletChars[i % 3], alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 300 } } },
          })),
        },
        {
          reference: 'ordered',
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size,
          margin: { top: 1020, bottom: 1020, left: 1080, right: 1080 },
        },
      },
      children,
    }],
  });
  return Packer.toBlob(document);
}
