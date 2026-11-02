// Free Draw: an infinite page for handwriting and sketching.
//  - Pen, touch and mouse all draw (Pointer Events). Once a pen is used, "pen only" turns on:
//    fingers then pan and pinch-zoom instead of drawing, so a resting palm leaves no marks.
//  - Pressure-sensitive ink (perfect-freehand), marker, highlighter, stroke and pixel erasers,
//    shapes (hold still at the end of a stroke to snap it to a neat line / rectangle / ellipse),
//    text, sticky notes and pictures; lasso to select, move, resize and recolour.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2, Hand, PenLine, Highlighter, Eraser, Shapes, Type, StickyNote, ImagePlus, Undo2, Redo2,
  ZoomIn, ZoomOut, Maximize, Download, Trash2, Copy, ArrowUpToLine, ArrowDownToLine, LayoutGrid, Minus, ScanText,
  Square, Circle, MoveUpRight, Fingerprint, Check, ChevronDown, Brush,
} from 'lucide-react';
import toast from 'react-hot-toast';
import ColorPicker from '../ColorPicker';
import { fitImage } from '../../utils/image';
import {
  load, serialize, uid, unionBounds, hits, hitTop, lassoSelect, translate, scale, recognize,
  STICKY_COLORS, STICKY_W, textSize, stickyLayout,
} from './model';
import ReadTextDialog from '../ocr/ReadTextDialog';
import { useStore } from '../../stores/useStore';
import { createNote, saveNote, openNote } from '../../offline/sync';
import { drawScene, drawElement, backgroundStyle, resolvePaper, inkColor, PAPER, previewDataUrl, renderToCanvas, toSvg } from './render';

const INK = ['ink', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'];
const HIGHLIGHT = ['#fde047', '#86efac', '#67e8f9', '#f9a8d4', '#fdba74', '#c4b5fd'];
const SIZES = { pen: [2, 4, 7, 12], marker: [6, 10, 16, 24], highlighter: [14, 22, 32], shape: [2, 4, 7], text: [16, 22, 32, 48], eraser: [10, 20, 40] };
const DRAW_TOOLS = new Set(['pen', 'marker', 'highlighter']);
const SHAPES = [['line', Minus, 'Line'], ['arrow', MoveUpRight, 'Arrow'], ['rect', Square, 'Rectangle'], ['ellipse', Circle, 'Ellipse']];
const MIN_ZOOM = 0.1, MAX_ZOOM = 8;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const appIsLight = () => ['light', 'neural-light'].includes(document.documentElement.getAttribute('data-theme'));

function usePref(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s); } catch { return initial; } });
  const set = useCallback(next => setV(prev => {
    const val = typeof next === 'function' ? next(prev) : next;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
    return val;
  }), [key]);
  return [v, set];
}

let clipboard = []; // copied elements (within Synapse)

export default function FreeDraw({ canvasData, onChange, title = 'Drawing' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [doc, setDoc] = useState(() => load(canvasData));
  const docRef = useRef(doc); docRef.current = doc;
  const past = useRef([]), future = useRef([]);
  const [, bump] = useState(0); // re-render for undo/redo availability

  const [view, setViewState] = useState({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  const setView = useCallback(v => { viewRef.current = typeof v === 'function' ? v(viewRef.current) : v; setViewState(viewRef.current); }, []);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const [tool, setTool] = usePref('synapse.draw.tool', 'pen');
  const [shapeKind, setShapeKind] = usePref('synapse.draw.shape', 'rect');
  const [settings, setSettings] = usePref('synapse.draw.settings', {
    pen: { color: 'ink', size: 4 }, marker: { color: '#ef4444', size: 10 }, highlighter: { color: '#fde047', size: 22 },
    shape: { color: 'ink', size: 4 }, text: { color: 'ink', size: 22 }, eraser: { mode: 'stroke', size: 20 },
  });
  const [penOnly, setPenOnly] = usePref('synapse.draw.penOnly', false);
  const [selection, setSelection] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // id of the text/sticky being typed in
  const [menu, setMenu] = useState(null); // 'shapes' | 'page' | 'export'
  const [light, setLight] = useState(appIsLight);
  const paperKey = resolvePaper(doc.paper, light);

  // Follow the app's light/dark theme
  useEffect(() => {
    const mo = new MutationObserver(() => setLight(appIsLight()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // ── Saving (with a preview picture for embeds) ──
  const saveTimer = useRef(null);
  const pendingSave = useRef(false);
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!pendingSave.current) return;
    pendingSave.current = false;
    const d = docRef.current;
    let preview = null;
    try { preview = previewDataUrl(d, d.paper === 'dark' ? 'dark' : 'light'); } catch { /* ignore */ }
    onChange(serialize(d, preview));
  }, [onChange]);
  const scheduleSave = useCallback(() => {
    pendingSave.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 700);
  }, [flush]);
  useEffect(() => () => flush(), [flush]);

  /** Change the drawing. `history: false` for changes that shouldn't be undone separately. */
  const commit = useCallback((patch, { history = true } = {}) => {
    const prev = docRef.current;
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
    if (history) { past.current.push(prev); if (past.current.length > 200) past.current.shift(); future.current = []; }
    docRef.current = next;
    setDoc(next);
    bump(n => n + 1);
    scheduleSave();
  }, [scheduleSave]);
  const setElements = useCallback((fn, opts) => commit(d => ({ elements: typeof fn === 'function' ? fn(d.elements) : fn }), opts), [commit]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    future.current.push(docRef.current);
    const prev = past.current.pop();
    docRef.current = prev; setDoc(prev); setSelection(new Set()); setEditing(null); bump(n => n + 1); scheduleSave();
  }, [scheduleSave]);
  const redo = useCallback(() => {
    if (!future.current.length) return;
    past.current.push(docRef.current);
    const next = future.current.pop();
    docRef.current = next; setDoc(next); setSelection(new Set()); bump(n => n + 1); scheduleSave();
  }, [scheduleSave]);

  // ── View ──
  const toWorld = useCallback((sx, sy) => { const v = viewRef.current; return [v.x + sx / v.zoom, v.y + sy / v.zoom]; }, []);
  const local = e => { const r = canvasRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const zoomAt = useCallback((factor, sx, sy) => {
    setView(v => {
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = v.x + sx / v.zoom, wy = v.y + sy / v.zoom;
      return { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
    });
  }, [setView]);
  const fit = useCallback((maxZoom = 1.5) => {
    const b = unionBounds(docRef.current.elements);
    const { w, h } = sizeRef.current;
    if (!b) { setView({ x: -w / 2, y: -h / 3, zoom: 1 }); return; }
    const pad = 48;
    const zoom = clamp(Math.min((w - pad * 2) / (b.x2 - b.x1 || 1), (h - pad * 2) / (b.y2 - b.y1 || 1)), MIN_ZOOM, maxZoom);
    setView({ zoom, x: (b.x1 + b.x2) / 2 - w / 2 / zoom, y: (b.y1 + b.y2) / 2 - h / 2 / zoom });
  }, [setView]);

  const sizeRef = useRef(size);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: r.width, h: r.height };
      setSize(sizeRef.current);
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    sizeRef.current = { w: r.width, h: r.height };
    setSize(sizeRef.current);
    // Start with the whole drawing in view (not zoomed in past 100%).
    const b = unionBounds(docRef.current.elements);
    if (b && (b.x1 < 0 || b.y1 < 0 || b.x2 > r.width || b.y2 > r.height)) fit(1); else setView({ x: 0, y: 0, zoom: 1 });
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rendering ──
  const live = useRef(null);      // { kind: 'stroke'|'shape'|'lasso'|'erase'|'move'|'scale', … }
  const frame = useRef(0);
  const render = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      const v = viewRef.current;
      const L = live.current;
      let elements = docRef.current.elements;
      const skip = new Set(editingRef.current ? [editingRef.current] : []);
      if (L?.kind === 'erase') L.removed.forEach(id => skip.add(id));
      if (L?.kind === 'move' || L?.kind === 'scale') elements = elements.map(el => (L.ids.has(el.id) ? L.apply(el) : el));
      drawScene(ctx, elements, { view: v, dpr, width: w, height: h, paperKey: paperRef.current, skip, onImageLoad: render });
      // The thing being drawn right now
      if (L?.kind === 'stroke') drawElement(ctx, L.snap ? { ...L.snap, type: 'shape', size: L.el.size, color: L.el.color } : L.el, paperRef.current);
      if (L?.kind === 'shape') drawElement(ctx, L.el, paperRef.current);
      // Overlays in screen pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const S = (x, y) => [(x - v.x) * v.zoom, (y - v.y) * v.zoom];
      if (L?.kind === 'lasso' && L.points.length > 1) {
        ctx.beginPath();
        L.points.forEach(([x, y], i) => { const [a, b] = S(x, y); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
        ctx.closePath();
        ctx.fillStyle = 'rgba(124,123,255,0.08)'; ctx.fill();
        ctx.setLineDash([5, 4]); ctx.strokeStyle = '#7c7bff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
      if (L?.kind === 'erase' && L.at) {
        const [a, b] = S(L.at[0], L.at[1]);
        ctx.beginPath(); ctx.arc(a, b, (L.radius) * v.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(127,127,127,0.8)'; ctx.lineWidth = 1; ctx.stroke();
      }
      const sel = selBoundsOf(elements);
      if (sel) {
        const [a, b] = S(sel.x1, sel.y1), [c, d] = S(sel.x2, sel.y2);
        ctx.strokeStyle = '#7c7bff'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.strokeRect(a - 4, b - 4, c - a + 8, d - b + 8); ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        for (const [hx, hy] of [[a - 4, b - 4], [c + 4, b - 4], [a - 4, d + 4], [c + 4, d + 4]]) {
          ctx.beginPath(); ctx.rect(hx - 5, hy - 5, 10, 10); ctx.fill(); ctx.stroke();
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paperRef = useRef(paperKey); paperRef.current = paperKey;
  const editingRef = useRef(editing); editingRef.current = editing;
  const selRef = useRef(selection); selRef.current = selection;
  function selBoundsOf(elements) {
    if (!selRef.current.size) return null;
    const sel = elements.filter(el => selRef.current.has(el.id));
    return sel.length ? unionBounds(sel) : null;
  }
  useEffect(render, [doc, view, size, selection, editing, paperKey, render]);

  // ── Pointer input ──
  const pointers = useRef(new Map()); // id → { x, y, type }
  const gesture = useRef(null);       // pinch / pan state
  const spaceDown = useRef(false);

  const startGesture = () => {
    const entries = [...pointers.current.entries()].filter(([, p]) => p.type === 'touch');
    const pts = entries.map(([, p]) => p);
    const v = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: v.zoom, wx: v.x + cx / v.zoom, wy: v.y + cy / v.zoom };
    } else if (pts.length === 1) {
      gesture.current = { kind: 'pan', sx: pts[0].x, sy: pts[0].y, vx: v.x, vy: v.y, pointerId: entries[0][0] };
    }
  };

  const cancelLive = () => { live.current = null; render(); };

  const beginTool = (e, wx, wy) => {
    const s = settings;
    const pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    if (DRAW_TOOLS.has(tool) || (tool === 'eraser' && s.eraser.mode === 'pixel')) {
      const isErase = tool === 'eraser';
      // Eraser sizes are in screen pixels, so they feel the same at any zoom.
      const ts = isErase ? { color: '#000', size: s.eraser.size / viewRef.current.zoom } : s[tool];
      live.current = {
        kind: 'stroke', pointerId: e.pointerId, lastMove: performance.now(), lastPos: [wx, wy],
        el: { id: uid(), type: 'stroke', tool: isErase ? 'erase' : tool, color: ts.color, size: ts.size, pen: e.pointerType === 'pen', points: [[wx, wy, pressure]] },
      };
      if (!isErase && tool !== 'highlighter') armSnap();
    } else if (tool === 'eraser') {
      live.current = { kind: 'erase', pointerId: e.pointerId, removed: new Set(), radius: s.eraser.size / 2 / viewRef.current.zoom, at: [wx, wy] };
      eraseAt(wx, wy);
    } else if (tool === 'shape') {
      live.current = { kind: 'shape', pointerId: e.pointerId, el: { id: uid(), type: 'shape', shape: shapeKind, x1: wx, y1: wy, x2: wx, y2: wy, color: s.shape.color, size: s.shape.size } };
    } else if (tool === 'text') {
      const hit = hitTop(docRef.current.elements, wx, wy, 4 / viewRef.current.zoom);
      if (hit?.type === 'text' || hit?.type === 'sticky') { setEditing(hit.id); return; }
      const el = { id: uid(), type: 'text', x: wx, y: wy - s.text.size * 0.7, text: '', color: s.text.color, fontSize: s.text.size };
      setElements(els => [...els, el]);
      setEditing(el.id);
    } else if (tool === 'sticky') {
      const n = docRef.current.elements.filter(x => x.type === 'sticky').length;
      const el = { id: uid(), type: 'sticky', x: wx - STICKY_W / 2, y: wy - 30, w: STICKY_W, text: '', color: STICKY_COLORS[n % STICKY_COLORS.length] };
      setElements(els => [...els, el]);
      setEditing(el.id);
    } else if (tool === 'select') {
      beginSelect(e, wx, wy);
    }
    render();
  };

  // Hold still for a moment at the end of a stroke → it becomes a neat shape.
  const snapTimer = useRef(null);
  const armSnap = () => {
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const L = live.current;
      if (L?.kind !== 'stroke' || L.snap || performance.now() - L.lastMove < 450) return;
      const shape = recognize(L.el.points);
      if (shape) { L.snap = shape; render(); if (navigator.vibrate) navigator.vibrate(8); }
    }, 550);
  };

  const eraseAt = (wx, wy) => {
    const L = live.current;
    const r = L.radius;
    for (const el of docRef.current.elements) if (!L.removed.has(el.id) && hits(el, wx, wy, r)) L.removed.add(el.id);
  };

  const beginSelect = (e, wx, wy) => {
    const v = viewRef.current;
    const els = docRef.current.elements;
    const sel = selBoundsOf(els);
    const tol = 10 / v.zoom;
    if (sel) {
      // Corner handle → resize
      const corners = [[sel.x1, sel.y1, sel.x2, sel.y2], [sel.x2, sel.y1, sel.x1, sel.y2], [sel.x1, sel.y2, sel.x2, sel.y1], [sel.x2, sel.y2, sel.x1, sel.y1]];
      for (const [cx, cy, ox, oy] of corners) {
        if (Math.abs(wx - cx) < tol + 4 / v.zoom && Math.abs(wy - cy) < tol + 4 / v.zoom) {
          const d0 = Math.hypot(cx - ox, cy - oy) || 1;
          live.current = {
            kind: 'scale', pointerId: e.pointerId, ids: new Set(selRef.current), ox, oy, d0, s: 1,
            apply: el => scale(el, ox, oy, live.current?.s ?? 1),
          };
          return;
        }
      }
      if (wx > sel.x1 - tol && wx < sel.x2 + tol && wy > sel.y1 - tol && wy < sel.y2 + tol) {
        startMove(e, wx, wy, new Set(selRef.current));
        return;
      }
    }
    const hit = hitTop(els, wx, wy, 6 / v.zoom);
    if (hit) {
      const ids = e.shiftKey ? new Set([...selRef.current, hit.id]) : new Set([hit.id]);
      setSelection(ids); selRef.current = ids;
      startMove(e, wx, wy, ids);
      return;
    }
    setSelection(new Set()); selRef.current = new Set();
    live.current = { kind: 'lasso', pointerId: e.pointerId, points: [[wx, wy]], additive: e.shiftKey };
  };

  const startMove = (e, wx, wy, ids) => {
    live.current = { kind: 'move', pointerId: e.pointerId, ids, sx: wx, sy: wy, dx: 0, dy: 0, apply: el => translate(el, live.current?.dx || 0, live.current?.dy || 0) };
  };

  const moveTool = (e, wx, wy) => {
    const L = live.current;
    if (!L || L.pointerId !== e.pointerId) return;
    if (L.kind === 'stroke') {
      if (L.snap) return;
      const evts = e.getCoalescedEvents?.() || [e];
      for (const ce of evts.length ? evts : [e]) {
        const [x, y] = toWorld(...local(ce));
        const p = e.pointerType === 'pen' ? (ce.pressure || 0.5) : 0.5;
        const last = L.el.points[L.el.points.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) * viewRef.current.zoom < 0.6) continue;
        L.el = { ...L.el, points: [...L.el.points, [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]] };
      }
      if (Math.hypot(wx - L.lastPos[0], wy - L.lastPos[1]) * viewRef.current.zoom > 3) {
        L.lastMove = performance.now(); L.lastPos = [wx, wy];
        if (L.el.tool !== 'erase' && L.el.tool !== 'highlighter') armSnap();
      }
    } else if (L.kind === 'shape') {
      let x2 = wx, y2 = wy;
      if (e.shiftKey) { // keep it square / straight
        const dx = wx - L.el.x1, dy = wy - L.el.y1;
        if (L.el.shape === 'line' || L.el.shape === 'arrow') {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          x2 = L.el.x1 + Math.cos(ang) * len; y2 = L.el.y1 + Math.sin(ang) * len;
        } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); x2 = L.el.x1 + Math.sign(dx || 1) * m; y2 = L.el.y1 + Math.sign(dy || 1) * m; }
      }
      L.el = { ...L.el, x2, y2 };
    } else if (L.kind === 'erase') {
      L.at = [wx, wy];
      eraseAt(wx, wy);
    } else if (L.kind === 'lasso') {
      L.points.push([wx, wy]);
    } else if (L.kind === 'move') {
      L.dx = wx - L.sx; L.dy = wy - L.sy;
    } else if (L.kind === 'scale') {
      L.s = Math.max(0.05, Math.hypot(wx - L.ox, wy - L.oy) / L.d0);
    }
    render();
  };

  const endTool = (e) => {
    const L = live.current;
    if (!L || (e && L.pointerId !== e.pointerId)) return;
    clearTimeout(snapTimer.current);
    live.current = null;
    if (L.kind === 'stroke') {
      if (L.snap) {
        setElements(els => [...els, { id: uid(), type: 'shape', ...L.snap, color: L.el.color, size: Math.max(2, L.el.size * (L.el.tool === 'marker' ? 1 : 0.8)) }]);
      } else if (L.el.points.length) {
        setElements(els => [...els, L.el]);
      }
    } else if (L.kind === 'shape') {
      if (Math.hypot(L.el.x2 - L.el.x1, L.el.y2 - L.el.y1) * viewRef.current.zoom > 4) setElements(els => [...els, L.el]);
    } else if (L.kind === 'erase') {
      if (L.removed.size) setElements(els => els.filter(el => !L.removed.has(el.id)));
    } else if (L.kind === 'lasso') {
      const ids = lassoSelect(docRef.current.elements, L.points);
      const next = new Set(L.additive ? [...selRef.current, ...ids] : ids);
      setSelection(next);
    } else if (L.kind === 'move') {
      if (Math.abs(L.dx) + Math.abs(L.dy) > 0.5) setElements(els => els.map(el => (L.ids.has(el.id) ? translate(el, L.dx, L.dy) : el)));
    } else if (L.kind === 'scale') {
      if (Math.abs(L.s - 1) > 0.005) setElements(els => els.map(el => (L.ids.has(el.id) ? scale(el, L.ox, L.oy, L.s) : el)));
    }
    render();
  };

  const onPointerDown = e => {
    // Finish typing in a text box first (its blur saves the text).
    if (editingRef.current) document.activeElement?.blur?.();
    // Don't let the press move keyboard focus (a new text box needs it) or select page text.
    e.preventDefault();
    setMenu(null);
    const [sx, sy] = local(e);
    pointers.current.set(e.pointerId, { x: sx, y: sy, type: e.pointerType });
    canvasRef.current.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'pen' && !penOnly) {
      setPenOnly(true);
      toast('Pen detected: fingers now move and zoom the page. Turn this off with the hand button.', { icon: '✍️', duration: 4000 });
    }
    const touches = [...pointers.current.values()].filter(p => p.type === 'touch').length;
    const isTouch = e.pointerType === 'touch';
    // Fingers: pan/zoom when drawing is pen-only, or as soon as a second finger lands.
    if (isTouch && (penOnly || touches >= 2 || tool === 'hand')) {
      if (live.current && pointers.current.get(live.current.pointerId)?.type === 'touch') cancelLive();
      startGesture();
      return;
    }
    if (tool === 'hand' || e.button === 1 || spaceDown.current) {
      gesture.current = { kind: 'pan', sx, sy, vx: viewRef.current.x, vy: viewRef.current.y, pointerId: e.pointerId };
      return;
    }
    if (e.button && e.button !== 0) return;
    const [wx, wy] = toWorld(sx, sy);
    beginTool(e, wx, wy);
  };

  const onPointerMove = e => {
    const p = pointers.current.get(e.pointerId);
    const [sx, sy] = local(e);
    if (p) { p.x = sx; p.y = sy; }
    const g = gesture.current;
    if (g && p && (g.kind === 'pinch' ? p.type === 'touch' : g.pointerId === e.pointerId)) {
      if (g.kind === 'pinch') {
        const pts = [...pointers.current.values()].filter(q => q.type === 'touch');
        if (pts.length >= 2) {
          const [a, b] = pts;
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          const zoom = clamp(g.zoom * Math.hypot(a.x - b.x, a.y - b.y) / g.dist, MIN_ZOOM, MAX_ZOOM);
          setView({ zoom, x: g.wx - cx / zoom, y: g.wy - cy / zoom });
        }
      } else {
        const z = viewRef.current.zoom;
        setView(v => ({ ...v, x: g.vx - (sx - g.sx) / z, y: g.vy - (sy - g.sy) / z }));
      }
      return;
    }
    if (live.current) {
      const [wx, wy] = toWorld(sx, sy);
      moveTool(e, wx, wy);
    }
  };

  const onPointerUp = e => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    // Only the finger(s) moving the page end the gesture; a pen lifting still finishes its stroke.
    if (g && p && (g.kind === 'pinch' ? p.type === 'touch' : g.pointerId === e.pointerId)) {
      const touchesLeft = [...pointers.current.values()].filter(q => q.type === 'touch').length;
      if (g.kind === 'pinch' && touchesLeft >= 1) startGesture();
      else gesture.current = null;
      return;
    }
    endTool(e);
  };

  // Wheel: scroll to pan, Ctrl/⌘ + wheel (or a trackpad pinch) to zoom
  useEffect(() => {
    const el = canvasRef.current;
    const onWheel = e => {
      e.preventDefault();
      const [sx, sy] = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
      else setView(v => ({ ...v, x: v.x + (e.shiftKey ? e.deltaY : e.deltaX) / v.zoom, y: v.y + (e.shiftKey ? 0 : e.deltaY) / v.zoom }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setView]);

  // ── Selection actions ──
  const selected = useMemo(() => doc.elements.filter(el => selection.has(el.id)), [doc, selection]);
  const deleteSelection = useCallback(() => {
    if (!selRef.current.size) return;
    const ids = selRef.current;
    setElements(els => els.filter(el => !ids.has(el.id)));
    setSelection(new Set());
  }, [setElements]);
  const duplicate = useCallback((els = docRef.current.elements.filter(el => selRef.current.has(el.id)), offset = 24) => {
    if (!els.length) return;
    const copies = els.map(el => ({ ...translate(el, offset, offset), id: uid() }));
    setElements(all => [...all, ...copies]);
    setSelection(new Set(copies.map(c => c.id)));
    setTool('select');
  }, [setElements, setTool]);
  const reorder = front => {
    const ids = selRef.current;
    setElements(els => (front ? [...els.filter(el => !ids.has(el.id)), ...els.filter(el => ids.has(el.id))] : [...els.filter(el => ids.has(el.id)), ...els.filter(el => !ids.has(el.id))]));
  };
  const recolor = color => {
    const ids = selRef.current;
    setElements(els => els.map(el => (!ids.has(el.id) || el.type === 'image' ? el : el.type === 'sticky' ? (STICKY_COLORS.includes(color) ? { ...el, color } : el) : { ...el, color })));
  };

  // ── Pictures ──
  const addImage = useCallback(async (file, at) => {
    try {
      const src = await fitImage(file, 1600);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      const maxW = Math.min(480, (w * 0.6) / v.zoom);
      const s = Math.min(1, maxW / img.naturalWidth);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      const [cx, cy] = at || [v.x + w / 2 / v.zoom, v.y + h / 2 / v.zoom];
      const el = { id: uid(), type: 'image', x: cx - iw / 2, y: cy - ih / 2, w: iw, h: ih, src };
      setElements(els => [...els, el]);
      setSelection(new Set([el.id])); setTool('select');
    } catch (err) { toast.error(err.message || 'Couldn’t add that picture'); }
  }, [setElements, setTool]);
  const pickImage = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => input.files?.[0] && addImage(input.files[0]);
    input.click();
  };

  // ── Keyboard, paste ──
  useEffect(() => {
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
    const onKey = e => {
      if (e.key === ' ' && !typing()) { spaceDown.current = e.type === 'keydown'; if (!typing()) e.preventDefault(); return; }
      if (e.type !== 'keydown' || typing()) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'c' && selRef.current.size) { clipboard = docRef.current.elements.filter(el => selRef.current.has(el.id)); return; }
      if (mod && k === 'x' && selRef.current.size) { clipboard = docRef.current.elements.filter(el => selRef.current.has(el.id)); deleteSelection(); return; }
      if (mod && k === 'v' && clipboard.length) { e.preventDefault(); duplicate(clipboard, 32); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && k === 'a') { e.preventDefault(); setTool('select'); setSelection(new Set(docRef.current.elements.filter(x => !(x.type === 'stroke' && x.tool === 'erase')).map(x => x.id))); return; }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current.size) { e.preventDefault(); deleteSelection(); return; }
      if (e.key === 'Escape') { setSelection(new Set()); setMenu(null); return; }
      const keys = { v: 'select', h: 'hand', p: 'pen', m: 'marker', i: 'highlighter', e: 'eraser', s: 'shape', t: 'text', n: 'sticky' };
      if (keys[k]) setTool(keys[k]);
      if (k === '0') fit();
      if (e.key === '+' || e.key === '=') zoomAt(1.2, sizeRef.current.w / 2, sizeRef.current.h / 2);
      if (e.key === '-') zoomAt(1 / 1.2, sizeRef.current.w / 2, sizeRef.current.h / 2);
    };
    const onPaste = e => {
      if (typing()) return;
      const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); addImage(file); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('paste', onPaste); };
  }, [undo, redo, deleteSelection, duplicate, addImage, fit, zoomAt, setTool]);

  // Changing tools clears a selection (except when selecting)
  useEffect(() => { if (tool !== 'select') setSelection(new Set()); }, [tool]);

  // ── Export ──
  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const safeName = (title || 'Drawing').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  const exportPng = () => {
    const c = renderToCanvas(docRef.current, { paperKey, scale: 2 });
    if (!c) { toast('Nothing to export yet'); return; }
    c.toBlob(b => download(b, `${safeName}.png`), 'image/png');
    setMenu(null);
  };
  // Handwriting → text (the selection, or the whole page), via the AI assistant (or printed-text OCR).
  const [readSrc, setReadSrc] = useState(null);
  const toText = () => {
    const d = docRef.current;
    const els = selected.length ? selected : d.elements;
    const c = renderToCanvas({ ...d, elements: els }, { paperKey, scale: 2 });
    if (!c) { toast('Nothing to read yet'); return; }
    setReadSrc(c.toDataURL('image/png'));
  };
  const textToNote = async text => {
    const ws = useStore.getState().activeWorkspace;
    if (!ws) return;
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const n = await createNote({ workspace_id: ws.id, title: `${title || 'Drawing'} (text)`, note_type: 'note' });
    const looksMd = /^\s*([-*+] (\[[ xX]\] )?|\d+[.)] |#{1,6} )/m.test(text);
    const { markdownToHtml } = await import('../editor/convert');
    await saveNote(n.id, { content: text, rich_content: looksMd ? markdownToHtml(text) : text.split('\n').map(l => `<p>${esc(l) || '<br>'}</p>`).join('') });
    await openNote(n.id);
  };

  const exportSvg = () => {
    const svg = toSvg(docRef.current, paperKey);
    if (!svg) { toast('Nothing to export yet'); return; }
    download(new Blob([svg], { type: 'image/svg+xml' }), `${safeName}.svg`);
    setMenu(null);
  };
  const clearAll = () => {
    if (!docRef.current.elements.length || !window.confirm('Clear the whole page? (You can undo this.)')) return;
    setElements([]); setSelection(new Set());
  };

  // ── Text / sticky editing overlay ──
  const editEl = editing ? doc.elements.find(el => el.id === editing) : null;
  const finishEditing = (text) => {
    const id = editing;
    setEditing(null);
    if (!id) return;
    setElements(els => {
      const el = els.find(x => x.id === id);
      if (!el) return els;
      if (!text.trim() && el.type === 'text') return els.filter(x => x.id !== id);
      return els.map(x => (x.id === id ? { ...x, text } : x));
    }, { history: true });
  };

  const toolSetting = tool === 'shape' ? settings.shape : settings[tool];
  const setToolSetting = patch => setSettings(s => ({ ...s, [tool]: { ...s[tool], ...patch } }));
  const palette = tool === 'highlighter' ? HIGHLIGHT : INK;
  const cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const ShapeIcon = (SHAPES.find(s => s[0] === shapeKind) || SHAPES[2])[1];

  const T = ({ id, icon: Icon, label, keyHint }) => (
    <button type="button" className={`fd-btn${tool === id ? ' on' : ''}`} title={`${label}${keyHint ? ` (${keyHint})` : ''}`} aria-label={label} aria-pressed={tool === id}
      onClick={() => setTool(id)}><Icon size={17} /></button>
  );
  const sw = c => (c === 'ink' ? PAPER[paperKey].ink : c);

  // Floating toolbar over the selection
  const selB = selected.length && !live.current ? unionBounds(selected) : null;
  const selBar = selB && {
    left: clamp((((selB.x1 + selB.x2) / 2) - view.x) * view.zoom, 120, size.w - 120),
    top: Math.max(8, (selB.y1 - view.y) * view.zoom - 52),
  };

  return (
    <div className="fd-root">
      {/* Toolbar */}
      <div className="fd-toolbar" role="toolbar" aria-label="Drawing tools">
        <div className="fd-group">
          <T id="select" icon={MousePointer2} label="Select & lasso" keyHint="V" />
          <T id="hand" icon={Hand} label="Move the page" keyHint="H or Space" />
        </div>
        <div className="fd-group">
          <T id="pen" icon={PenLine} label="Pen" keyHint="P" />
          <T id="marker" icon={Brush} label="Marker" keyHint="M" />
          <T id="highlighter" icon={Highlighter} label="Highlighter" keyHint="I" />
          <T id="eraser" icon={Eraser} label="Eraser" keyHint="E" />
          <span className="fd-split">
            <button type="button" className={`fd-btn${tool === 'shape' ? ' on' : ''}`} title="Shapes (S)" aria-label="Shapes" onClick={() => setTool('shape')}><ShapeIcon size={17} /></button>
            <button type="button" className="fd-caret" aria-label="Choose a shape" onClick={() => setMenu(m => (m === 'shapes' ? null : 'shapes'))}><ChevronDown size={12} /></button>
            {menu === 'shapes' && (
              <div className="fd-menu">
                {SHAPES.map(([k, Icon, label]) => (
                  <button key={k} type="button" className={shapeKind === k ? 'on' : ''} onClick={() => { setShapeKind(k); setTool('shape'); setMenu(null); }}><Icon size={15} /> {label}</button>
                ))}
                <small>Tip: draw a rough shape with the pen and hold still at the end — it snaps to a neat one.</small>
              </div>
            )}
          </span>
          <T id="text" icon={Type} label="Text" keyHint="T" />
          <T id="sticky" icon={StickyNote} label="Sticky note" keyHint="N" />
          <button type="button" className="fd-btn" title="Add a picture (or paste / drop one)" aria-label="Add a picture" onClick={pickImage}><ImagePlus size={17} /></button>
        </div>

        {/* Options for the current tool */}
        {(DRAW_TOOLS.has(tool) || tool === 'shape' || tool === 'text') && (
          <div className="fd-group fd-options">
            {palette.map(c => (
              <button key={c} type="button" className={`fd-swatch${toolSetting.color === c ? ' on' : ''}`} title={c === 'ink' ? 'Ink (black on light paper, white on dark)' : c}
                style={{ background: sw(c) }} onClick={() => setToolSetting({ color: c })} />
            ))}
            <ColorPicker value={toolSetting.color === 'ink' ? '' : toolSetting.color} presets={palette.filter(c => c !== 'ink')} size={22} title="Any colour…" onChange={c => setToolSetting({ color: c })} />
            <span className="fd-sep" />
            {SIZES[tool === 'shape' ? 'shape' : tool].map(n => (
              <button key={n} type="button" className={`fd-size${toolSetting.size === n ? ' on' : ''}`} title={tool === 'text' ? `${n}px text` : `Size ${n}`} onClick={() => setToolSetting({ size: n })}>
                {tool === 'text' ? <span style={{ fontSize: Math.min(18, 8 + n / 4), fontWeight: 600 }}>A</span>
                  : <span className="fd-dot" style={{ width: Math.min(20, 3 + n * (tool === 'highlighter' ? 0.5 : 1.1)), height: Math.min(20, 3 + n * (tool === 'highlighter' ? 0.5 : 1.1)), background: sw(toolSetting.color), opacity: tool === 'highlighter' ? 0.6 : 1 }} />}
              </button>
            ))}
          </div>
        )}
        {tool === 'eraser' && (
          <div className="fd-group fd-options">
            <div className="seg fd-seg">
              <button className={settings.eraser.mode === 'stroke' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, eraser: { ...s.eraser, mode: 'stroke' } }))} title="Erase whole strokes">Whole strokes</button>
              <button className={settings.eraser.mode === 'pixel' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, eraser: { ...s.eraser, mode: 'pixel' } }))} title="Erase only where you rub">Pixels</button>
            </div>
            {SIZES.eraser.map(n => (
              <button key={n} type="button" className={`fd-size${settings.eraser.size === n ? ' on' : ''}`} title={`Size ${n}`} onClick={() => setSettings(s => ({ ...s, eraser: { ...s.eraser, size: n } }))}>
                <span className="fd-dot ring" style={{ width: 6 + n / 3, height: 6 + n / 3 }} />
              </button>
            ))}
          </div>
        )}

        <div className="fd-group fd-right">
          <button type="button" className="fd-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!past.current.length} onClick={undo}><Undo2 size={17} /></button>
          <button type="button" className="fd-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!future.current.length} onClick={redo}><Redo2 size={17} /></button>
          <button type="button" className={`fd-btn${penOnly ? ' on' : ''}`} aria-pressed={penOnly}
            title={penOnly ? 'Pen only: fingers move and zoom the page (palm rejection). Click to let fingers draw.' : 'Fingers draw. Click for pen only (fingers move and zoom).'}
            aria-label="Pen only" onClick={() => setPenOnly(p => !p)}><Fingerprint size={17} /></button>
          <span className="fd-split">
            <button type="button" className="fd-btn" title="Page style" aria-label="Page style" onClick={() => setMenu(m => (m === 'page' ? null : 'page'))}><LayoutGrid size={17} /></button>
            {menu === 'page' && (
              <div className="fd-menu right">
                <div className="fd-menu-label">Background</div>
                {[['blank', 'Blank'], ['lines', 'Lined'], ['grid', 'Grid'], ['dots', 'Dots']].map(([k, l]) => (
                  <button key={k} type="button" className={doc.background === k ? 'on' : ''} onClick={() => commit({ background: k })}>{doc.background === k ? <Check size={14} /> : <span style={{ width: 14 }} />} {l}</button>
                ))}
                <div className="fd-menu-label">Paper</div>
                {[['auto', 'Match the app (light / dark)'], ['light', 'Always light'], ['dark', 'Always dark']].map(([k, l]) => (
                  <button key={k} type="button" className={doc.paper === k ? 'on' : ''} onClick={() => commit({ paper: k })}>{doc.paper === k ? <Check size={14} /> : <span style={{ width: 14 }} />} {l}</button>
                ))}
                <div className="fd-menu-sep" />
                <button type="button" className="danger" onClick={() => { setMenu(null); clearAll(); }}><Trash2 size={14} /> Clear page</button>
              </div>
            )}
          </span>
          <button type="button" className="fd-btn" title="Turn handwriting into text (the selection, or the whole page)" aria-label="To text" onClick={toText}><ScanText size={17} /></button>
          <span className="fd-split">
            <button type="button" className="fd-btn" title="Download" aria-label="Download" onClick={() => setMenu(m => (m === 'export' ? null : 'export'))}><Download size={17} /></button>
            {menu === 'export' && (
              <div className="fd-menu right">
                <button type="button" onClick={exportPng}>PNG picture</button>
                <button type="button" onClick={exportSvg}>SVG (sharp at any size)</button>
              </div>
            )}
          </span>
        </div>
      </div>

      {/* Page */}
      <div ref={wrapRef} className="fd-page" style={backgroundStyle(doc.background, paperKey, view)}
        onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) e.preventDefault(); }}
        onDrop={e => {
          const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
          if (!file) return;
          e.preventDefault();
          const r = canvasRef.current.getBoundingClientRect();
          addImage(file, toWorld(e.clientX - r.left, e.clientY - r.top));
        }}>
        <canvas ref={canvasRef} className="fd-canvas" style={{ cursor }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={e => {
            const [wx, wy] = toWorld(...local(e));
            const hit = hitTop(docRef.current.elements, wx, wy, 4 / viewRef.current.zoom);
            if (hit?.type === 'text' || hit?.type === 'sticky') setEditing(hit.id);
          }}
          onContextMenu={e => e.preventDefault()} />

        {editEl && <TextEditor el={editEl} view={view} paperKey={paperKey} onDone={finishEditing} />}

        {selBar && (
          <div className="fd-selbar" style={{ left: selBar.left, top: selBar.top }} onPointerDown={e => e.stopPropagation()}>
            {(selected.some(el => el.type === 'sticky') && !selected.some(el => el.type !== 'sticky') ? STICKY_COLORS : INK.slice(0, 7)).map(c => (
              <button key={c} type="button" className="fd-swatch" style={{ background: sw(c) }} title="Colour" onClick={() => recolor(c)} />
            ))}
            {!selected.every(el => el.type === 'sticky' || el.type === 'image') && <ColorPicker value="" presets={INK.filter(c => c !== 'ink')} size={20} title="Any colour…" onChange={recolor} />}
            <span className="fd-sep" />
            {selected.length === 1 && (selected[0].type === 'text' || selected[0].type === 'sticky') && (
              <button type="button" className="fd-btn sm" title="Edit text" onClick={() => setEditing(selected[0].id)}><Type size={15} /></button>
            )}
            <button type="button" className="fd-btn sm" title="Duplicate (Ctrl+D)" onClick={() => duplicate()}><Copy size={15} /></button>
            <button type="button" className="fd-btn sm" title="Bring to front" onClick={() => reorder(true)}><ArrowUpToLine size={15} /></button>
            <button type="button" className="fd-btn sm" title="Send to back" onClick={() => reorder(false)}><ArrowDownToLine size={15} /></button>
            <button type="button" className="fd-btn sm danger" title="Delete (Del)" onClick={deleteSelection}><Trash2 size={15} /></button>
          </div>
        )}

        <div className="fd-zoom">
          <button type="button" className="fd-btn sm" title="Zoom out (−)" onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)}><ZoomOut size={15} /></button>
          <button type="button" className="fd-zoom-pct" title="Back to 100%" onClick={() => zoomAt(1 / view.zoom, size.w / 2, size.h / 2)}>{Math.round(view.zoom * 100)}%</button>
          <button type="button" className="fd-btn sm" title="Zoom in (+)" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}><ZoomIn size={15} /></button>
          <button type="button" className="fd-btn sm" title="Show everything (0)" onClick={() => fit()}><Maximize size={15} /></button>
        </div>

        {!doc.elements.length && (
          <div className="fd-empty">
            <PenLine size={22} />
            <div>Draw with your pen, finger or mouse.</div>
            <small>Pinch or scroll to zoom · two fingers to move · hold the pen still at the end of a shape to make it neat</small>
          </div>
        )}
      </div>
    {readSrc && <ReadTextDialog source={readSrc} defaultMode="handwriting" title="Handwriting to text" onNewNote={textToNote} onClose={() => setReadSrc(null)} />}
    </div>
  );
}

/** A textarea placed over a text box or sticky note while you type in it. */
function TextEditor({ el, view, paperKey, onDone }) {
  const ref = useRef(null);
  const [text, setText] = useState(el.text || '');
  const done = useRef(false);
  const finish = () => { if (done.current) return; done.current = true; onDone(text); };
  useEffect(() => {
    const focus = () => { const t = ref.current; if (!t) return; t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); };
    focus();
    const id = setTimeout(focus, 0); // after the tap that created it has finished
    return () => clearTimeout(id);
  }, []);
  const z = view.zoom;
  const left = (el.x - view.x) * z, top = (el.y - view.y) * z;
  let style;
  if (el.type === 'sticky') {
    const { h, pad } = stickyLayout({ ...el, text });
    style = { left, top, width: el.w * z, height: h * z, padding: pad * z, fontSize: 15 * z, background: el.color, color: '#1f2330', borderRadius: 6 * z };
  } else {
    const s = textSize({ ...el, text: text || ' ' });
    style = { left, top, width: Math.max(160, s.w + 40) * z, height: (s.h + el.fontSize * 0.4) * z, fontSize: el.fontSize * z, color: inkColor(el.color, paperKey), background: 'transparent' };
  }
  return (
    <textarea ref={ref} className={`fd-text-editor ${el.type}`} value={text} style={style} spellCheck
      placeholder={el.type === 'sticky' ? 'Write a note…' : 'Type…'}
      onChange={e => setText(e.target.value)} onBlur={finish}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); finish(); } }} />
  );
}
