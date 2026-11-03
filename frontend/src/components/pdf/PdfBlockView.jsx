// How a PDF block looks in a note: the pages (drawn by pdf.js as you scroll), a bar with
// Mark up / Full screen / Download, and the pen tools while marking up.
//
// Pen and tablet: once a pen has touched a page, fingers scroll instead of drawing (palm rejection);
// with a mouse or before any pen is seen, fingers draw too.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper } from '@tiptap/react';
import { FileText, PenLine, Highlighter, Eraser, Undo2, Redo2, Maximize2, Minimize2, Download, Trash2, Eye, EyeOff, ZoomIn, ZoomOut, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { pdfBytes, pdfError } from '../../pdf/files';
import { PAGE_W, INK_COLORS, HIGHLIGHT_COLORS, SIZES, parseInk, serializeInk, inkCount, tidyStroke, drawInk, hitStrokes, bakeInk } from '../../pdf/ink';

let penSeen = false; // for this tab: a pen was used, so fingers scroll (shared by all PDF blocks)
const uid = () => Math.random().toString(36).slice(2, 10);

export default function PdfBlockView({ node, updateAttributes, deleteNode, selected, editor }) {
  const { id, name, pages: pageCount } = node.attrs;
  const ink = useMemo(() => parseInk(node.attrs.ink), [node.attrs.ink]);
  const editable = editor.isEditable;

  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [marking, setMarking] = useState(false);
  const [hide, setHide] = useState(false);
  const [tool, setTool] = useState('pen');
  const [colors, setColors] = useState({ pen: INK_COLORS[0], highlighter: HIGHLIGHT_COLORS[0] });
  const [sizes, setSizes] = useState({ pen: SIZES.pen[1], highlighter: SIZES.highlighter[1] });
  const [, bump] = useState(0);
  const history = useRef({ undo: [], redo: [] });
  const [busy, setBusy] = useState(false);

  // Load the file (this device's copy, else the server).
  useEffect(() => {
    if (!id) { setError('This PDF block has no file.'); return; }
    let doc = null, gone = false;
    setError('');
    (async () => {
      try {
        const { loadPdf } = await import('../../pdf/pdfjs');
        doc = await loadPdf(await pdfBytes(id));
        if (gone) doc.destroy(); else setPdf(doc);
      } catch (err) { if (!gone) setError(pdfError(err)); }
    })();
    return () => { gone = true; doc?.destroy(); setPdf(null); };
  }, [id]);

  const total = pdf?.numPages || pageCount || 0;
  useEffect(() => { // keep the stored page count right (older blocks / changed files)
    if (pdf && editable && pdf.numPages !== pageCount) updateAttributes({ pages: pdf.numPages });
  }, [pdf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!editable) setMarking(false); }, [editable]);
  useEffect(() => {
    if (!full) return;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setFull(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [full]);

  const saveInk = useCallback((next, { record = true } = {}) => {
    if (record) { history.current.undo.push(node.attrs.ink || ''); history.current.redo = []; }
    updateAttributes({ ink: serializeInk(next) });
    bump(n => n + 1);
  }, [node.attrs.ink, updateAttributes]);

  const undo = () => {
    const h = history.current;
    if (!h.undo.length) return;
    h.redo.push(node.attrs.ink || '');
    updateAttributes({ ink: h.undo.pop() });
    bump(n => n + 1);
  };
  const redo = () => {
    const h = history.current;
    if (!h.redo.length) return;
    h.undo.push(node.attrs.ink || '');
    updateAttributes({ ink: h.redo.pop() });
    bump(n => n + 1);
  };
  const clearAll = () => {
    if (!inkCount(ink) || !window.confirm('Remove all markings from this PDF?')) return;
    saveInk({});
  };

  const download = async (withInk) => {
    setBusy(true);
    try {
      let bytes = await pdfBytes(id);
      if (withInk) bytes = await bakeInk(bytes, ink);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = withInk ? name.replace(/(\.pdf)?$/i, ' (marked up).pdf') : name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) { toast.error(withInk ? `Couldn’t make the marked-up copy: ${err.message}` : pdfError(err)); }
    setBusy(false);
  };

  const pen = { tool, color: colors[tool], size: sizes[tool] };
  const marks = inkCount(ink);
  const viewer = (
    <div className={`pdf-viewer${full ? ' full' : ''}`} contentEditable={false}>
      <div className="pdf-head" data-drag-handle={full ? undefined : ''}>
        <span className="pdf-name" title={name}><FileText size={14} /> <span>{name}</span></span>
        <span className="pdf-meta">{total ? `${total} page${total === 1 ? '' : 's'}` : ''}{marks ? ` · ${marks} marking${marks === 1 ? '' : 's'}` : ''}</span>
        <span style={{ flex: 1 }} />
        {editable && !error && (
          <button type="button" className={marking ? 'on' : ''} onClick={() => { setMarking(m => !m); setHide(false); }} title="Write and highlight on the pages">
            {marking ? <><Check size={13} /> Done</> : <><PenLine size={13} /> Mark up</>}
          </button>
        )}
        {marks > 0 && !marking && (
          <button type="button" onClick={() => setHide(h => !h)} title={hide ? 'Show markings' : 'Hide markings'}>{hide ? <EyeOff size={13} /> : <Eye size={13} />}</button>
        )}
        {full && <>
          <button type="button" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out"><ZoomOut size={13} /></button>
          <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in"><ZoomIn size={13} /></button>
        </>}
        <DownloadMenu busy={busy} hasInk={marks > 0} onPick={download} />
        <button type="button" onClick={() => { setFull(f => !f); setZoom(1); }} title={full ? 'Back to the note (Esc)' : 'Full screen'}>
          {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        {editable && !full && <button type="button" onClick={deleteNode} title="Remove the PDF from the note" style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>}
      </div>

      {marking && (
        <div className="pdf-tools">
          <ToolButton on={tool === 'pen'} onClick={() => setTool('pen')} title="Pen"><PenLine size={15} /></ToolButton>
          <ToolButton on={tool === 'highlighter'} onClick={() => setTool('highlighter')} title="Highlighter"><Highlighter size={15} /></ToolButton>
          <ToolButton on={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (removes whole strokes)"><Eraser size={15} /></ToolButton>
          {tool !== 'eraser' && <>
            <span className="pdf-sep" />
            {(tool === 'pen' ? INK_COLORS : HIGHLIGHT_COLORS).map(c => (
              <button key={c} type="button" className={`pdf-swatch${colors[tool] === c ? ' on' : ''}`} style={{ background: c }}
                onClick={() => setColors(s => ({ ...s, [tool]: c }))} title="Colour" />
            ))}
            <span className="pdf-sep" />
            {SIZES[tool].map(s => (
              <button key={s} type="button" className={`pdf-size${sizes[tool] === s ? ' on' : ''}`} onClick={() => setSizes(v => ({ ...v, [tool]: s }))} title="Thickness">
                <i style={{ width: Math.min(18, 3 + s * (tool === 'pen' ? 2 : 0.6)), height: Math.min(18, 3 + s * (tool === 'pen' ? 2 : 0.6)), background: colors[tool], opacity: tool === 'highlighter' ? 0.6 : 1 }} />
              </button>
            ))}
          </>}
          <span className="pdf-sep" />
          <ToolButton onClick={undo} disabled={!history.current.undo.length} title="Undo"><Undo2 size={15} /></ToolButton>
          <ToolButton onClick={redo} disabled={!history.current.redo.length} title="Redo"><Redo2 size={15} /></ToolButton>
          {marks > 0 && <button type="button" className="pdf-clear" onClick={clearAll}>Clear all</button>}
        </div>
      )}

      {error ? <div className="pdf-error">{error}</div> : (
        <Pages pdf={pdf} total={total} zoom={full ? zoom : 1} full={full} ink={hide ? {} : ink}
          marking={marking} pen={pen} onStroke={(page, st) => saveInk({ ...ink, [page]: [...(ink[page] || []), st] })}
          onErase={(page, ids) => saveInk({ ...ink, [page]: (ink[page] || []).filter(s => !ids.has(s.id)) })} />
      )}
    </div>
  );

  return (
    <NodeViewWrapper className={`pdf-block${selected ? ' selected' : ''}`}>
      {full ? <>
        <div className="pdf-placeholder" contentEditable={false}><FileText size={16} /> {name} is open full screen</div>
        {createPortal(viewer, document.body)}
      </> : viewer}
    </NodeViewWrapper>
  );
}

function ToolButton({ on, children, ...rest }) {
  return <button type="button" className={`pdf-tool${on ? ' on' : ''}`} {...rest}>{children}</button>;
}

function DownloadMenu({ busy, hasInk, onPick }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => document.removeEventListener('click', close);
  }, [open]);
  if (!hasInk) return <button type="button" onClick={() => onPick(false)} disabled={busy} title="Download the PDF">{busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />}</button>;
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} disabled={busy} title="Download">{busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />}</button>
      {open && (
        <div className="pdf-menu">
          <button type="button" onClick={() => onPick(true)}>With my markings</button>
          <button type="button" onClick={() => onPick(false)}>Original PDF</button>
        </div>
      )}
    </span>
  );
}

// ───────────────────────── pages ─────────────────────────

function Pages({ pdf, total, zoom, full, ink, marking, pen, onStroke, onErase }) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const [ratios, setRatios] = useState({}); // page → height / width
  const [visible, setVisible] = useState(() => new Set([1, 2]));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Full screen: "100%" = a comfortable reading width, not the whole monitor.
    const ro = new ResizeObserver(() => setWidth(Math.floor(Math.min(el.clientWidth - (full ? 48 : 24), full ? 980 : 9999))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  // Page shapes (cheap; no drawing) so the scroll height is right before pages are drawn.
  useEffect(() => {
    if (!pdf) return;
    let gone = false;
    (async () => {
      const r = {};
      for (let i = 1; i <= pdf.numPages && !gone; i++) {
        const p = await pdf.getPage(i);
        const v = p.getViewport({ scale: 1 });
        r[i] = v.height / v.width;
        if (i === 1 || i % 20 === 0 || i === pdf.numPages) setRatios({ ...r });
      }
    })().catch(() => {});
    return () => { gone = true; };
  }, [pdf]);

  // Draw pages near the visible area only.
  useEffect(() => {
    const root = box.current;
    if (!root || !pdf) return;
    const io = new IntersectionObserver(entries => {
      setVisible(prev => {
        const next = new Set(prev);
        for (const e of entries) { const n = Number(e.target.dataset.page); if (e.isIntersecting) next.add(n); else next.delete(n); }
        return next;
      });
    }, { root, rootMargin: '800px 0px' });
    for (const el of root.querySelectorAll('[data-page]')) io.observe(el);
    return () => io.disconnect();
  }, [pdf, total, width, zoom]);

  const pageW = Math.max(120, Math.round(width * zoom));
  const fallback = ratios[1] || 1.294;
  return (
    <div ref={box} className={`pdf-pages${marking ? ' marking' : ''}`}>
      {!pdf && <div className="pdf-loading"><Loader2 size={16} className="spin" /> Opening the PDF…</div>}
      {pdf && width > 0 && Array.from({ length: total }, (_, i) => i + 1).map(n => (
        <Page key={n} pdf={pdf} n={n} width={pageW} ratio={ratios[n] || fallback} show={visible.has(n)}
          strokes={ink[n]} marking={marking} pen={pen} onStroke={onStroke} onErase={onErase} />
      ))}
    </div>
  );
}

function Page({ pdf, n, width, ratio, show, strokes, marking, pen, onStroke, onErase }) {
  const holder = useRef(null);
  const inkCanvas = useRef(null);
  const live = useRef(null);       // stroke being drawn
  const erasing = useRef(null);    // Set of stroke ids erased in this gesture
  const pan = useRef(null);        // finger scrolling while a pen is in use: { x, y, el }
  const height = Math.round(width * ratio);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [drawn, setDrawn] = useState(0);

  // The page picture
  useEffect(() => {
    if (!show) return;
    let gone = false;
    const t = setTimeout(async () => {
      try {
        const { renderPage } = await import('../../pdf/pdfjs');
        const { canvas } = await renderPage(pdf, n, width, dpr);
        if (gone || !holder.current) return;
        canvas.className = 'pdf-canvas';
        holder.current.replaceChildren(canvas);
        setDrawn(width);
      } catch { /* destroyed while drawing */ }
    }, drawn ? 150 : 0); // re-draw after a resize settles
    return () => { gone = true; clearTimeout(t); };
  }, [pdf, n, width, show]); // eslint-disable-line react-hooks/exhaustive-deps

  // The markings
  const paint = useCallback(() => {
    const c = inkCanvas.current;
    if (!c) return;
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const list = erasing.current ? (strokes || []).filter(s => !erasing.current.has(s.id)) : strokes;
    drawInk(ctx, live.current ? [...(list || []), live.current] : list, w / PAGE_W);
  }, [strokes, width, height, dpr]);
  useEffect(() => { paint(); }, [paint]);

  const at = e => {
    const r = inkCanvas.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAGE_W, ((e.clientY - r.top) / r.width) * PAGE_W, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
  };
  const eraseAt = e => {
    const [x, y] = at(e);
    for (const s of hitStrokes(strokes, x, y, 8)) erasing.current.add(s.id);
    paint();
  };

  const down = e => {
    if (!marking || e.button > 0) return;
    if (e.pointerType === 'pen') penSeen = true;
    e.preventDefault();
    e.stopPropagation();
    inkCanvas.current.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch' && penSeen) { // palm / finger: scroll the pages instead of drawing
      pan.current = { x: e.clientX, y: e.clientY, el: inkCanvas.current.closest('.pdf-pages') };
      return;
    }
    if (pen.tool === 'eraser') { erasing.current = new Set(); eraseAt(e); return; }
    live.current = { id: uid(), tool: pen.tool, color: pen.color, size: pen.size, pen: e.pointerType === 'pen', points: [at(e)] };
    paint();
  };
  const move = e => {
    if (pan.current) {
      const p = pan.current;
      p.el?.scrollBy(p.x - e.clientX, p.y - e.clientY);
      p.x = e.clientX; p.y = e.clientY;
      return;
    }
    if (erasing.current) { e.preventDefault(); eraseAt(e); return; }
    if (!live.current) return;
    e.preventDefault();
    const evs = e.nativeEvent.getCoalescedEvents?.() || [];
    for (const ev of evs.length ? evs : [e]) live.current.points.push(at(ev));
    paint();
  };
  const up = () => {
    if (pan.current) { pan.current = null; return; }
    if (erasing.current) {
      const ids = erasing.current;
      erasing.current = null;
      if (ids.size) onErase(n, ids); else paint();
      return;
    }
    const st = live.current;
    live.current = null;
    if (st) onStroke(n, tidyStroke(st));
  };

  // While marking the browser mustn't scroll on its own (a pen would scroll too); fingers are panned by hand.
  const touchAction = marking ? 'none' : 'auto';
  return (
    <div className="pdf-page" data-page={n} style={{ width, height }}>
      <div ref={holder} className="pdf-picture" />
      <canvas ref={inkCanvas} className="pdf-ink" style={{ width, height, touchAction, cursor: marking ? (pen.tool === 'eraser' ? 'cell' : 'crosshair') : 'default', pointerEvents: marking ? 'auto' : 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <span className="pdf-pageno">{n}</span>
    </div>
  );
}
