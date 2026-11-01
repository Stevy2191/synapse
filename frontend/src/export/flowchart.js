// A Flowchart note (the built-in box-and-arrow editor) as a static SVG picture, for export.
// Mirrors the shapes drawn by components/editor/DiagramEditor.jsx, in print-friendly colours.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = 'Inter, Segoe UI, system-ui, sans-serif';

function shape(n) {
  const { type, w, h } = n;
  const fill = esc(n.color || '#6366f1');
  const st = `fill="${fill}" stroke="rgba(0,0,0,0.15)" stroke-width="1.5"`;
  switch (type) {
    case 'diamond': return `<polygon points="${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}" ${st}/>`;
    case 'oval': return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 2}" ry="${h / 2 - 2}" ${st}/>`;
    case 'cylinder': return `<rect x="2" y="10" width="${w - 4}" height="${h - 14}" ${st}/><ellipse cx="${w / 2}" cy="10" rx="${w / 2 - 2}" ry="8" ${st}/><ellipse cx="${w / 2}" cy="${h - 4}" rx="${w / 2 - 2}" ry="8" ${st}/>`;
    case 'text': return '';
    default: return `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="6" ${st}/>`;
  }
}

export function flowchartSvg(canvasData) {
  let data = {};
  try { data = JSON.parse(canvasData || '{}') || {}; } catch { data = {}; }
  const nodes = Array.isArray(data.nodes) ? data.nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)) : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  if (!nodes.length) return null;
  const pad = 24;
  const x1 = Math.min(...nodes.map(n => n.x)) - pad, y1 = Math.min(...nodes.map(n => n.y)) - pad;
  const x2 = Math.max(...nodes.map(n => n.x + (n.w || 0))) + pad, y2 = Math.max(...nodes.map(n => n.y + (n.h || 0))) + pad;
  const parts = [];
  for (const e of edges) {
    const s = nodes.find(n => n.id === e.source), t = nodes.find(n => n.id === e.target);
    if (!s || !t) continue;
    const ax = s.x + s.w, ay = s.y + s.h / 2, bx = t.x, by = t.y + t.h / 2, mx = (ax + bx) / 2;
    parts.push(`<path d="M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}" stroke="#64748b" stroke-width="1.5" fill="none" marker-end="url(#arrow)"/>`);
    if (e.label) parts.push(`<text x="${mx}" y="${(ay + by) / 2 - 8}" text-anchor="middle" fill="#475569" font-size="11" font-family="${FONT}">${esc(e.label)}</text>`);
  }
  for (const n of nodes) {
    const color = n.type === 'text' ? '#1f2330' : esc(n.textColor || '#fff');
    parts.push(`<g transform="translate(${n.x},${n.y})">${shape(n)}<text x="${n.w / 2}" y="${n.h / 2}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="13" font-weight="500" font-family="${FONT}">${esc(n.label)}</text></g>`);
  }
  const w = x2 - x1, h = y2 - y1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x1} ${y1} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">` +
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#64748b"/></marker></defs>` +
    `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="#fff"/>${parts.join('')}</svg>`;
}
