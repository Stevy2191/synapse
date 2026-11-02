// "Read text" window: reads the text in a picture (printed — OCR; or handwriting — the AI assistant)
// or a PDF, shows it so it can be corrected, then Copy / Insert / New note.
import { useEffect, useRef, useState } from 'react';
import { Copy, CornerDownLeft, Loader2, ScanText, PenLine, FilePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import { readText, readPdf, errorText } from '../../ocr/client';

/**
 * source: data URL / Blob / File (picture or PDF) / <canvas>.
 * onInsert(text) — show "Insert below"; onNewNote(text) — show "New note with this text".
 */
export default function ReadTextDialog({ source, defaultMode = 'print', onInsert, onNewNote, onClose, title = 'Text from the picture' }) {
  const isPdf = source && typeof source !== 'string' && (source.type === 'application/pdf' || /\.pdf$/i.test(source.name || ''));
  const [mode, setMode] = useState(defaultMode);
  const [state, setState] = useState({ step: 'reading', progress: 'Starting…' });
  const [text, setText] = useState('');
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    setState({ step: 'reading', progress: 'Starting…' });
    const onProgress = p => { if (run.current === id) setState({ step: 'reading', progress: p }); };
    (isPdf ? readPdf(source, { onProgress }) : readText(source, { handwriting: mode === 'handwriting', onProgress }))
      .then(r => {
        if (run.current !== id) return;
        setText(r.text || '');
        setState({ step: 'done', local: r.local, ai: r.ai, confidence: r.confidence, pages: r.pages, total: r.total });
      })
      .catch(err => { if (run.current === id) setState({ step: 'error', error: errorText(err) }); });
  }, [mode]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Text copied'); } catch {
      const ta = document.querySelector('.ocr-text'); ta?.select(); document.execCommand?.('copy'); toast.success('Text copied');
    }
  };

  const note = state.step === 'done' ? [
    state.local && 'Read on this device (you’re offline).',
    state.ai && 'Read by your AI assistant — check it, it can make mistakes.',
    state.pages && state.total > state.pages && `Only the first ${state.pages} of ${state.total} pages were read.`,
    !text.trim() && (mode === 'print' && !isPdf ? 'No printed text found. If it’s handwriting, try “Handwriting”.' : 'No text found.'),
    text.trim() && state.confidence != null && state.confidence < 60 && 'This was hard to read — check the text.',
  ].filter(Boolean).join(' ') : '';

  return (
    <Modal title={title} onClose={onClose} width={620}>
      {!isPdf && (
        <div className="seg ocr-modes" role="tablist">
          <button type="button" className={mode === 'print' ? 'on' : ''} onClick={() => setMode('print')} title="Typed or printed text (works offline too)"><ScanText size={13} /> Printed text</button>
          <button type="button" className={mode === 'handwriting' ? 'on' : ''} onClick={() => setMode('handwriting')} title="Handwriting — uses your AI assistant (needs a model that can see pictures)"><PenLine size={13} /> Handwriting (AI)</button>
        </div>
      )}
      {state.step === 'reading' && <p className="ocr-status"><Loader2 size={15} className="spin" /> {state.progress}</p>}
      {state.step === 'error' && <p className="ocr-status error">{state.error}</p>}
      {state.step === 'done' && (
        <>
          <textarea className="ocr-text" value={text} onChange={e => setText(e.target.value)} placeholder="(no text)" spellCheck />
          {note && <p className="ocr-note">{note}</p>}
        </>
      )}
      <div className="ocr-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        {onNewNote && <button type="button" className="btn-ghost" disabled={state.step !== 'done' || !text.trim()} onClick={() => { onNewNote(text); onClose(); }}><FilePlus size={14} /> New note</button>}
        <button type="button" className={onInsert ? 'btn-ghost' : 'export-go'} disabled={state.step !== 'done' || !text.trim()} onClick={copy}><Copy size={14} /> Copy text</button>
        {onInsert && <button type="button" className="export-go" disabled={state.step !== 'done' || !text.trim()} onClick={() => { onInsert(text); onClose(); }}><CornerDownLeft size={14} /> Insert below</button>}
      </div>
    </Modal>
  );
}
