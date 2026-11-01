// draw.io (diagrams.net) in a full-screen window, using its embed protocol:
//   draw.io → "init"        we → "load" the diagram
//   draw.io → "save"        we → ask for an "export" as SVG with the diagram embedded
//   draw.io → "export"      we keep that SVG (picture + editable diagram in one)
//   draw.io → "exit"        close without saving
// The diagram is edited in the browser; nothing is stored on diagrams.net.
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import { isLightTheme } from '../../themes';
import { useStore } from '../../stores/useStore';

let configPromise = null;
function drawioUrl() {
  configPromise ||= api.get('/config').then(r => r.data.drawio_url).catch(() => 'https://embed.diagrams.net');
  return configPromise;
}

/** The editable diagram XML inside a draw.io SVG (its "content" attribute). */
function diagramXml(svgDataUrl) {
  if (!svgDataUrl) return '';
  try {
    const [, meta, body] = svgDataUrl.match(/^data:image\/svg\+xml(;base64)?,(.*)$/s) || [];
    const text = meta ? decodeURIComponent(escape(atob(body))) : decodeURIComponent(body);
    return new DOMParser().parseFromString(text, 'image/svg+xml').documentElement.getAttribute('content') || '';
  } catch { return ''; }
}

export default function DrawioEditor({ preview, onSave, onClose }) {
  const frame = useRef(null);
  const [src, setSrc] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [failed, setFailed] = useState(false);
  const theme = useStore(s => s.user?.theme);

  useEffect(() => {
    drawioUrl().then(base => {
      const params = new URLSearchParams({
        embed: '1', proto: 'json', spin: '1', saveAndExit: '1', noSaveBtn: '1', libraries: '1',
        ui: isLightTheme(theme) ? 'kennedy' : 'dark', dark: isLightTheme(theme) ? '0' : '1',
        lang: (navigator.language || 'en').slice(0, 2),
      });
      setOrigin(new URL(base).origin);
      setSrc(`${base}/?${params}`);
    });
  }, []);

  // If draw.io hasn't said hello after a while, it probably can't be reached (offline, blocked…).
  useEffect(() => {
    if (!src) return;
    const t = setTimeout(() => setFailed(f => (f === false ? 'slow' : f)), 15000);
    return () => clearTimeout(t);
  }, [src]);

  useEffect(() => {
    if (!origin) return;
    const send = msg => frame.current?.contentWindow?.postMessage(JSON.stringify(msg), origin);
    const onMessage = (e) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.event === 'init') {
        setFailed(false);
        send({ action: 'load', xml: diagramXml(preview), autosave: 0, title: 'Diagram' });
      } else if (msg.event === 'save') {
        send({ action: 'export', format: 'xmlsvg', spinKey: 'saving' });
      } else if (msg.event === 'export') {
        if (typeof msg.data === 'string' && msg.data.startsWith('data:image/svg+xml')) {
          onSave({ preview: msg.data, scene: null });
        } else {
          toast.error('draw.io didn’t return the diagram. Please try again.');
        }
      } else if (msg.event === 'exit') {
        onClose();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, preview]);

  return (
    <div className="diagram-modal">
      {src && <iframe ref={frame} src={src} title="draw.io" className="diagram-frame" allow="clipboard-read; clipboard-write" />}
      {failed === 'slow' && (
        <div className="diagram-loading" style={{ pointerEvents: 'auto' }}>
          <p>draw.io is taking a long time to load.</p>
          <p style={{ fontSize: 12.5, opacity: 0.8, maxWidth: 420 }}>
            It loads from {origin}, so it needs an internet connection (unless your server runs its own copy).
          </p>
          <button className="btn-ghost on" onClick={onClose} style={{ marginTop: 10, padding: '0 14px' }}>Close</button>
        </div>
      )}
    </div>
  );
}
