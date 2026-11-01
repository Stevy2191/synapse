// Excalidraw in a full-screen window. Loaded on demand (it's large); its fonts are served by
// Synapse itself (see scripts/copy-excalidraw-fonts.mjs), so it works offline.
import { useMemo, useRef, useState } from 'react';
import { Excalidraw, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { isLightTheme } from '../../themes';

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = '/excalidraw/';

function toDataUrl(svg) {
  const text = new XMLSerializer().serializeToString(svg);
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
}

export default function ExcalidrawEditor({ scene, onSave, onClose }) {
  const api = useRef(null);
  const [saving, setSaving] = useState(false);
  const userTheme = useStore(s => s.user?.theme);
  const theme = isLightTheme(userTheme) ? 'light' : 'dark';

  const initialData = useMemo(() => {
    try {
      const data = scene ? JSON.parse(scene) : null;
      return data ? { elements: data.elements || [], appState: { ...(data.appState || {}), theme }, files: data.files || {} } : { appState: { theme } };
    } catch { return { appState: { theme } }; }
  }, []);

  const save = async () => {
    const ex = api.current;
    if (!ex) return;
    setSaving(true);
    try {
      const elements = ex.getSceneElements();
      const appState = ex.getAppState();
      const files = ex.getFiles();
      if (elements.length === 0) { onClose(); return; }
      // The picture shown in the note: light background so it reads in any theme.
      const svg = await exportToSvg({
        elements, files,
        appState: { ...appState, exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
        exportPadding: 16,
      });
      onSave({ scene: serializeAsJSON(elements, appState, files, 'local'), preview: toDataUrl(svg) });
    } catch (err) {
      console.error(err);
      toast.error('Couldn’t save the drawing');
      setSaving(false);
    }
  };

  return (
    <div className="diagram-modal">
      <div className="diagram-bar">
        <span style={{ font: '600 13px var(--font-sans)', color: 'var(--text-primary)' }}>Excalidraw</span>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-ghost on" onClick={save} disabled={saving} style={{ padding: '0 14px' }}>{saving ? 'Saving…' : 'Save & close'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw excalidrawAPI={a => { api.current = a; }} initialData={initialData} theme={theme}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />
      </div>
    </div>
  );
}
