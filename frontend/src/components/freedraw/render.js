// Drawing a Free Draw document on a canvas, and exporting it as PNG / SVG.
import { getStroke } from 'perfect-freehand';
import { bounds, unionBounds, textSize, stickyLayout, fontFor, STICKY_FONT, LINE_H } from './model';

export const PAPER = {
  light: { bg: '#fbfaf7', ink: '#1f2330', pattern: 'rgba(60, 70, 110, 0.13)' },
  dark: { bg: '#15161f', ink: '#e8e8f0', pattern: 'rgba(200, 205, 255, 0.10)' },
};
export const GRID = 32; // world units between lines / grid cells / dots

export function resolvePaper(paper, appIsLight) {
  return paper === 'light' || paper === 'dark' ? paper : appIsLight ? 'light' : 'dark';
}
export const inkColor = (color, paperKey) => (!color || color === 'ink' ? PAPER[paperKey].ink : color);

// ── Pressure ink (perfect-freehand) ──
function strokeOptions(el) {
  const base = { size: el.size, smoothing: 0.5, streamline: 0.45, last: true };
  if (el.tool === 'pen' && !el.flat) return { ...base, thinning: el.pen ? 0.65 : 0.5, simulatePressure: !el.pen };
  if (el.tool === 'highlighter') return { ...base, thinning: 0, simulatePressure: false, start: { cap: false }, end: { cap: false } };
  return { ...base, thinning: 0, simulatePressure: false };
}

function outlinePath(outline) {
  if (!outline.length) return '';
  const d = outline.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
    return acc;
  }, ['M', ...outline[0].map(n => n.toFixed(2)), 'Q']);
  d.push('Z');
  return d.join(' ');
}

const pathCache = new WeakMap(); // element object → { d, path }
export function strokePath(el) {
  let c = pathCache.get(el);
  if (!c) {
    const d = outlinePath(getStroke(el.points, strokeOptions(el)));
    c = { d, path: new Path2D(d) };
    pathCache.set(el, c);
  }
  return c;
}

const boundsCache = new WeakMap();
function cachedBounds(el) {
  let b = boundsCache.get(el);
  if (!b) { b = bounds(el); boundsCache.set(el, b); }
  return b;
}

// ── Images ──
const imageCache = new Map(); // src → HTMLImageElement
export function getImage(src, onLoad) {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onLoad?.();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function arrowHead(el) {
  const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
  const len = Math.max(12, el.size * 4);
  return [
    [el.x2 - len * Math.cos(ang - Math.PI / 7), el.y2 - len * Math.sin(ang - Math.PI / 7)],
    [el.x2 - len * Math.cos(ang + Math.PI / 7), el.y2 - len * Math.sin(ang + Math.PI / 7)],
  ];
}

/** Draw one element in world coordinates (the context is already transformed). */
export function drawElement(ctx, el, paperKey, onImageLoad) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  switch (el.type) {
    case 'stroke': {
      if (el.tool === 'erase') { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; }
      else ctx.fillStyle = inkColor(el.color, paperKey);
      if (el.tool === 'highlighter') {
        // Like a real highlighter: darkens on light paper, glows on dark paper.
        ctx.globalAlpha = paperKey === 'dark' ? 0.5 : 0.45;
        ctx.globalCompositeOperation = paperKey === 'dark' ? 'screen' : 'multiply';
      }
      ctx.fill(strokePath(el).path);
      break;
    }
    case 'shape': {
      ctx.strokeStyle = inkColor(el.color, paperKey);
      ctx.lineWidth = el.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      const x1 = Math.min(el.x1, el.x2), y1 = Math.min(el.y1, el.y2), w = Math.abs(el.x2 - el.x1), h = Math.abs(el.y2 - el.y1);
      if (el.shape === 'rect') ctx.rect(x1, y1, w, h);
      else if (el.shape === 'ellipse') ctx.ellipse(x1 + w / 2, y1 + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2);
        if (el.shape === 'arrow') { const [a, b] = arrowHead(el); ctx.moveTo(a[0], a[1]); ctx.lineTo(el.x2, el.y2); ctx.lineTo(b[0], b[1]); }
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      const { lines } = textSize(el);
      ctx.fillStyle = inkColor(el.color, paperKey);
      ctx.font = fontFor(el.fontSize);
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, el.x, el.y + i * el.fontSize * LINE_H + el.fontSize * (LINE_H - 1) / 2));
      break;
    }
    case 'sticky': {
      const { lines, h, pad } = stickyLayout(el);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = el.color;
      roundRect(ctx, el.x, el.y, el.w, h, 6);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#1f2330';
      ctx.font = fontFor(STICKY_FONT);
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, el.x + pad, el.y + pad + i * STICKY_FONT * LINE_H));
      break;
    }
    case 'image': {
      const img = getImage(el.src, onImageLoad);
      if (img) ctx.drawImage(img, el.x, el.y, el.w, el.h);
      else { ctx.fillStyle = 'rgba(127,127,127,0.15)'; ctx.fillRect(el.x, el.y, el.w, el.h); }
      break;
    }
    default:
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draw everything visible. view = { x, y, zoom } (the world point at the top-left, and the
 * zoom); the canvas is width × height CSS pixels at `dpr`.
 */
export function drawScene(ctx, elements, { view, dpr, width, height, paperKey, skip, onImageLoad }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, -view.x * view.zoom * dpr, -view.y * view.zoom * dpr);
  const vx2 = view.x + width / view.zoom, vy2 = view.y + height / view.zoom;
  for (const el of elements) {
    if (skip?.has(el.id)) continue;
    const b = cachedBounds(el);
    if (b.x2 < view.x || b.y2 < view.y || b.x1 > vx2 || b.y1 > vy2) continue;
    drawElement(ctx, el, paperKey, onImageLoad);
  }
}

/** CSS for the paper and its pattern, moving and scaling with the view. */
export function backgroundStyle(background, paperKey, view) {
  const p = PAPER[paperKey];
  const style = { backgroundColor: p.bg };
  const size = GRID * view.zoom;
  if (background === 'blank' || size < 6) return style;
  const ox = -view.x * view.zoom, oy = -view.y * view.zoom;
  if (background === 'lines') {
    style.backgroundImage = `linear-gradient(to bottom, ${p.pattern} 1px, transparent 1px)`;
    style.backgroundSize = `100% ${size}px`;
    style.backgroundPosition = `0 ${oy}px`;
  } else if (background === 'grid') {
    style.backgroundImage = `linear-gradient(to bottom, ${p.pattern} 1px, transparent 1px), linear-gradient(to right, ${p.pattern} 1px, transparent 1px)`;
    style.backgroundSize = `${size}px ${size}px`;
    style.backgroundPosition = `${ox}px ${oy}px`;
  } else if (background === 'dots') {
    const r = Math.max(1, Math.min(2, 1.4 * view.zoom));
    style.backgroundImage = `radial-gradient(circle, ${p.pattern.replace(/[\d.]+\)$/, '0.45)')} ${r}px, transparent ${r + 0.6}px)`;
    style.backgroundSize = `${size}px ${size}px`;
    style.backgroundPosition = `${ox - size / 2}px ${oy - size / 2}px`;
  }
  return style;
}

function drawPattern(ctx, background, paperKey, x1, y1, x2, y2) {
  const color = PAPER[paperKey].pattern;
  if (background === 'blank') return;
  ctx.save();
  if (background === 'dots') {
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.45)');
    for (let y = Math.ceil(y1 / GRID) * GRID; y < y2; y += GRID) for (let x = Math.ceil(x1 / GRID) * GRID; x < x2; x += GRID) {
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = Math.ceil(y1 / GRID) * GRID; y < y2; y += GRID) { ctx.moveTo(x1, y + 0.5); ctx.lineTo(x2, y + 0.5); }
    if (background === 'grid') for (let x = Math.ceil(x1 / GRID) * GRID; x < x2; x += GRID) { ctx.moveTo(x + 0.5, y1); ctx.lineTo(x + 0.5, y2); }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The drawing as an image. `maxSide` limits the size (for previews); `transparent` leaves out
 * the paper. Returns a canvas, or null when there's nothing to draw.
 */
export function renderToCanvas(doc, { paperKey, scale = 2, padding = 32, maxSide = 0, transparent = false, onImageLoad } = {}) {
  const b = unionBounds(doc.elements);
  if (!b) return null;
  const x1 = b.x1 - padding, y1 = b.y1 - padding, w = b.x2 - b.x1 + padding * 2, h = b.y2 - b.y1 + padding * 2;
  let s = scale;
  if (maxSide) s = Math.min(s, maxSide / Math.max(w, h));
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  const ink = document.createElement('canvas');
  ink.width = W; ink.height = H;
  const ic = ink.getContext('2d');
  ic.setTransform(s, 0, 0, s, -x1 * s, -y1 * s);
  for (const el of doc.elements) drawElement(ic, el, paperKey, onImageLoad);
  if (transparent) return ink;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const oc = out.getContext('2d');
  oc.fillStyle = PAPER[paperKey].bg;
  oc.fillRect(0, 0, W, H);
  oc.setTransform(s, 0, 0, s, -x1 * s, -y1 * s);
  drawPattern(oc, doc.background, paperKey, x1, y1, x1 + w, y1 + h);
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.drawImage(ink, 0, 0);
  return out;
}

/** A small picture for showing the drawing inside other notes. */
export function previewDataUrl(doc, paperKey) {
  const c = renderToCanvas(doc, { paperKey, scale: 1.5, padding: 24, maxSide: 1400 });
  if (!c) return null;
  const webp = c.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The drawing as an SVG document (vector ink; pixel-eraser marks become a mask). */
export function toSvg(doc, paperKey) {
  const b = unionBounds(doc.elements);
  if (!b) return null;
  const pad = 32, x = b.x1 - pad, y = b.y1 - pad, w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2;
  const parts = [];
  // Each eraser stroke hides what was drawn before it.
  let group = [];
  const flush = (maskId) => { if (group.length) parts.push(maskId ? `<g mask="url(#${maskId})">${group.join('')}</g>` : group.join('')); group = []; };
  const masks = [];
  let ei = 0;
  for (const el of doc.elements) {
    if (el.type === 'stroke' && el.tool === 'erase') {
      const id = `erase${ei++}`;
      masks.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff"/><path d="${strokePath(el).d}" fill="#000"/></mask>`);
      const prev = [...parts.splice(0), ...group];
      group = [];
      parts.push(`<g mask="url(#${id})">${prev.join('')}</g>`);
      continue;
    }
    const color = escXml(inkColor(el.color, paperKey));
    if (el.type === 'stroke') {
      group.push(`<path d="${strokePath(el).d}" fill="${color}"${el.tool === 'highlighter' ? ' fill-opacity="0.35"' : ''}/>`);
    } else if (el.type === 'shape') {
      const sx1 = Math.min(el.x1, el.x2), sy1 = Math.min(el.y1, el.y2), sw = Math.abs(el.x2 - el.x1), sh = Math.abs(el.y2 - el.y1);
      const st = `fill="none" stroke="${color}" stroke-width="${el.size}" stroke-linecap="round" stroke-linejoin="round"`;
      if (el.shape === 'rect') group.push(`<rect x="${sx1}" y="${sy1}" width="${sw}" height="${sh}" ${st}/>`);
      else if (el.shape === 'ellipse') group.push(`<ellipse cx="${sx1 + sw / 2}" cy="${sy1 + sh / 2}" rx="${sw / 2}" ry="${sh / 2}" ${st}/>`);
      else {
        let d = `M${el.x1} ${el.y1} L${el.x2} ${el.y2}`;
        if (el.shape === 'arrow') { const [a, c] = arrowHead(el); d += ` M${a[0]} ${a[1]} L${el.x2} ${el.y2} L${c[0]} ${c[1]}`; }
        group.push(`<path d="${d}" ${st}/>`);
      }
    } else if (el.type === 'text') {
      const { lines } = textSize(el);
      group.push(`<text font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="${el.fontSize}" fill="${color}">${lines.map((l, i) => `<tspan x="${el.x}" y="${el.y + i * el.fontSize * LINE_H + el.fontSize}">${escXml(l)}</tspan>`).join('')}</text>`);
    } else if (el.type === 'sticky') {
      const { lines, h: sh, pad: sp } = stickyLayout(el);
      group.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${sh}" rx="6" fill="${escXml(el.color)}"/>`);
      group.push(`<text font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="${STICKY_FONT}" fill="#1f2330">${lines.map((l, i) => `<tspan x="${el.x + sp}" y="${el.y + sp + i * STICKY_FONT * LINE_H + STICKY_FONT}">${escXml(l)}</tspan>`).join('')}</text>`);
    } else if (el.type === 'image') {
      group.push(`<image href="${escXml(el.src)}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" preserveAspectRatio="none"/>`);
    }
  }
  flush(null);
  const p = PAPER[paperKey];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">` +
    `<defs>${masks.join('')}</defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${p.bg}"/>${parts.join('')}</svg>`;
}
