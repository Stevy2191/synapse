import { useState, useRef, useEffect, useCallback } from 'react';
import { Pen, Eraser, StickyNote, Trash2, Download, Minus, Plus, Palette } from 'lucide-react';

const COLORS = ['#e8e8f0','#ef4444','#f97316','#f59e0b','#22c55e','#06b6d4','#6366f1','#a855f7','#ec4899'];
const STICKY_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#ddd6fe','#fce7f3','#fed7aa'];

export default function FreeDrawEditor({ canvasData, onChange }) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#e8e8f0');
  const [strokeSize, setStrokeSize] = useState(3);
  const [drawing, setDrawing] = useState(false);
  const [stickies, setStickies] = useState(() => {
    try { return JSON.parse(canvasData || '{}').stickies || []; } catch { return []; }
  });
  const [strokes, setStrokes] = useState(() => {
    try { return JSON.parse(canvasData || '{}').strokes || []; } catch { return []; }
  });
  const [editingSticky, setEditingSticky] = useState(null);
  const [draggingSticky, setDraggingSticky] = useState(null);
  const currentStroke = useRef(null);
  const saveTimer = useRef(null);

  // Draw all strokes on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.eraser) {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    });
  }, [strokes]);

  // Resize canvas to container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      // Redraw after resize
      setStrokes(s => [...s]);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  const saveData = useCallback((s, st) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange(JSON.stringify({ strokes: s, stickies: st }));
    }, 500);
  }, [onChange]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e) => {
    if (tool === 'sticky') {
      const pos = getPos(e);
      const newSticky = { id: Date.now().toString(), x: pos.x, y: pos.y, text: 'Click to edit', color: STICKY_COLORS[stickies.length % STICKY_COLORS.length] };
      const next = [...stickies, newSticky];
      setStickies(next);
      setEditingSticky(newSticky.id);
      saveData(strokes, next);
      return;
    }
    if (tool !== 'pen' && tool !== 'eraser') return;
    setDrawing(true);
    const pos = getPos(e);
    currentStroke.current = { color, size: strokeSize, eraser: tool === 'eraser', points: [pos] };
  };

  const onMouseMove = (e) => {
    if (!drawing || !currentStroke.current) return;
    const pos = getPos(e);
    currentStroke.current.points.push(pos);
    // Live draw
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pts = currentStroke.current.points;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = currentStroke.current.color;
    ctx.lineWidth = currentStroke.current.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = currentStroke.current.eraser ? 'destination-out' : 'source-over';
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const onMouseUp = () => {
    if (!drawing || !currentStroke.current) return;
    setDrawing(false);
    const next = [...strokes, currentStroke.current];
    setStrokes(next);
    currentStroke.current = null;
    saveData(next, stickies);
  };

  const clearCanvas = () => {
    if (!confirm('Clear all drawings?')) return;
    setStrokes([]);
    saveData([], stickies);
  };

  const undo = () => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    saveData(next, stickies);
  };

  const startDragSticky = (id, e) => {
    e.stopPropagation();
    const sticky = stickies.find(s => s.id === id);
    const offX = e.clientX - sticky.x;
    const offY = e.clientY - sticky.y;
    const onMove = (e) => {
      setStickies(prev => prev.map(s => s.id === id ? { ...s, x: e.clientX - offX, y: e.clientY - offY } : s));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setStickies(prev => { saveData(strokes, prev); return prev; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const deleteSticky = (id) => {
    const next = stickies.filter(s => s.id !== id);
    setStickies(next);
    saveData(strokes, next);
  };

  const updateStickyText = (id, text) => {
    const next = stickies.map(s => s.id === id ? { ...s, text } : s);
    setStickies(next);
    saveData(strokes, next);
  };

  const toolBtn = (t, icon, title) => (
    <button
      key={t}
      onClick={() => setTool(t)}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', border: 'none', borderRadius: 6,
        cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
        background: tool === t ? 'var(--accent)' : 'var(--bg-elevated)',
        color: tool === t ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s'
      }}
    >
      {icon}<span>{title}</span>
    </button>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        {toolBtn('pen', <Pen size={13}/>, 'Pen')}
        {toolBtn('eraser', <Eraser size={13}/>, 'Eraser')}
        {toolBtn('sticky', <StickyNote size={13}/>, 'Sticky')}

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* Stroke size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setStrokeSize(s => Math.max(1, s - 1))} style={iconBtn}><Minus size={12}/></button>
          <div style={{ width: strokeSize * 3 + 6, height: strokeSize * 3 + 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 16, textAlign: 'center' }}>{strokeSize}</span>
          <button onClick={() => setStrokeSize(s => Math.min(30, s + 1))} style={iconBtn}><Plus size={12}/></button>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {/* Colors */}
        {COLORS.map(c => (
          <div key={c} onClick={() => setColor(c)} style={{
            width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', flexShrink: 0,
            border: color === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
            boxShadow: color === c ? '0 0 0 2px var(--accent)' : 'none'
          }} />
        ))}

        <div style={{ flex: 1 }} />

        <button onClick={undo} disabled={strokes.length === 0} style={{ ...iconBtn, fontSize: 12, padding: '4px 8px', gap: 4 }} title="Undo last stroke">
          ↩ Undo
        </button>
        <button onClick={clearCanvas} style={{ ...iconBtn, color: 'var(--danger)', fontSize: 12, padding: '4px 8px' }} title="Clear canvas">
          <Trash2 size={13}/> Clear
        </button>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-base)', cursor: tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'copy' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ position: 'absolute', inset: 0 }}
        />

        {/* Sticky notes overlay */}
        {stickies.map(sticky => (
          <div
            key={sticky.id}
            style={{
              position: 'absolute', left: sticky.x, top: sticky.y,
              width: 180, minHeight: 120, background: sticky.color,
              borderRadius: 4, padding: 8, boxShadow: '2px 4px 12px rgba(0,0,0,0.3)',
              cursor: 'move', userSelect: 'none', zIndex: 10,
              fontFamily: 'var(--font-sans)', fontSize: 13, color: '#1a1a2e'
            }}
            onMouseDown={e => startDragSticky(sticky.id, e)}
            onDoubleClick={e => { e.stopPropagation(); setEditingSticky(sticky.id); }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button
                onClick={e => { e.stopPropagation(); deleteSticky(sticky.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: 'rgba(0,0,0,0.4)', padding: 0 }}
              >×</button>
            </div>
            {editingSticky === sticky.id ? (
              <textarea
                autoFocus
                value={sticky.text}
                onChange={e => updateStickyText(sticky.id, e.target.value)}
                onBlur={() => setEditingSticky(null)}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  width: '100%', minHeight: 80, background: 'transparent', border: 'none', outline: 'none',
                  resize: 'none', fontFamily: 'var(--font-sans)', fontSize: 13, color: '#1a1a2e', lineHeight: 1.5
                }}
              />
            ) : (
              <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{sticky.text}</p>
            )}
            {/* Sticky color swatches */}
            {editingSticky === sticky.id && (
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }} onMouseDown={e => e.stopPropagation()}>
                {STICKY_COLORS.map(c => (
                  <div key={c} onClick={() => { const next = stickies.map(s => s.id === sticky.id ? { ...s, color: c } : s); setStickies(next); saveData(strokes, next); }}
                    style={{ width: 16, height: 16, borderRadius: 3, background: c, cursor: 'pointer', border: sticky.color === c ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)' }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {stickies.length === 0 && strokes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✏️</div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-secondary)' }}>Start drawing</p>
              <p style={{ fontSize: 13, marginTop: 4 }}>Pen to draw · Eraser to remove · Sticky for notes</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', border: 'none', borderRadius: 6,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
  fontFamily: 'var(--font-sans)', transition: 'all 0.15s'
};
