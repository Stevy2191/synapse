import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Trash2, Download, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

const SHAPES = [
  { type: 'rect',    label: 'Box',      icon: '▭' },
  { type: 'diamond', label: 'Decision', icon: '◇' },
  { type: 'oval',    label: 'Oval',     icon: '⬭' },
  { type: 'cylinder',label: 'Database', icon: '⊏' },
  { type: 'text',    label: 'Text',     icon: 'T' },
];

const COLORS = ['#6366f1','#22c55e','#ef4444','#f59e0b','#06b6d4','#a855f7','#ec4899','#64748b'];

function NodeShape({ node, selected, onSelect, onStartConnect, onDragNode }) {
  const { type, x, y, w, h, label, color, textColor } = node;
  const fill = color || '#6366f1';
  const tc = textColor || '#fff';

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(node.id);
    onDragNode(node.id, e);
  };

  const renderShape = () => {
    const sw = selected ? 2.5 : 1.5;
    const sc = selected ? '#fff' : 'rgba(255,255,255,0.3)';
    switch (type) {
      case 'diamond':
        const cx = w / 2, cy = h / 2;
        return <polygon points={`${cx},2 ${w-2},${cy} ${cx},${h-2} 2,${cy}`} fill={fill} stroke={sc} strokeWidth={sw} />;
      case 'oval':
        return <ellipse cx={w/2} cy={h/2} rx={w/2-2} ry={h/2-2} fill={fill} stroke={sc} strokeWidth={sw} />;
      case 'cylinder':
        return (
          <g>
            <rect x={2} y={10} width={w-4} height={h-14} fill={fill} stroke={sc} strokeWidth={sw} />
            <ellipse cx={w/2} cy={10} rx={w/2-2} ry={8} fill={fill} stroke={sc} strokeWidth={sw} />
            <ellipse cx={w/2} cy={h-4} rx={w/2-2} ry={8} fill={fill} stroke={sc} strokeWidth={sw} />
          </g>
        );
      case 'text':
        return <rect x={0} y={0} width={w} height={h} fill="transparent" stroke={selected ? 'var(--accent)' : 'transparent'} strokeWidth={sw} strokeDasharray="4" />;
      default:
        return <rect x={2} y={2} width={w-4} height={h-4} rx={6} fill={fill} stroke={sc} strokeWidth={sw} />;
    }
  };

  return (
    <g transform={`translate(${x},${y})`} onMouseDown={handleMouseDown} style={{ cursor: 'move', userSelect: 'none' }}>
      {renderShape()}
      <text
        x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle"
        fill={type === 'text' ? 'var(--text-primary)' : tc}
        fontSize={13} fontFamily="var(--font-sans)" fontWeight={500}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      {/* Connect handle */}
      <circle
        cx={w} cy={h / 2} r={6} fill="var(--accent)" stroke="#fff" strokeWidth={1.5}
        style={{ cursor: 'crosshair', opacity: selected ? 1 : 0, transition: 'opacity 0.15s' }}
        onMouseDown={e => { e.stopPropagation(); onStartConnect(node.id, e); }}
      />
      <circle
        cx={w / 2} cy={h} r={6} fill="var(--accent)" stroke="#fff" strokeWidth={1.5}
        style={{ cursor: 'crosshair', opacity: selected ? 1 : 0, transition: 'opacity 0.15s' }}
        onMouseDown={e => { e.stopPropagation(); onStartConnect(node.id, e); }}
      />
    </g>
  );
}

function Arrow({ edge, nodes, selected, onSelect }) {
  const src = nodes.find(n => n.id === edge.source);
  const tgt = nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return null;
  const x1 = src.x + src.w, y1 = src.y + src.h / 2;
  const x2 = tgt.x, y2 = tgt.y + tgt.h / 2;
  const mx = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  return (
    <g onClick={() => onSelect(edge.id)} style={{ cursor: 'pointer' }}>
      <path d={d} stroke="transparent" strokeWidth={10} fill="none" />
      <path d={d} stroke={selected ? 'var(--accent-hover)' : 'var(--text-muted)'} strokeWidth={selected ? 2 : 1.5} fill="none" markerEnd="url(#arrow)" />
      {edge.label && (
        <text x={mx} y={(y1+y2)/2 - 8} textAnchor="middle" fill="var(--text-secondary)" fontSize={11} fontFamily="var(--font-sans)">{edge.label}</text>
      )}
    </g>
  );
}

export default function DiagramEditor({ canvasData, onChange }) {
  const svgRef = useRef(null);
  const [nodes, setNodes] = useState(() => {
    try { return JSON.parse(canvasData || '{}').nodes || []; } catch { return []; }
  });
  const [edges, setEdges] = useState(() => {
    try { return JSON.parse(canvasData || '{}').edges || []; } catch { return []; }
  });
  const [selected, setSelected] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [connectLine, setConnectLine] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const [editingNode, setEditingNode] = useState(null);
  const [editText, setEditText] = useState('');
  const [selectedColor, setSelectedColor] = useState('#6366f1');
  const saveTimer = useRef(null);

  const save = useCallback((n, e) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange(JSON.stringify({ nodes: n, edges: e }));
    }, 500);
  }, [onChange]);

  const addNode = (type) => {
    const id = Date.now().toString();
    const newNode = { id, type, x: 120 + nodes.length * 20, y: 100 + nodes.length * 20, w: 140, h: 60, label: type === 'text' ? 'Label' : 'New Node', color: selectedColor };
    const next = [...nodes, newNode];
    setNodes(next);
    setSelected(id);
    save(next, edges);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const nextNodes = nodes.filter(n => n.id !== selected);
    const nextEdges = edges.filter(e => e.id !== selected && e.source !== selected && e.target !== selected);
    setNodes(nextNodes); setEdges(nextEdges); setSelected(null);
    save(nextNodes, nextEdges);
  };

  const onDragNode = (id, startEvt) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    const getPos = (e) => {
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
    };
    const node = nodes.find(n => n.id === id);
    const startPos = getPos(startEvt);
    const ox = node.x - startPos.x, oy = node.y - startPos.y;
    const onMove = (e) => {
      const p = getPos(e);
      setNodes(prev => {
        const next = prev.map(n => n.id === id ? { ...n, x: p.x + ox, y: p.y + oy } : n);
        save(next, edges);
        return next;
      });
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onStartConnect = (sourceId, e) => {
    e.stopPropagation();
    setConnecting(sourceId);
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    const getPos = (ev) => {
      pt.x = ev.clientX; pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
    };
    const src = nodes.find(n => n.id === sourceId);
    const onMove = (ev) => { const p = getPos(ev); setConnectLine({ x1: src.x + src.w, y1: src.y + src.h/2, x2: p.x, y2: p.y }); };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const p = getPos(ev);
      const target = nodes.find(n => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h && n.id !== sourceId);
      if (target) {
        const newEdge = { id: Date.now().toString(), source: sourceId, target: target.id, label: '' };
        const next = [...edges, newEdge];
        setEdges(next);
        save(nodes, next);
      }
      setConnecting(null); setConnectLine(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onSvgMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    } else if (e.target === svgRef.current || e.target.tagName === 'svg') {
      setSelected(null);
    }
  };

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e) => setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    const onUp = () => setIsPanning(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isPanning]);

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => Math.max(0.2, Math.min(4, z * factor)));
  };

  const selectedNode = nodes.find(n => n.id === selected);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Diagram toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginRight: 4 }}>Insert</span>
        {SHAPES.map(s => (
          <button key={s.type} onClick={() => addNode(s.type)} style={toolBtn} title={s.label}>
            <span style={{ fontSize: 14, marginRight: 4 }}>{s.icon}</span>{s.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginRight: 4 }}>Color</span>
        {COLORS.map(c => (
          <div key={c} onClick={() => { setSelectedColor(c); if (selectedNode) { const next = nodes.map(n => n.id === selected ? { ...n, color: c } : n); setNodes(next); save(next, edges); } }}
            style={{ width: 18, height: 18, borderRadius: 4, background: c, cursor: 'pointer', border: selectedColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }}
          />
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={deleteSelected} disabled={!selected} style={{ ...toolBtn, color: selected ? 'var(--danger)' : 'var(--text-muted)' }} title="Delete selected">
          <Trash2 size={13} />
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setZoom(z => Math.min(4, z * 1.2))} style={toolBtn}><ZoomIn size={13}/></button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(0.2, z / 1.2))} style={toolBtn}><ZoomOut size={13}/></button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={toolBtn} title="Reset view"><Maximize2 size={13}/></button>
      </div>

      {/* Node label editor */}
      {editingNode && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 500, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const next = nodes.map(n => n.id === editingNode ? { ...n, label: editText } : n);
                setNodes(next); save(next, edges);
                setEditingNode(null);
              }
              if (e.key === 'Escape') setEditingNode(null);
            }}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: 220 }}
          />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Enter to confirm · Esc to cancel</p>
        </div>
      )}

      {/* Canvas */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isPanning ? 'grabbing' : 'default' }}>
        {nodes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-secondary)' }}>Click a shape above to start</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>Drag nodes · Click handles to connect · Double-click to rename</p>
            </div>
          </div>
        )}
        <svg
          ref={svgRef}
          style={{ width: '100%', height: '100%' }}
          onMouseDown={onSvgMouseDown}
          onWheel={onWheel}
          onDoubleClick={e => {
            const svg = svgRef.current;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const p = pt.matrixTransform(svg.getScreenCTM().inverse());
            const rx = (p.x - pan.x) / zoom, ry = (p.y - pan.y) / zoom;
            const hit = nodes.find(n => rx >= n.x && rx <= n.x + n.w && ry >= n.y && ry <= n.y + n.h);
            if (hit) { setEditingNode(hit.id); setEditText(hit.label); }
          }}
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--text-muted)" />
            </marker>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse" x={pan.x % 20} y={pan.y % 20}>
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {edges.map(e => <Arrow key={e.id} edge={e} nodes={nodes} selected={selected === e.id} onSelect={setSelected} />)}
            {connectLine && <line x1={connectLine.x1} y1={connectLine.y1} x2={connectLine.x2} y2={connectLine.y2} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6" />}
            {nodes.map(n => (
              <NodeShape key={n.id} node={n} selected={selected === n.id} onSelect={setSelected} onStartConnect={onStartConnect} onDragNode={onDragNode} />
            ))}
          </g>
        </svg>
      </div>
      <div style={{ padding: '4px 12px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
        <span>Scroll to zoom · Alt+drag to pan · Drag handle to connect · Double-click to rename</span>
      </div>
    </div>
  );
}

const toolBtn = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, border: 'none',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
  fontFamily: 'var(--font-sans)', transition: 'all 0.15s'
};
