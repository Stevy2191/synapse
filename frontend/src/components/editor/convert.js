// Convert note text between Markdown and the rich-text editor's HTML, so switching a note's
// mode carries its content across instead of showing an empty page.
import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'dompurify';
import { CALLOUTS, CALLOUT_FROM_MD } from './blocks';

// Diagrams (draw.io / Excalidraw) are kept in Markdown as a fenced block, so they survive
// switching a note between Write and Markdown:
//   ```synapse-diagram
//   {"kind":"drawio","scene":null,"preview":"data:image/svg+xml;base64,…"}
//   ```
export const DIAGRAM_FENCE = /```synapse-diagram\n([\s\S]*?)\n```/g;

export function markdownToHtml(md) {
  const html = DOMPurify.sanitize(marked.parse(md || '', { gfm: true, breaks: true }));
  // GFM checklists come out as <li><input type=checkbox> …</li>; the rich editor wants task lists.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
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
  // "[TOC]" on its own line → table of contents
  for (const p of doc.querySelectorAll('p')) {
    if (p.textContent.trim().toUpperCase() === '[TOC]') {
      const toc = doc.createElement('div');
      toc.setAttribute('data-toc', '');
      p.replaceWith(toc);
    }
  }
  // <details>: the editor wants <summary> then a content wrapper
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
  blankReplacement: (content, node) => (node.nodeName === 'DIV' && node.hasAttribute('data-toc') ? '\n\n[TOC]\n\n' : node.isBlock ? '\n\n' : ''),
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
turndown.addRule('toc', {
  filter: node => node.nodeName === 'DIV' && node.hasAttribute('data-toc'),
  replacement: () => '\n\n[TOC]\n\n',
});
turndown.addRule('details', {
  filter: 'details',
  replacement: (content, node) => {
    const summary = node.querySelector(':scope > summary')?.textContent.trim() || '';
    const inner = node.querySelector(':scope > [data-type="detailsContent"]');
    const body = inner ? turndown.turndown(inner.innerHTML) : '';
    return `\n\n<details>\n<summary>${summary.replace(/</g, '&lt;')}</summary>\n\n${body.trim()}\n\n</details>\n\n`;
  },
});
turndown.addRule('underline', { filter: ['u'], replacement: content => `<u>${content}</u>` });
turndown.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: content => `~~${content}~~` });

export function htmlToMarkdown(html) {
  if (!html) return '';
  return turndown.turndown(html)
    .replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]') // keep [[wiki links]] unescaped
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
