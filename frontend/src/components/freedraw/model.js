// Free Draw data model.
//
// canvas_data (version 2):
//   { v: 2, background: 'blank'|'lines'|'grid'|'dots', paper: 'auto'|'light'|'dark', preview?: dataURL, elements: [...] }
// Elements (world coordinates; y grows downwards):
//   { id, type: 'stroke', tool: 'pen'|'marker'|'highlighter'|'erase', color, size, pen: bool, points: [[x, y, pressure], …] }
//   { id, type: 'shape', shape: 'line'|'arrow'|'rect'|'ellipse', x1, y1, x2, y2, color, size }
//   { id, type: 'text', x, y, text, color, fontSize }
//   { id, type: 'sticky', x, y, w, text, color }
//   { id, type: 'image', x, y, w, h, src }
// A colour of 'ink' means "black on light paper, white on dark paper".

export const STICKY_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#fed7aa'];
export const STICKY_W = 200;
const STICKY_PAD = 14;
export const STICKY_FONT = 15;
export const LINE_H = 1.35;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Read canvas_data (any version) as a v2 document. */
export function load(canvasData) {
  let d = {};
  try { d = JSON.parse(canvasData || '{}') || {}; } catch { d = {}; }
  if (d.v === 2 && Array.isArray(d.elements)) {
    return { v: 2, background: d.background || 'blank', paper: d.paper || 'auto', elements: d.elements };
  }
  // Version 1: { strokes: [{ color, size, eraser, points: [{x,y}] }], stickies: [{ id, x, y, text, color }] }
  const elements = [];
  for (const s of d.strokes || []) {
    if (!s.points?.length) continue;
    elements.push({
      id: uid(), type: 'stroke', tool: s.eraser ? 'erase' : 'pen',
      // The old default pen colour was a light grey meant for dark mode; "ink" adapts to the paper.
      color: !s.color || s.color.toLowerCase() === '#e8e8f0' ? 'ink' : s.color,
      size: s.size || 3, pen: false, points: s.points.map(p => [p.x, p.y, 0.5]), flat: true,
    });
  }
  for (const s of d.stickies || []) {
    elements.push({ id: uid(), type: 'sticky', x: s.x, y: s.y, w: STICKY_W, text: s.text === 'Click to edit' ? '' : (s.text || ''), color: s.color || STICKY_COLORS[0] });
  }
  return { v: 2, background: 'blank', paper: 'auto', elements };
}

export function serialize(doc, preview) {
  return JSON.stringify({ v: 2, background: doc.background, paper: doc.paper, elements: doc.elements, ...(preview ? { preview } : {}) });
}

// ── Text measurement (needs a canvas context) ──
let measureCtx = null;
export function fontFor(size, bold = false) { return `${bold ? 600 : 400} ${size}px Inter, "Segoe UI", system-ui, sans-serif`; }
function ctx() { measureCtx ||= document.createElement('canvas').getContext('2d'); return measureCtx; }

/** Lines of a sticky's text, wrapped to its width. */
export function wrap(text, width, size) {
  const c = ctx(); c.font = fontFor(size);
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (c.measureText(next).width > width && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

export function textSize(el) {
  const c = ctx(); c.font = fontFor(el.fontSize);
  const lines = String(el.text || ' ').split('\n');
  return { w: Math.max(20, ...lines.map(l => c.measureText(l || ' ').width)), h: lines.length * el.fontSize * LINE_H, lines };
}

export function stickyLayout(el) {
  const lines = wrap(el.text || '', el.w - STICKY_PAD * 2, STICKY_FONT);
  const h = Math.max(140, lines.length * STICKY_FONT * LINE_H + STICKY_PAD * 2);
  return { lines, h, pad: STICKY_PAD };
}

// ── Bounds ──
export function bounds(el) {
  switch (el.type) {
    case 'stroke': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of el.points) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
      const r = el.size / 2 + 1;
      return { x1: x1 - r, y1: y1 - r, x2: x2 + r, y2: y2 + r };
    }
    case 'shape': {
      const r = el.size / 2 + (el.shape === 'arrow' ? el.size * 3 : 1);
      return { x1: Math.min(el.x1, el.x2) - r, y1: Math.min(el.y1, el.y2) - r, x2: Math.max(el.x1, el.x2) + r, y2: Math.max(el.y1, el.y2) + r };
    }
    case 'text': { const s = textSize(el); return { x1: el.x, y1: el.y, x2: el.x + s.w, y2: el.y + s.h }; }
    case 'sticky': { const { h } = stickyLayout(el); return { x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + h }; }
    case 'image': return { x1: el.x, y1: el.y, x2: el.x + el.w, y2: el.y + el.h };
    default: return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }
}

export function unionBounds(els) {
  let b = null;
  for (const el of els) {
    if (el.type === 'stroke' && el.tool === 'erase') continue;
    const e = bounds(el);
    b = b ? { x1: Math.min(b.x1, e.x1), y1: Math.min(b.y1, e.y1), x2: Math.max(b.x2, e.x2), y2: Math.max(b.y2, e.y2) } : e;
  }
  return b;
}

// ── Hit testing ──
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is the world point (x, y) within `r` of the element? */
export function hits(el, x, y, r) {
  const b = bounds(el);
  if (x < b.x1 - r || x > b.x2 + r || y < b.y1 - r || y > b.y2 + r) return false;
  switch (el.type) {
    case 'stroke': {
      if (el.tool === 'erase') return false;
      const p = el.points, rr = r + el.size / 2;
      if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= rr;
      for (let i = 1; i < p.length; i++) if (distToSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= rr) return true;
      return false;
    }
    case 'shape': {
      const rr = r + el.size / 2;
      if (el.shape === 'line' || el.shape === 'arrow') return distToSeg(x, y, el.x1, el.y1, el.x2, el.y2) <= rr;
      const x1 = Math.min(el.x1, el.x2), x2 = Math.max(el.x1, el.x2), y1 = Math.min(el.y1, el.y2), y2 = Math.max(el.y1, el.y2);
      if (el.shape === 'rect') {
        return [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]].some(s => distToSeg(x, y, ...s) <= rr);
      }
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2);
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= rr;
    }
    default: return true; // text, sticky, image: anywhere in the box
  }
}

/** Topmost element at a point. */
export function hitTop(elements, x, y, r) {
  for (let i = elements.length - 1; i >= 0; i--) if (hits(elements[i], x, y, r)) return elements[i];
  return null;
}

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Elements inside a lasso: strokes with most of their points inside, others by their centre. */
export function lassoSelect(elements, poly) {
  if (poly.length < 3) return [];
  return elements.filter(el => {
    if (el.type === 'stroke') {
      if (el.tool === 'erase') return false;
      const step = Math.max(1, Math.floor(el.points.length / 24));
      let n = 0, inside = 0;
      for (let i = 0; i < el.points.length; i += step) { n++; if (inPolygon(el.points[i][0], el.points[i][1], poly)) inside++; }
      return inside / n >= 0.6;
    }
    const b = bounds(el);
    return inPolygon((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, poly);
  }).map(el => el.id);
}

// ── Moving and scaling ──
export function translate(el, dx, dy) {
  switch (el.type) {
    case 'stroke': return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p]) };
    case 'shape': return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    default: return { ...el, x: el.x + dx, y: el.y + dy };
  }
}

/** Scale around (ox, oy) by s. */
export function scale(el, ox, oy, s) {
  const X = x => ox + (x - ox) * s, Y = y => oy + (y - oy) * s;
  switch (el.type) {
    case 'stroke': return { ...el, size: Math.max(0.5, el.size * s), points: el.points.map(([x, y, p]) => [X(x), Y(y), p]) };
    case 'shape': return { ...el, size: Math.max(0.5, el.size * s), x1: X(el.x1), y1: Y(el.y1), x2: X(el.x2), y2: Y(el.y2) };
    case 'text': return { ...el, x: X(el.x), y: Y(el.y), fontSize: Math.max(6, el.fontSize * s) };
    case 'sticky': return { ...el, x: X(el.x), y: Y(el.y), w: Math.max(120, el.w * s) };
    case 'image': return { ...el, x: X(el.x), y: Y(el.y), w: el.w * s, h: el.h * s };
    default: return el;
  }
}

// ── Shape snapping: hold the pen still at the end of a rough shape ──
export function recognize(points) {
  if (points.length < 6) return null;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
  const w = x2 - x1, h = y2 - y1, diag = Math.hypot(w, h);
  if (diag < 24) return null;
  const [sx, sy] = points[0], [ex, ey] = points[points.length - 1];
  const closed = Math.hypot(ex - sx, ey - sy) < diag * 0.25;
  if (!closed) {
    // A line if every point is close to the start–end segment
    const len = Math.hypot(ex - sx, ey - sy);
    if (len < diag * 0.8) return null;
    const maxDev = Math.max(...points.map(([x, y]) => distToSeg(x, y, sx, sy, ex, ey)));
    return maxDev < Math.max(8, len * 0.08) ? { shape: 'line', x1: sx, y1: sy, x2: ex, y2: ey } : null;
  }
  if (w < 12 || h < 12) return null;
  // Ellipse: points keep a steady normalised distance from the centre
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = w / 2, ry = h / 2;
  const radial = points.map(([x, y]) => Math.hypot((x - cx) / rx, (y - cy) / ry));
  const dev = radial.reduce((s, r) => s + Math.abs(r - 1), 0) / radial.length;
  // Rectangle: points hug the bounding box edges
  const edge = points.reduce((s, [x, y]) => s + Math.min(x - x1, x2 - x, y - y1, y2 - y) / Math.min(w, h), 0) / points.length;
  if (edge < 0.08 && dev > 0.12) return { shape: 'rect', x1, y1, x2, y2 };
  if (dev < 0.2) return { shape: 'ellipse', x1, y1, x2, y2 };
  if (edge < 0.12) return { shape: 'rect', x1, y1, x2, y2 };
  return null;
}
