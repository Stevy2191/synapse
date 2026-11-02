// Convert note text between Markdown and the rich-text editor's HTML, so switching a note's
// mode carries its content across instead of showing an empty page.
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import { CALLOUTS, CALLOUT_FROM_MD } from './blocks';
import { extractMath, restoreMath, mathNodeHtml, videoSource } from './embeds';

// Diagrams (draw.io / Excalidraw) are kept in Markdown as a fenced block, so they survive
// switching a note between Write and Markdown:
//   ```synapse-diagram
//   {"kind":"drawio","scene":null,"preview":"data:image/svg+xml;base64,…"}
//   ```
export const DIAGRAM_FENCE = /```synapse-diagram\n([\s\S]*?)\n```/g;

export function markdownToHtml(md) {
  // $…$ and $$…$$ math is set aside first so Markdown doesn't eat its _ and \ characters.
  const math = extractMath(md);
  const html = restoreMath(DOMPurify.sanitize(marked.parse(math.md, { gfm: true, breaks: true })), math.items, mathNodeHtml);
  // GFM checklists come out as <li><input type=checkbox> …</li>; the rich editor wants task lists.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const code of doc.querySelectorAll('pre > code.language-synapse-meeting')) {
    try {
      const [first, ...rest] = code.textContent.split('\n');
      const meta = JSON.parse(first);
      const byName = Object.fromEntries(Object.entries(meta.speakers || {}).map(([k, v]) => [v, Number(k)]));
      const secs = c => c.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
      const segments = rest.map(l => /^\[([\d:]+)\] ([^:]+): (.*)$/.exec(l)).filter(Boolean).map(m => {
        const who = m[2].trim();
        const sp = who in byName ? byName[who] : /^Speaker (\d+)$/.test(who) ? Number(who.slice(8)) - 1 : null;
        return { start: secs(m[1]), end: secs(m[1]), speaker: sp, text: m[3] };
      });
      segments.forEach((s, i) => { s.end = segments[i + 1]?.start ?? meta.duration ?? s.start; });
      const div = doc.createElement('div');
      if (meta.id) div.setAttribute('data-meeting', meta.id);
      if (meta.localId) div.setAttribute('data-local-id', meta.localId);
      div.setAttribute('data-title', meta.title || 'Meeting');
      div.setAttribute('data-status', meta.status || 'processing');
      div.setAttribute('data-duration', String(meta.duration || 0));
      if (meta.createdAt) div.setAttribute('data-created', String(meta.createdAt));
      div.setAttribute('data-summary-inserted', meta.summaryInserted ? 'true' : 'false');
      div.setAttribute('data-segments', JSON.stringify(segments));
      div.setAttribute('data-speakers', JSON.stringify(meta.speakers || {}));
      code.parentElement.replaceWith(div);
    } catch { /* leave it as code */ }
  }
  for (const code of doc.querySelectorAll('pre > code.language-synapse-diagram')) {
    try {
      const d = JSON.parse(code.textContent);
      const fig = doc.createElement('figure');
      fig.setAttribute('data-diagram', d.kind === 'excalidraw' ? 'excalidraw' : 'drawio');
      fig.setAttribute('data-scene', d.scene || '');
      const img = doc.createElement('img');
      if (typeof d.preview === 'string' && d.preview.startsWith('data:image/')) img.setAttribute('src', d.preview);
      fig.appendChild(img);
      code.parentElement.replaceWith(fig);
    } catch {}
  }
  convertCallouts(doc, (box, type) => {
    box.setAttribute('data-callout', type);
  });
  // A paragraph that is just "[▶ …](video link)" → video
  for (const p of doc.querySelectorAll('p')) {
    const a = p.children.length === 1 ? p.querySelector(':scope > a') : null;
    if (!a || p.textContent.trim() !== a.textContent.trim() || !a.textContent.trim().startsWith('▶')) continue;
    if (!videoSource(a.getAttribute('href'))) continue;
    const v = doc.createElement('div');
    v.setAttribute('data-video', a.getAttribute('href'));
    p.replaceWith(v);
  }
  // "![[Drawing]]" on its own line → an embedded Free Draw note
  for (const p of doc.querySelectorAll('p')) {
    const m = p.textContent.trim().match(/^!\[\[([^\[\]\n]+)\]\]$/);
    if (!m) continue;
    const d = doc.createElement('div');
    d.setAttribute('data-drawing', m[1].trim());
    p.replaceWith(d);
  }
  // "[TOC]" on its own line → table of contents
  for (const p of doc.querySelectorAll('p')) {
    if (p.textContent.trim().toUpperCase() === '[TOC]') {
      const toc = doc.createElement('div');
      toc.setAttribute('data-toc', '');
      p.replaceWith(toc);
    }
  }
  // <details>: the editor wants <summary> then a content wrapper
  // [📎 Name](href) links are file chips
  for (const a of doc.querySelectorAll('a[href]')) {
    const text = a.textContent.trim();
    if (!text.startsWith('📎')) continue;
    a.setAttribute('data-file', /[?&]att=/.test(a.getAttribute('href')) ? 'copy' : 'link');
    a.setAttribute('data-name', text.replace(/^📎\s*/, ''));
  }
  for (const det of doc.querySelectorAll('details')) {
    let summary = det.querySelector(':scope > summary');
    if (!summary) { summary = doc.createElement('summary'); det.prepend(summary); }
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-type', 'detailsContent');
    for (const child of [...det.childNodes]) if (child !== summary) wrap.appendChild(child);
    if (!wrap.textContent.trim() && !wrap.querySelector('img, table, figure')) wrap.innerHTML = '<p></p>';
    det.appendChild(wrap);
  }
  for (const ul of doc.querySelectorAll('ul')) {
    const items = [...ul.children].filter(li => li.tagName === 'LI');
    if (items.length === 0 || !items.every(li => li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'))) continue;
    ul.setAttribute('data-type', 'taskList');
    for (const li of items) {
      const box = li.querySelector('input[type="checkbox"]');
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', box.checked ? 'true' : 'false');
      box.remove();
      if (!li.querySelector(':scope > p')) li.innerHTML = `<p>${li.innerHTML.trim()}</p>`;
    }
  }
  return doc.body.innerHTML;
}

// Blocks that have no text of their own (Turndown would otherwise drop them as empty).
function special(node) {
  if (node.nodeType !== 1) return null;
  if (node.hasAttribute('data-toc')) return '\n\n[TOC]\n\n';
  const type = node.getAttribute('data-type');
  if (type === 'inline-math') return `$${node.getAttribute('data-latex') || ''}$`;
  if (type === 'block-math') return `\n\n$$\n${node.getAttribute('data-latex') || ''}\n$$\n\n`;
  if (node.hasAttribute('data-drawing')) return `\n\n![[${node.getAttribute('data-drawing')}]]\n\n`;
  if (node.hasAttribute('data-video')) return `\n\n[▶ Video](${node.getAttribute('data-video')})\n\n`;
  return null;
}

/**
 * GitHub-style alerts ("> [!NOTE]" as the first line of a quote) → callout boxes.
 * `make(box, type)` finishes the new element (editor and preview mark it up differently).
 */
export function convertCallouts(doc, make) {
  for (const bq of [...doc.querySelectorAll('blockquote')]) {
    const first = bq.firstElementChild;
    if (!first || first.tagName !== 'P') continue;
    const m = first.innerHTML.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DANGER)\]\s*(<br\s*\/?>)?\s*/i);
    if (!m) continue;
    const type = CALLOUT_FROM_MD[m[1].toUpperCase()];
    first.innerHTML = first.innerHTML.slice(m[0].length);
    if (!first.innerHTML.trim()) first.remove();
    const box = doc.createElement('div');
    box.className = 'callout';
    while (bq.firstChild) box.appendChild(bq.firstChild);
    if (!box.firstChild) box.innerHTML = '<p></p>';
    bq.replaceWith(box);
    make(box, type);
  }
}

const turndown = new TurndownService({
  headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*',
  // Empty elements are normally dropped; the table of contents is empty by design.
  blankReplacement: (content, node) => special(node) ?? (node.isBlock ? '\n\n' : ''),
});
turndown.addRule('taskItem', {
  filter: node => node.nodeName === 'LI' && (node.getAttribute('data-type') === 'taskItem' || node.parentNode?.getAttribute?.('data-type') === 'taskList'),
  replacement: (content, node) => `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`,
});
turndown.addRule('taskList', {
  filter: node => node.nodeName === 'UL' && node.getAttribute('data-type') === 'taskList',
  replacement: content => `\n\n${content}\n\n`,
});
// Tables -> GitHub-style Markdown tables (the first row becomes the header row).
turndown.addRule('table', {
  filter: 'table',
  replacement: (content, node) => {
    const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(cell =>
      turndown.turndown(cell.innerHTML).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()));
    if (rows.length === 0) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const line = r => `| ${[...r, ...Array(cols - r.length).fill('')].join(' | ')} |`;
    return `\n\n${line(rows[0])}\n| ${Array(cols).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
  },
});
turndown.addRule('diagram', {
  filter: node => node.nodeName === 'FIGURE' && node.hasAttribute('data-diagram'),
  replacement: (content, node) => {
    const d = { kind: node.getAttribute('data-diagram'), scene: node.getAttribute('data-scene') || null, preview: node.querySelector('img')?.getAttribute('src') || null };
    return `\n\n\`\`\`synapse-diagram\n${JSON.stringify(d)}\n\`\`\`\n\n`;
  },
});
turndown.addRule('callout', {
  filter: node => node.nodeName === 'DIV' && node.hasAttribute('data-callout'),
  replacement: (content, node) => {
    const kind = (CALLOUTS[node.getAttribute('data-callout')] || CALLOUTS.info).md;
    const body = content.trim().split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
    return `\n\n> [!${kind}]\n${body}\n\n`;
  },
});
turndown.addRule('special', {
  filter: node => special(node) !== null,
  replacement: (content, node) => special(node),
});
// File chips (FileLink): [📎 Name](href)
turndown.addRule('fileLink', {
  filter: node => node.nodeName === 'A' && node.hasAttribute('data-file'),
  replacement: (content, node) => `[📎 ${(node.getAttribute('data-name') || 'File').replace(/[[\]]/g, '')}](${node.getAttribute('href') || ''})`,
});
// Meeting blocks: ```synapse-meeting fence — a line of settings, then the transcript, readable.
const mClock = t => { const x = Math.max(0, Math.floor(t || 0)); const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const s = String(x % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`; };
turndown.addRule('meeting', {
  filter: node => node.nodeName === 'DIV' && (node.hasAttribute('data-meeting') || node.hasAttribute('data-local-id')),
  replacement: (content, node) => {
    let segments = [], speakers = {};
    try { segments = JSON.parse(node.getAttribute('data-segments') || '[]'); } catch { /* none */ }
    try { speakers = JSON.parse(node.getAttribute('data-speakers') || '{}'); } catch { /* none */ }
    const meta = {
      id: node.getAttribute('data-meeting') || null, localId: node.getAttribute('data-local-id') || null,
      title: node.getAttribute('data-title') || 'Meeting', status: node.getAttribute('data-status') || 'processing',
      duration: Number(node.getAttribute('data-duration')) || 0, createdAt: Number(node.getAttribute('data-created')) || null,
      summaryInserted: node.getAttribute('data-summary-inserted') === 'true', speakers,
    };
    const name = i => (i === null || i === undefined ? 'Someone' : speakers[i] || `Speaker ${i + 1}`);
    const lines = segments.map(s => `[${mClock(s.start)}] ${name(s.speaker)}: ${String(s.text).replace(/\n/g, ' ')}`);
    return `\n\n\`\`\`synapse-meeting\n${JSON.stringify(meta)}\n${lines.join('\n')}\n\`\`\`\n\n`;
  },
});
turndown.addRule('details', {
  filter: 'details',
  replacement: (content, node) => {
    const summaryEl = node.querySelector(':scope > summary');
    const summary = summaryEl?.textContent.trim() || '';
    const level = parseInt(summaryEl?.getAttribute('data-level'), 10) || 0;
    const inner = node.querySelector(':scope > [data-type="detailsContent"]');
    const body = inner ? turndown.turndown(inner.innerHTML) : '';
    return `\n\n<details>\n<summary${level ? ` data-level="${level}"` : ''}>${summary.replace(/</g, '&lt;')}</summary>\n\n${body.trim()}\n\n</details>\n\n`;
  },
});
turndown.addRule('underline', { filter: ['u'], replacement: content => `<u>${content}</u>` });
turndown.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: content => `~~${content}~~` });

export function htmlToMarkdown(html) {
  if (!html) return '';
  // Inline math has no text of its own, and Turndown drops the spaces around empty inline
  // elements; a placeholder character keeps them (the math rule replaces the whole element).
  if (html.includes('inline-math')) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    for (const el of doc.querySelectorAll('[data-type="inline-math"]')) el.textContent = '\u2060';
    html = doc.body.innerHTML;
  }
  return turndown.turndown(html)
    .replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]') // keep [[wiki links]] unescaped
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
