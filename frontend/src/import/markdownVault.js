// Obsidian vaults and Notion exports ("Markdown & CSV"): folders of .md files with pictures and
// files beside them. Both become a tree of notes:
//   • a folder becomes a note holding its notes — or uses its "folder note" as that note's text
//     (Obsidian: Folder/Folder.md; Notion: "Page abc123.md" next to the folder "Page abc123/");
//   • pictures become pictures in the note, PDFs become PDF blocks, other files 📎 chips;
//   • links become [[Note title]] links.
import { ImportBuilder, readEntries, stripCommonRoot, frontMatter, tagList, isImageName, escapeHtml } from './common';

const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const base = p => p.split('/').pop();
const dir = p => p.split('/').slice(0, -1).join('/');
const noExt = p => p.replace(/\.[^./]+$/, '');
function joinPath(from, rel) {
  const parts = from ? from.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export async function importVault(fileList, kind, workspaceId, onProgress) {
  const notion = kind === 'notion';
  onProgress?.('Reading files…');
  let entries = await readEntries(fileList, onProgress);
  const stripped = stripCommonRoot(entries);
  entries = stripped.entries;
  const b = new ImportBuilder(notion ? 'Notion' : 'Obsidian');
  const skipDir = notion ? /^$/ : /(^|\/)(\.obsidian|\.trash|\.git)(\/|$)/;
  entries = entries.filter(e => !skipDir.test(e.path) || notion);

  const byPath = new Map(entries.map(e => [e.path, e]));
  const byName = new Map(); // lower-case file name (with and without extension) → entries, for Obsidian's [[short links]]
  for (const e of entries) {
    for (const k of [base(e.path).toLowerCase(), noExt(base(e.path)).toLowerCase()]) {
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    }
  }
  const pretty = name => (notion ? name.replace(NOTION_ID, '') : name).trim();
  const isNote = p => /\.md$/i.test(p) || (notion && /\.csv$/i.test(p) && !/_all\.csv$/i.test(p));
  const notePaths = entries.map(e => e.path).filter(isNote);
  if (!notePaths.length) throw new Error(notion
    ? 'No pages found. In Notion choose Settings → Export all workspace content (or ⋯ → Export on a page) with “Markdown & CSV”, then pick the .zip here.'
    : 'No notes (.md files) found. Pick your vault folder, or a .zip of it.');

  // Folders that contain notes (directly or deeper)
  const folders = new Set();
  for (const p of notePaths) { let d = dir(p); while (d) { folders.add(d); d = dir(d); } }

  // Which note stands for each folder
  const folderNote = new Map(); // folder path → note path
  for (const f of folders) {
    const sibling = `${f}.md`;                         // Notion style (a page, or a database's table)
    const inside = `${f}/${base(f)}.md`;               // Obsidian folder-note style
    if (byPath.has(sibling)) folderNote.set(f, sibling);
    else if (notion && byPath.has(`${f}.csv`)) folderNote.set(f, `${f}.csv`);
    else if (!notion && byPath.has(inside)) folderNote.set(f, inside);
  }
  const noteOfFolder = new Map([...folderNote].map(([f, n]) => [n, f]));

  const keyFor = p => `p:${p}`;
  const parentKeyOf = p => {
    // A folder note's parent is the parent of its folder.
    const f = noteOfFolder.get(p);
    const d = f ? dir(f) : dir(p);
    return d ? (folderNote.has(d) ? keyFor(folderNote.get(d)) : `d:${d}`) : null;
  };
  // Folder notes for folders without one (parents first)
  for (const f of [...folders].sort((a, c) => a.split('/').length - c.split('/').length)) {
    if (folderNote.has(f)) continue;
    const d = dir(f);
    b.add({ key: `d:${f}`, parentKey: d ? (folderNote.has(d) ? keyFor(folderNote.get(d)) : `d:${d}`) : null, title: pretty(base(f)), html: '' });
  }

  // Notes
  let i = 0;
  const pending = [];
  for (const p of notePaths.sort((a, c) => a.split('/').length - c.split('/').length || a.localeCompare(c))) {
    onProgress?.(`Reading note ${++i} of ${notePaths.length}…`);
    const text = await byPath.get(p).blob.text();
    const title = pretty(noExt(base(p)));
    if (/\.csv$/i.test(p)) {
      b.add({ key: keyFor(p), parentKey: parentKeyOf(p), title, html: csvTable(text, b, title) });
      continue;
    }
    const { body, data } = frontMatter(text);
    if (data['excalidraw-plugin']) { b.skip(title, 'Excalidraw drawing (open it in Obsidian and export a picture)'); continue; }
    let md = body;
    if (notion) md = md.replace(/^﻿?#\s+(.+)\r?\n+/, (m, h) => (h.trim() === title ? '' : m)); // Notion repeats the title as "# Title"
    const n = b.add({ key: keyFor(p), parentKey: parentKeyOf(p), title: data.title || title, md, tags: [...tagList(data.tags), ...tagList(data.tag)] });
    n.path = p;
    pending.push(n);
  }
  for (const e of entries) if (/\.canvas$/i.test(e.path)) b.skip(pretty(noExt(base(e.path))), 'Obsidian canvas (not supported)');

  // Files referenced by notes → assets; links → [[titles]]
  const resolveFile = (ref, from) => {
    ref = decode(ref.split('#')[0].split('?')[0]).trim();
    if (!ref || /^[a-z]+:/i.test(ref)) return null;
    const rel = byPath.get(joinPath(dir(from), ref)) || byPath.get(ref.replace(/^\/+/, ''));
    if (rel) return rel;
    const hits = byName.get(base(ref).toLowerCase()) || byName.get(`${base(ref).toLowerCase()}.md`);
    return hits?.[0] || null;
  };
  for (const n of pending) {
    // Embeds: ![[file]] / ![[Note]] (Obsidian)
    n.md = n.md.replace(/!\[\[([^\]\n]+?)\]\]/g, (m, inner) => {
      const [target] = inner.split('|');
      const e = resolveFile(target, n.path);
      if (!e) return m.slice(1); // a note: keep as a link
      if (isNote(e.path)) return `[[${target.split('#')[0]}]]`;
      return blockOrInline(b.asset(n, e.blob, base(e.path)));
    });
    // Markdown pictures and links to files: ![alt](path) / [text](path)
    n.md = n.md.replace(/(!?)\[([^\]\n]*)\]\(<?([^)<>\n]+?)>?(?:\s+"[^"]*")?\)/g, (m, bang, text, href) => {
      if (/^(https?:|mailto:|#)/i.test(href)) return m;
      const e = resolveFile(href, n.path);
      if (!e) return bang ? `*[${text || base(decode(href))} — not found]*` : text || m;
      if (isNote(e.path)) {
        const target = b.byKey.get(keyFor(e.path)) || b.byKey.get(`d:${noExt(e.path)}`);
        return target ? `[[@@${target.key}@@${text && text !== target.title ? `|${text.replace(/[[\]|]/g, '')}` : ''}]]` : text;
      }
      if (bang || isImageName(e.path)) return b.asset(n, e.blob, base(e.path));
      return blockOrInline(b.asset(n, e.blob, base(e.path)));
    });
  }

  // Obsidian [[Name]] links → the (possibly renamed) title of that note
  const noteByName = new Map();
  for (const n of b.notes) if (n.path) { const k = noExt(base(n.path)).toLowerCase(); if (!noteByName.has(k)) noteByName.set(k, n); }
  for (const n of b.notes) if (!noteByName.has(n.title.toLowerCase())) noteByName.set(n.title.toLowerCase(), n);
  const rewriteLinks = (md, n, titleOf) => md
    .replace(/\[\[@@([^@]+)@@((?:\|[^\]]*)?)\]\]/g, (m, key, alias) => `[[${titleOf(key) || 'Untitled'}${alias}]]`)
    .replace(/\[\[([^\]\n|#^]+)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g, (m, target, heading, alias) => {
      const t = noteByName.get(base(target.trim()).replace(/\.md$/i, '').toLowerCase());
      if (!t) return m;
      return `[[${t.title}${alias || ''}]]`;
    });

  return b.finish(workspaceId, { rewriteLinks, onProgress });
}

// A PDF / file placeholder on a line of its own stays a block; elsewhere it's inline.
function blockOrInline(html) {
  return html.startsWith('<div') ? `\n\n${html}\n\n` : html;
}

/** A Notion database (CSV) as a table (the rows' own pages are imported beside it). */
function csvTable(text, b, title) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return '<p><em>Empty table</em></p>';
  const shown = rows.slice(0, 501);
  if (rows.length > 501) b.skip(title, `table has ${rows.length - 1} rows — only the first 500 were imported`);
  const cell = (tag, v) => `<${tag}><p>${escapeHtml(v)}</p></${tag}>`;
  return `<table><tbody>${shown.map((r, i) => `<tr>${r.map(v => cell(i ? 'td' : 'th', v)).join('')}</tr>`).join('')}</tbody></table>`;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some(v => v !== '')) rows.push(row); row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some(v => v !== '')) rows.push(row);
  return rows;
}
