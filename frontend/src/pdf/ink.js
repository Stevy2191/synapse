// Pen markings on PDF pages.
//
// Stored in the PDF block (attribute `ink`, JSON) — never in the PDF file:
//   { "<page number>": [ { id, tool: 'pen'|'highlighter', color, size, pen, points: [[x, y, pressure], …] } ] }
// Coordinates are in "page units": the page is 1000 wide and 1000 × (height / width) tall, top-left origin,
// so markings stay in place at any zoom and on any screen.
import { strokePath } from '../components/freedraw/render';

export const PAGE_W = 1000;
export const INK_COLORS = ['#1f2330', '#dc2626', '#2563eb', '#16a34a', '#9333ea'];
export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
export const SIZES = { pen: [1.5, 2.5, 4.5], highlighter: [10, 16, 24] };

export function parseInk(s) {
  if (!s) return {};
  try {
    const d = typeof s === 'string' ? JSON.parse(s) : s;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const out = {};
    for (const [k, list] of Object.entries(d)) {
      if (!/^\d+$/.test(k) || !Array.isArray(list)) continue;
      const ok = list.filter(st => st && Array.isArray(st.points) && st.points.length && (st.tool === 'pen' || st.tool === 'highlighter'));
      if (ok.length) out[k] = ok;
    }
    return out;
  } catch { return {}; }
}

export const inkCount = ink => Object.values(ink).reduce((n, l) => n + l.length, 0);
export const serializeInk = ink => (inkCount(ink) ? JSON.stringify(ink) : '');

/** Round the points of a finished stroke so the note doesn't grow more than it needs to. */
export function tidyStroke(st) {
  const r = n => Math.round(n * 10) / 10;
  const pts = [];
  for (const [x, y, p] of st.points) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) < 0.3 && Math.abs(last[1] - y) < 0.3) continue;
    pts.push(st.pen ? [r(x), r(y), Math.round(p * 100) / 100] : [r(x), r(y)]);
  }
  return { ...st, points: pts.length ? pts : [st.points[0].slice(0, 2)] };
}

// perfect-freehand wants a pressure for every point.
const withPressure = st => (st.points[0]?.length === 3 ? st : { ...st, points: st.points.map(([x, y]) => [x, y, 0.5]) });
const cache = new WeakMap();
function outline(st) {
  let c = cache.get(st);
  if (!c) { c = strokePath(withPressure(st)); cache.set(st, c); }
  return c;
}

/** Draw a page's strokes. `scale` = canvas pixels per page unit. */
export function drawInk(ctx, strokes, scale) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const st of strokes || []) {
    ctx.globalAlpha = st.tool === 'highlighter' ? 0.42 : 1;
    ctx.globalCompositeOperation = st.tool === 'highlighter' ? 'multiply' : 'source-over';
    ctx.fillStyle = st.color;
    ctx.fill(outline(st).path);
  }
  ctx.restore();
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The strokes touched by an eraser at (x, y) with radius r (page units). */
export function hitStrokes(strokes, x, y, r) {
  return (strokes || []).filter(st => {
    const reach = r + st.size / 2;
    const p = st.points;
    if (p.length === 1) return Math.hypot(p[0][0] - x, p[0][1] - y) <= reach;
    for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= reach) return true;
    return false;
  });
}

const hexRgb = h => { const n = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/** A copy of the PDF with the markings drawn into it (for "Download with markings"). */
export async function bakeInk(bytes, ink) {
  const { PDFDocument, rgb, BlendMode } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [k, strokes] of Object.entries(ink)) {
    const page = pages[Number(k) - 1];
    if (!page) continue;
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const s = (rot === 90 || rot === 270 ? box.height : box.width) / PAGE_W;
    // page units (as seen on screen) → PDF user space, for each rotation pdf.js shows
    const map = ([dx, dy]) => {
      if (rot === 90) return [box.x + dy * s, box.y + dx * s];
      if (rot === 180) return [box.x + box.width - dx * s, box.y + dy * s];
      if (rot === 270) return [box.x + box.width - dy * s, box.y + box.height - dx * s];
      return [box.x + dx * s, box.y + box.height - dy * s];
    };
    for (const st of strokes) {
      const { getStroke } = await import('perfect-freehand');
      const poly = strokeOutline(getStroke, withPressure(st)).map(map);
      if (poly.length < 3) continue;
      // drawSvgPath flips y, so hand it -Y.
      const pts = poly.map(([x, y]) => [x, -y]);
      const f = n => n.toFixed(2);
      // Smooth like on screen: quadratic curves through the midpoints.
      const d = pts.reduce((acc, [x0, y0], i) => {
        const [x1, y1] = pts[(i + 1) % pts.length];
        return `${acc} ${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`;
      }, `M ${f(pts[0][0])} ${f(pts[0][1])} Q`) + ' Z';
      const [r, g, b] = hexRgb(st.color);
      page.drawSvgPath(d, {
        x: 0, y: 0, color: rgb(r, g, b), borderWidth: 0,
        ...(st.tool === 'highlighter' ? { opacity: 0.42, blendMode: BlendMode.Multiply } : {}),
      });
    }
  }
  return doc.save();
}

// Same shape as on screen (freedraw/render.js strokeOptions).
function strokeOutline(getStroke, st) {
  const base = { size: st.size, smoothing: 0.5, streamline: 0.45, last: true };
  const opts = st.tool === 'highlighter'
    ? { ...base, thinning: 0, simulatePressure: false, start: { cap: false }, end: { cap: false } }
    : { ...base, thinning: st.pen ? 0.65 : 0.5, simulatePressure: !st.pen };
  return getStroke(st.points, opts);
}

/** A page picture with its markings, as a PNG data URL (export, previews). */
export async function pagePicture(pdf, pageNo, strokes, width = 900) {
  const { renderPage } = await import('./pdfjs');
  const { canvas } = await renderPage(pdf, pageNo, width, 1);
  if (strokes?.length) drawInk(canvas.getContext('2d'), strokes, canvas.width / PAGE_W);
  return canvas.toDataURL('image/png');
}
