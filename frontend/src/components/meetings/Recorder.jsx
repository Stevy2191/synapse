// Recording UI: the "Record a meeting" window, the floating recording bar (visible everywhere while
// recording), and the window shown when you stop (name + how many people spoke).
import { useEffect, useRef, useState } from 'react';
import { Mic, MonitorSpeaker, Upload, Square, Pause, Play, X, Loader2, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import { useRecorder, canRecord, canRecordScreenAudio, uploadAudioFile, discardRecording, errorText, clock } from '../../meetings/client';

/**
 * Choose how to record. onBegin({ mode, file }) is called once a choice is made (mode 'mic' |
 * 'call' | 'file'); it inserts the meeting block and starts recording / uploading.
 */
export function RecordDialog({ onBegin, onClose, defaultTitle = 'Meeting' }) {
  const [title, setTitle] = useState(defaultTitle);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const secure = window.isSecureContext;
  const go = async (mode, file) => {
    setBusy(true);
    try { await onBegin({ mode, file, title: title.trim() || 'Meeting' }); onClose(); } catch (err) { toast.error(errorText(err)); setBusy(false); }
  };
  return (
    <Modal title="Record a meeting" onClose={() => !busy && onClose()} width={540}>
      <input className="chat-field" value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting name" style={{ width: '100%', marginBottom: 12 }} />
      {!secure && <p className="backup-warning"><Info size={13} /> <span>Browsers only allow recording on https:// addresses. Open Synapse at its https address to record — you can still upload a recording below.</span></p>}
      <div className="rec-choices">
        <button type="button" className="rec-choice" disabled={busy || !secure || !canRecord()} onClick={() => go('mic')}>
          <Mic size={20} />
          <span><b>In the room</b><small>Records with this device’s microphone. Put it in the middle of the table.</small></span>
        </button>
        <button type="button" className="rec-choice" disabled={busy || !secure || !canRecordScreenAudio()} onClick={() => go('call')}>
          <MonitorSpeaker size={20} />
          <span><b>Online meeting on this computer</b><small>{canRecordScreenAudio()
            ? <>Teams, Zoom, Meet… Your browser asks what to share: pick the <b>entire screen</b> and tick <b>“Share system audio”</b> (or a browser tab and <b>“Share tab audio”</b>). Your microphone is recorded too.</>
            : 'Not possible on this device — use a Windows or Mac computer with Chrome or Edge, or record “In the room”.'}</small></span>
        </button>
        <button type="button" className="rec-choice" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={20} />
          <span><b>Upload a recording</b><small>An audio or video file you already have — a voice memo, a Teams/Zoom recording…</small></span>
        </button>
        <input ref={fileRef} type="file" accept="audio/*,video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) go('file', f); }} />
      </div>
      {busy && <p className="chat-pop-note"><Loader2 size={14} className="spin" /> Starting…</p>}
    </Modal>
  );
}

/** Start: insert the block (via insert(localId, title)), then record or upload. */
export async function beginMeeting({ mode, file, title, noteId, workspaceId, insert, remove }) {
  const localId = `rec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  insert(localId, title);
  try {
    if (mode === 'file') {
      uploadAudioFile(file, { localId, noteId, workspaceId, title })
        .then(() => toast.success('Uploaded — transcribing now'))
        .catch(err => toast.error(errorText(err, 'The upload failed — it’s saved on this device and will be tried again')));
      return;
    }
    await useRecorder.getState().start({ mode, localId, noteId, workspaceId, title });
  } catch (err) {
    remove(localId);
    throw err;
  }
}

/** Floating bar while recording, and the "stopped" window. Rendered once in the app. */
export function RecorderBar() {
  const r = useRecorder();
  const [, tick] = useState(0);
  const [stopped, setStopped] = useState(null); // the recording, waiting for name / speakers
  const [speakers, setSpeakers] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (r.state !== 'recording') return undefined;
    const t = setInterval(() => tick(x => x + 1), 500);
    return () => clearInterval(t);
  }, [r.state]);

  const stop = async () => {
    const rec = await useRecorder.getState().stop();
    if (rec) { setName(rec.title); setStopped(rec); }
  };
  useEffect(() => {
    const on = () => stop();
    window.addEventListener('synapse:recorder-stop', on);
    return () => window.removeEventListener('synapse:recorder-stop', on);
  }, []);

  const send = async () => {
    const rec = stopped;
    setStopped(null);
    try {
      await useRecorder.getState().send(rec, { title: name.trim() || rec.title, speakers: parseInt(speakers, 10) || 0 });
      toast.success('Uploaded — transcribing now. You can keep working.');
    } catch (err) { if (err.response) toast.error(errorText(err)); }
    setSpeakers('');
  };
  const discard = async () => {
    if (!confirm('Throw this recording away?')) return;
    let localId = stopped?.localId;
    if (!stopped) localId = (await useRecorder.getState().stop())?.localId;
    await discardRecording(localId);
    setStopped(null);
    if (localId) window.dispatchEvent(new CustomEvent('synapse:meeting-discarded', { detail: { localId } }));
  };

  if (stopped) {
    return (
      <Modal title="Recording finished" onClose={() => {}} width={440}>
        <p className="chat-dialog-hint">{clock((Date.now() - stopped.startedAt) / 1000)} recorded. It’s saved on this device until it’s uploaded.</p>
        <label className="rec-label">Name</label>
        <input className="chat-field" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
        <label className="rec-label">How many people spoke? <small>(optional — helps tell voices apart)</small></label>
        <input className="chat-field" type="number" min={1} max={20} value={speakers} onChange={e => setSpeakers(e.target.value)} placeholder="Let Synapse work it out" style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn-ghost danger-hover" onClick={discard}>Throw away</button>
          <button type="button" className="export-go" onClick={send}>Transcribe</button>
        </div>
      </Modal>
    );
  }
  if (r.state !== 'recording' && r.state !== 'paused' && r.state !== 'uploading') return null;
  const bars = [0.35, 0.6, 1, 0.7, 0.45];
  return (
    <div className="rec-bar" role="status">
      {r.state === 'uploading' ? (
        <><Loader2 size={15} className="spin" /> <span>Uploading “{r.title}”… {r.progress}%</span></>
      ) : (
        <>
          <span className={`mtg-dot${r.state === 'recording' ? ' live' : ''}`} />
          <span className="rec-title">{r.title}</span>
          <span className="rec-time">{clock(useRecorder.getState().elapsed())}</span>
          <span className="rec-level" aria-hidden="true">{bars.map((k, i) => <i key={i} style={{ height: `${Math.max(3, Math.round(r.level * k * 18))}px` }} />)}</span>
          {r.state === 'recording'
            ? <button type="button" className="rec-btn" onClick={r.pause} title="Pause"><Pause size={14} /></button>
            : <button type="button" className="rec-btn" onClick={r.resume} title="Resume"><Play size={14} /></button>}
          <button type="button" className="rec-btn stop" onClick={stop} title="Stop"><Square size={12} /> Stop</button>
          <button type="button" className="rec-btn" onClick={discard} title="Throw away"><X size={14} /></button>
        </>
      )}
    </div>
  );
}
