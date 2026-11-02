// The look of exported notes (PDF, HTML, and the pictures of equations/charts used in Word files).
// Fonts are embedded as data: URLs so an export looks the same everywhere — on the server that
// prints PDFs (which has no internet), and in a downloaded .html file opened offline.
import katexCss from 'katex/dist/katex.min.css?raw';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter400i from '@fontsource/inter/files/inter-latin-400-italic.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';

const katexFonts = import.meta.glob('/node_modules/katex/dist/fonts/*.woff2', { query: '?url', import: 'default', eager: true });

const dataUrlCache = new Map();
async function asDataUrl(url) {
  if (!dataUrlCache.has(url)) {
    dataUrlCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    }).then(b => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).replace(/^data:[^;,]*/, 'data:font/woff2'));
      fr.onerror = reject;
      fr.readAsDataURL(b);
    })).catch(() => { dataUrlCache.delete(url); return null; }));
  }
  return dataUrlCache.get(url);
}

async function fontFace(family, url, weight, style = 'normal') {
  const data = await asDataUrl(url);
  return data ? `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;src:url(${data}) format("woff2")}` : '';
}

/** KaTeX's stylesheet with its fonts inlined (only the woff2 files; every browser reads those). */
async function inlineKatexCss() {
  const byName = {};
  for (const [path, url] of Object.entries(katexFonts)) byName[path.split('/').pop()] = url;
  const names = [...new Set([...katexCss.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map(m => m[1]))];
  const data = Object.fromEntries(await Promise.all(names.map(async n => [n, byName[n] ? await asDataUrl(byName[n]) : null])));
  // src: url(a.woff2) format("woff2"), url(a.woff) format("woff"), url(a.ttf) format("truetype")
  return katexCss.replace(/src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\)(,url\(fonts\/[^)]+\) format\("[a-z]+"\))*/g,
    (m, name) => (data[name] ? `src:url(${data[name]}) format("woff2")` : m));
}

const DOCUMENT_CSS = `
:root { color-scheme: light; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #1f2330; font: 400 11pt/1.6 "Inter", "Segoe UI", "Noto Sans", Arial, sans-serif; }
.x-doc { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
@media print { .x-doc { max-width: none; padding: 0; } }
.x-note + .x-note { margin-top: 56px; padding-top: 32px; border-top: 1px solid #e5e7eb; }
.x-pagebreaks .x-note + .x-note { break-before: page; margin-top: 0; padding-top: 0; border-top: none; }
@media screen { .x-pagebreaks .x-note + .x-note { margin-top: 56px; padding-top: 32px; border-top: 1px solid #e5e7eb; } }
.x-title { font-size: 24pt; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
.x-meta { color: #6b7280; font-size: 9pt; margin: 0 0 22px; display: flex; flex-wrap: wrap; gap: 6px 12px; }
.x-tag { color: #4f46e5; }
.x-contents { margin: 0 0 32px; padding: 16px 20px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; break-after: page; }
.x-contents h2 { margin: 0 0 8px; font-size: 13pt; }
.x-contents a { display: block; color: #1f2330; text-decoration: none; padding: 2px 0; }
.x-contents a:hover { color: #4f46e5; }
.x-body h1 { font-size: 18pt; } .x-body h2 { font-size: 15pt; } .x-body h3 { font-size: 13pt; }
.x-body h4, .x-body h5, .x-body h6 { font-size: 11pt; }
.x-body h1, .x-body h2, .x-body h3, .x-body h4, .x-body h5, .x-body h6 { line-height: 1.3; margin: 1.4em 0 0.5em; font-weight: 650; break-after: avoid; }
.x-body p { margin: 0.55em 0; }
.x-body a { color: #4f46e5; }
.x-body ul, .x-body ol { padding-left: 1.6em; margin: 0.5em 0; }
.x-body ul { list-style: disc; } .x-body ol { list-style: decimal; }
.x-body li > p { margin: 0.15em 0; }
.x-body blockquote { margin: 0.8em 0; padding: 2px 0 2px 14px; border-left: 3px solid #d1d5db; color: #4b5563; }
.x-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
.x-body img { max-width: 100%; height: auto; }
.x-body mark { background: #fef08a; color: inherit; padding: 0 2px; border-radius: 2px; }
.x-body code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 0.88em; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.x-body pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
.x-body pre code { background: none; padding: 0; font-size: 9pt; line-height: 1.5; }
.x-code-lang { display: block; font: 600 8pt "Inter", sans-serif; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.x-body table { border-collapse: collapse; width: 100%; margin: 0.9em 0; font-size: 10pt; break-inside: auto; }
.x-body th, .x-body td { border: 1px solid #d1d5db; padding: 6px 9px; text-align: left; vertical-align: top; }
.x-body th { background: #f3f4f6; font-weight: 600; }
.x-body td > p, .x-body th > p { margin: 0; }
.x-tasks { list-style: none !important; padding-left: 0.3em !important; }
.x-tasks li { display: flex; gap: 8px; align-items: flex-start; }
.x-tasks li > .x-box { flex: none; width: 1.2em; line-height: 1.6; margin: 0.15em 0; }
.x-tasks li > div { flex: 1; min-width: 0; }
.x-tasks li > div > :first-child { margin-top: 0.15em; }
.x-tasks li.done > div { color: #9ca3af; text-decoration: line-through; }
.x-callout { --c: #6366f1; margin: 0.9em 0; padding: 10px 14px; border-left: 4px solid var(--c); border-radius: 6px; background: color-mix(in srgb, var(--c) 9%, #fff); break-inside: avoid; }
.x-callout[data-callout="tip"] { --c: #10b981; } .x-callout[data-callout="warning"] { --c: #f59e0b; } .x-callout[data-callout="danger"] { --c: #ef4444; }
.x-callout-title { font-weight: 650; color: var(--c); margin-bottom: 2px; }
.x-callout > :last-child { margin-bottom: 0; }
.x-toggle { margin: 0.8em 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 14px; }
.x-toggle-summary { font-weight: 600; }
.x-toggle-summary.x-level-1 { font-size: 1.75em; font-weight: 700; }
.x-toggle-summary.x-level-2 { font-size: 1.4em; font-weight: 700; }
.x-toggle-summary.x-level-3 { font-size: 1.17em; font-weight: 700; }
.x-toggle-summary::before { content: "▾ "; color: #9ca3af; }
.x-task-count { font-weight: 500; font-size: 0.8em; color: #6b7280; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: #f3f4f6; }
.x-toc { margin: 0.8em 0; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
.x-toc-head { font-weight: 650; margin-bottom: 4px; }
.x-toc-item { color: #4b5563; }
.x-figure { margin: 1em 0; text-align: center; break-inside: avoid; }
.x-figure img, .x-figure svg { max-width: 100%; height: auto; }
.x-mermaid { margin: 1em 0; text-align: center; break-inside: avoid; }
.x-mermaid svg { max-width: 100%; height: auto; }
.x-math-block { margin: 0.8em 0; text-align: center; overflow-x: auto; }
.x-video { padding: 8px 12px; border: 1px dashed #d1d5db; border-radius: 6px; color: #4b5563; }
.x-link { color: #4f46e5; text-decoration: none; border-bottom: 1px dotted #a5b4fc; }
.x-missing { color: #9ca3af; font-style: italic; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-template-tag, .hljs-meta .hljs-keyword { color: #d73a49; }
.hljs-string, .hljs-regexp, .hljs-char.escape_, .hljs-template-variable, .hljs-meta .hljs-string { color: #032f62; }
.hljs-number, .hljs-literal, .hljs-variable.constant_, .hljs-attr, .hljs-attribute { color: #005cc5; }
.hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-section { color: #6f42c1; }
.hljs-built_in, .hljs-type, .hljs-symbol, .hljs-selector-class, .hljs-selector-id { color: #e36209; }
.hljs-name, .hljs-tag, .hljs-selector-attr, .hljs-selector-pseudo { color: #22863a; }
.hljs-addition { color: #22863a; background: #f0fff4; } .hljs-deletion { color: #b31d28; background: #ffeef0; }
.hljs-meta { color: #735c0f; } .hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }
`;

let cssPromise = null;
/** The full stylesheet for exported notes (fonts embedded). */
export function exportCss() {
  cssPromise ||= Promise.all([
    fontFace('Inter', inter400, 400), fontFace('Inter', inter400i, 400, 'italic'),
    fontFace('Inter', inter600, 600), fontFace('Inter', inter700, 700),
    fontFace('JetBrains Mono', mono400, 400),
    inlineKatexCss(),
  ]).then(parts => parts.join('\n') + DOCUMENT_CSS).catch(err => { cssPromise = null; throw err; });
  return cssPromise;
}
