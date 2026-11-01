// Math (KaTeX), videos (YouTube / Vimeo / video files) and Mermaid charts for notes.
import { useEffect, useRef, useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ExternalLink, Trash2 } from 'lucide-react';

// ─────────────────────────────── Math ───────────────────────────────

export function renderMath(latex, displayMode) {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'htmlAndMathml', trust: false });
  } catch {
    return `<code>${latex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`;
  }
}

/**
 * Pull $…$ / $$…$$ math out of Markdown before it's parsed (so _ and \ survive), leaving
 * placeholders. Code spans and fences are left alone. Inline math follows the usual rule:
 * no space just inside the $ signs and no digit right after the closing $ (so "$5 and $10" is money).
 */
export function extractMath(md) {
  const items = [];
  const out = (md || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part, i) => {
    if (i % 2 === 1) return part; // code
    return part
      .replace(/(^|\n)\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?=\s*(\n|$))/g, (m, pre, tex) => {
        items.push({ latex: tex.trim(), block: true });
        return `${pre}\n\nSYNMATHB${items.length - 1}Z\n\n`;
      })
      .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?![\d$])/g, (m, pre, tex) => {
        items.push({ latex: tex, block: false });
        return `${pre}SYNMATHI${items.length - 1}Z`;
      });
  }).join('');
  return { md: out, items };
}

/** Put math back into HTML made from extractMath()'s Markdown. `render(item)` returns its HTML. */
export function restoreMath(html, items, render) {
  return html
    .replace(/<p>\s*SYNMATHB(\d+)Z\s*<\/p>/g, (m, n) => (items[n] ? render(items[n]) : m))
    .replace(/SYNMATH[BI](\d+)Z/g, (m, n) => (items[n] ? render(items[n]) : m));
}

const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** HTML the editor reads for a math item. */
export const mathNodeHtml = ({ latex, block }) => (block
  ? `<div data-type="block-math" data-latex="${attr(latex)}"></div>`
  : `<span data-type="inline-math" data-latex="${attr(latex)}"></span>`);

// Common pieces, for the math dialog's buttons.
export const MATH_SNIPPETS = [
  ['x²', '^{2}'], ['xₙ', '_{n}'], ['a/b', '\\frac{a}{b}'], ['√', '\\sqrt{x}'], ['Σ', '\\sum_{i=1}^{n}'], ['∫', '\\int_{a}^{b}'],
  ['lim', '\\lim_{x \\to \\infty}'], ['π', '\\pi'], ['θ', '\\theta'], ['α', '\\alpha'], ['β', '\\beta'], ['Δ', '\\Delta'],
  ['±', '\\pm'], ['×', '\\times'], ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\neq'], ['≈', '\\approx'], ['∞', '\\infty'], ['→', '\\rightarrow'],
  ['[ ]', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'],
];

export function MathDialog({ initial, inline: initialInline, editing, onSave, onDelete, onClose }) {
  const [latex, setLatex] = useState(initial || '');
  const [inline, setInline] = useState(!!initialInline);
  const ta = useRef(null);
  useEffect(() => { ta.current?.focus(); ta.current?.select(); }, []);
  const insert = text => {
    const el = ta.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = latex.slice(0, a) + text + latex.slice(b);
    setLatex(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; });
  };
  const save = () => latex.trim() && onSave(latex.trim(), inline);
  return (
    <div className="math-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="math-dialog" role="dialog" aria-label="Math equation">
        <div className="math-dialog-head">
          <b>{editing ? 'Edit equation' : 'Insert equation'}</b>
          {!editing && (
            <div className="seg" style={{ display: 'inline-flex' }}>
              <button className={!inline ? 'on' : ''} onClick={() => setInline(false)}>Own line</button>
              <button className={inline ? 'on' : ''} onClick={() => setInline(true)}>In the text</button>
            </div>
          )}
        </div>
        <div className="math-snippets">
          {MATH_SNIPPETS.map(([label, tex]) => (
            <button key={label} type="button" title={tex} onMouseDown={e => e.preventDefault()} onClick={() => insert(tex)}>{label}</button>
          ))}
        </div>
        <textarea ref={ta} value={latex} onChange={e => setLatex(e.target.value)} spellCheck={false} rows={3}
          placeholder="LaTeX, e.g.  E = mc^2   or   \frac{a}{b}"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || inline)) { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }} />
        <div className={`math-preview${inline ? '' : ' block'}`}
          dangerouslySetInnerHTML={{ __html: latex.trim() ? renderMath(latex, !inline) : '<span class="math-empty">Preview appears here</span>' }} />
        <div className="math-actions">
          {editing && <button type="button" className="cp-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>}
          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-muted)' }}>{inline ? 'Enter' : 'Ctrl+Enter'} to save</span>
          <button type="button" className="cp-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="cp-btn primary" disabled={!latex.trim()} onClick={save}>{editing ? 'Save' : 'Insert'}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Video ───────────────────────────────

/** What a video link plays as: { kind: 'iframe' | 'video', src, provider } or null. */
export function videoSource(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const start = Number.parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '', 10);
  const startQ = Number.isFinite(start) && start > 0 ? `?start=${start}` : '';
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/) || [])[1];
  }
  if (id && /^[\w-]{6,}$/.test(id)) return { kind: 'iframe', provider: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${id}${startQ}` };
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vid = (u.pathname.match(/(\d{5,})/) || [])[1];
    if (vid) return { kind: 'iframe', provider: 'Vimeo', src: `https://player.vimeo.com/video/${vid}` };
  }
  if (host === 'loom.com') {
    const lid = (u.pathname.match(/\/(?:share|embed)\/([0-9a-f]{16,})/) || [])[1];
    if (lid) return { kind: 'iframe', provider: 'Loom', src: `https://www.loom.com/embed/${lid}` };
  }
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(u.pathname)) return { kind: 'video', provider: 'Video', src: u.href };
  return null;
}

export function videoElementHtml(url) {
  const v = videoSource(url);
  if (!v) return null;
  const media = v.kind === 'video'
    ? `<video controls preload="metadata" src="${attr(v.src)}"></video>`
    : `<iframe src="${attr(v.src)}" title="${v.provider} video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return `<div class="video-embed"><div class="video-frame">${media}</div></div>`;
}

function VideoView({ node, deleteNode, selected, editor }) {
  const url = node.attrs.url;
  const v = videoSource(url);
  return (
    <NodeViewWrapper className={`video-embed${selected ? ' selected' : ''}`} data-drag-handle="">
      {v ? (
        <div className="video-frame">
          {v.kind === 'video'
            ? <video controls preload="metadata" src={v.src} />
            : <iframe src={v.src} title={`${v.provider} video`} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" />}
        </div>
      ) : <div className="video-bad">This video link isn't supported: {url}</div>}
      <div className="video-bar" contentEditable={false}>
        <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> {v?.provider || 'Link'}</a>
        {editor.isEditable && <button type="button" onClick={deleteNode} title="Remove video"><Trash2 size={12} /> Remove</button>}
      </div>
    </NodeViewWrapper>
  );
}

export const VideoEmbed = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: '', parseHTML: el => el.getAttribute('data-video') || '', renderHTML: a => ({ 'data-video': a.url }) } };
  },
  parseHTML() { return [{ tag: 'div[data-video]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', HTMLAttributes]; },
  addNodeView() { return ReactNodeViewRenderer(VideoView); },
});

// ─────────────────────────────── Mermaid ───────────────────────────────

let mermaidPromise = null;
let renderCount = 0;
function isLight() {
  return ['light', 'neural-light'].includes(document.documentElement.getAttribute('data-theme'));
}

/** SVG for a Mermaid chart (Mermaid is large, so it's only downloaded when a chart is shown). */
export async function renderMermaid(code) {
  mermaidPromise ||= import('mermaid').then(m => m.default);
  const mermaid = await mermaidPromise;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isLight() ? 'default' : 'dark', fontFamily: 'inherit' });
  const id = `mmd-${Date.now().toString(36)}-${renderCount++}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return { svg };
  } catch (err) {
    document.getElementById(id)?.remove();
    document.getElementById('d' + id)?.remove();
    return { error: String(err?.message || err).split('\n').slice(0, 3).join(' ') };
  }
}

export function MermaidPreview({ code, onClick }) {
  const [state, setState] = useState({ svg: '', error: '' });
  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) { setState({ svg: '', error: '' }); return undefined; }
    const t = setTimeout(async () => {
      const r = await renderMermaid(code);
      if (!cancelled) setState(prev => (r.svg ? { svg: r.svg, error: '' } : { svg: prev.svg, error: r.error }));
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [code]);
  return (
    <div className="mermaid-preview" contentEditable={false} onClick={onClick}>
      {state.svg ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
        : !state.error && <div className="mermaid-empty">{code.trim() ? 'Drawing…' : 'Write a Mermaid chart above'}</div>}
      {state.error && <div className="mermaid-error">{state.error}</div>}
    </div>
  );
}

export const MERMAID_SAMPLE = `flowchart LR
    A[Start] --> B{Working?}
    B -- Yes --> C[Great]
    B -- No --> D[Fix it]
    D --> B`;
