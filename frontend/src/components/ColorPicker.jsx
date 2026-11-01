// The one colour picker used everywhere: a swatch that opens a panel with a colour square and
// hue slider, a hex box, RGB / HSL numbers, an eyedropper (where the browser has one), the
// usual colours and the ones you used recently.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { Pipette, Plus } from 'lucide-react';

// "#7C7BFF", "7c7bff", "#abc" or "abc" → "#7c7bff" / "#aabbcc"; anything else → null
export function normalizeHex(input) {
  const v = String(input || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) return '#' + v.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(v)) return '#' + v;
  return null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex) {
  const h = normalizeHex(hex) || '#000000';
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v) || 0, 0, 255).toString(16).padStart(2, '0')).join('');
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const RECENT_KEY = 'synapse.recentColors';
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(normalizeHex).slice(0, 10); } catch { return []; }
}
function rememberColor(hex) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...loadRecent().filter(c => c !== hex)].slice(0, 10))); } catch { /* ignore */ }
}

const PANEL_W = 252;

function Panel({ initial, presets, onApply, onCancel, anchorRef, inline }) {
  const [color, setColor] = useState(normalizeHex(initial) || '#7c7bff');
  const [hexText, setHexText] = useState(color.slice(1));
  const [mode, setMode] = useState('rgb');
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const recent = useRef(loadRecent()).current;

  // Keep the hex box in step with the square, the slider and the numbers.
  const set = hex => { setColor(hex); setHexText(hex.slice(1)); };

  useLayoutEffect(() => {
    if (inline) return;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      const h = ref.current?.offsetHeight || 400;
      if (!r) return;
      const left = clamp(r.left, 8, window.innerWidth - PANEL_W - 8);
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : clamp(below, 8, Math.max(8, window.innerHeight - h - 8));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [inline, anchorRef]);

  useEffect(() => {
    const away = e => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onCancel();
    };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [onCancel, anchorRef]);

  const apply = hex => { rememberColor(hex); onApply(hex); };
  const typedHex = normalizeHex(hexText);

  const rgb = hexToRgb(color);
  const nums = mode === 'rgb' ? rgb : rgbToHsl(rgb);
  const labels = mode === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'L'];
  const maxes = mode === 'rgb' ? [255, 255, 255] : [360, 100, 100];
  const setNum = (i, v) => {
    const next = [...nums]; next[i] = clamp(Number(v) || 0, 0, maxes[i]);
    set(rgbToHex(mode === 'rgb' ? next : hslToRgb(next)));
  };

  const eyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pick = async () => {
    try { const { sRGBHex } = await new window.EyeDropper().open(); const h = normalizeHex(sRGBHex) || (sRGBHex.startsWith('rgb') ? rgbToHex(sRGBHex.match(/\d+/g).map(Number)) : null); if (h) set(h); } catch { /* cancelled */ }
  };

  const Swatches = ({ list, label }) => list.length > 0 && (
    <div className="cp-swatches">
      <div className="cp-label">{label}</div>
      <div className="cp-swatch-row">
        {list.map(c => (
          <button key={c} type="button" title={c} className={`cp-swatch${c === color ? ' on' : ''}`} style={{ background: c }}
            onClick={() => set(c)} onDoubleClick={() => apply(c)} />
        ))}
      </div>
    </div>
  );

  const panel = (
    <div ref={ref} className={`color-popover${inline ? ' inline' : ''}`} role="dialog" aria-label="Choose a colour"
      style={inline ? undefined : { position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseDown={e => { if (!['INPUT'].includes(e.target.tagName)) e.preventDefault(); }}>
      <HexColorPicker color={color} onChange={c => set(normalizeHex(c) || color)} />
      <div className="cp-row">
        <span className="cp-preview" style={{ background: color }} />
        <div className={`cp-hex${hexText && !typedHex ? ' bad' : ''}`}>
          <span>#</span>
          <input value={hexText} maxLength={7} spellCheck={false} aria-label="Hex colour code"
            onChange={e => { const t = e.target.value.replace(/^#/, ''); setHexText(t); const h = normalizeHex(t); if (h) setColor(h); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (typedHex) apply(typedHex); } }} />
        </div>
        {eyedropper && <button type="button" className="cp-icon" title="Pick a colour from the screen" onClick={pick}><Pipette size={14} /></button>}
      </div>
      <div className="cp-row">
        <button type="button" className="cp-mode" onClick={() => setMode(m => (m === 'rgb' ? 'hsl' : 'rgb'))} title="Switch between RGB and HSL">
          {mode.toUpperCase()}
        </button>
        {labels.map((l, i) => (
          <label key={l} className="cp-num">
            <input type="number" min={0} max={maxes[i]} value={nums[i]} onChange={e => setNum(i, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(color); } }} />
            <span>{l}</span>
          </label>
        ))}
      </div>
      <Swatches list={presets.filter(Boolean)} label="Colours" />
      <Swatches list={recent} label="Recent" />
      <div className="cp-actions">
        <button type="button" className="cp-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="cp-btn primary" onClick={() => apply(color)}>Apply</button>
      </div>
    </div>
  );
  return inline ? panel : createPortal(panel, document.body);
}

/**
 * A swatch that opens the colour panel. Shows the current colour when it isn't one of the
 * presets (so a custom colour is visible), otherwise a rainbow "+".
 *  value, onChange(hex), presets: colours shown in the panel, size, shape: 'circle' | 'square',
 *  inline: render the panel in place instead of on top of the page (for floating toolbars).
 */
export default function ColorPicker({ value, onChange, presets = [], size = 22, shape = 'circle', title = 'More colours…', inline = false, className = '', icon = null }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const hex = normalizeHex(value);
  const custom = hex && !presets.map(normalizeHex).includes(hex);
  return (
    <span className={`cp-anchor ${className}`} style={{ position: 'relative', display: 'inline-flex' }}>
      {icon ? (
        <button ref={btn} type="button" title={title} aria-label={title} aria-expanded={open} className={`btn-ghost cp-icon-trigger${open ? ' on' : ''}`}
          onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}>
          {icon}<span className="cp-icon-bar" style={{ background: hex || 'var(--text-muted)' }} />
        </button>
      ) : (
      <button ref={btn} type="button" title={title} aria-label={title} aria-expanded={open}
        className={`cp-trigger${custom ? ' custom' : ''}`}
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        style={{ width: size, height: size, borderRadius: shape === 'circle' ? '50%' : Math.round(size / 4.5), background: custom ? hex : undefined }}>
        {!custom && <Plus size={Math.max(10, Math.round(size * 0.55))} strokeWidth={3} />}
      </button>
      )}
      {open && (
        <Panel initial={hex || presets.find(Boolean) || '#7c7bff'} presets={presets} anchorRef={btn} inline={inline}
          onCancel={() => setOpen(false)} onApply={h => { setOpen(false); onChange(h); }} />
      )}
    </span>
  );
}
