// Meetings in the browser: recording (microphone, or a call on this computer: screen-share audio +
// microphone mixed together), keeping the audio safe until it's uploaded, and the API.
import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '../api';
import { db } from '../offline/db';

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || err?.message || fallback;

// ───────────────────────── API ─────────────────────────

export const getMeeting = id => api.get(`/meetings/${id}`).then(r => r.data.meeting);
export const audioLink = id => api.get(`/meetings/${id}/audio-link`).then(r => r.data.url);
export const renameSpeakers = (id, names) => api.patch(`/meetings/${id}/speakers`, { names }).then(r => r.data.meeting);
export const retryMeeting = (id, body = {}) => api.post(`/meetings/${id}/retry`, body).then(r => r.data.meeting);
export const deleteMeetingAudio = id => api.delete(`/meetings/${id}/audio`).then(r => r.data.meeting);
export const getMeetingPrefs = () => api.get('/meetings/prefs').then(r => r.data);
export const saveMeetingPrefs = body => api.put('/meetings/prefs', body).then(r => r.data);

async function uploadRecording(rec, onProgress) {
  const form = new FormData();
  const ext = /mp4|m4a|aac/.test(rec.mime) ? 'm4a' : /ogg/.test(rec.mime) ? 'ogg' : /mpeg|mp3/.test(rec.mime) ? 'mp3' : /wav/.test(rec.mime) ? 'wav' : 'webm';
  form.append('audio', rec.blob || new Blob(rec.chunks, { type: rec.mime }), rec.fileName || `meeting.${ext}`);
  form.append('title', rec.title || 'Meeting');
  if (rec.noteId) form.append('note_id', rec.noteId);
  if (rec.workspaceId) form.append('workspace_id', rec.workspaceId);
  if (rec.speakers) form.append('speakers', String(rec.speakers));
  const { data } = await api.post('/meetings', form, {
    timeout: 0,
    onUploadProgress: e => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
  });
  return data.meeting;
}

// ───────────────────────── recordings kept on this device until uploaded ─────────────────────────

async function keep(rec) { try { await (await db()).put('recordings', { ...rec, savedAt: Date.now() }); } catch { /* storage full / private mode */ } }
async function forget(localId) { try { await (await db()).delete('recordings', localId); } catch { /* ignore */ } }
export async function unsentRecordings() { try { return await (await db()).getAll('recordings'); } catch { return []; } }

// The meeting block in a note waits for its recording; tell it (or patch the saved note) when uploaded.
function announce(localId, meeting) {
  window.dispatchEvent(new CustomEvent('synapse:meeting-uploaded', { detail: { localId, meeting } }));
}

/** Upload a kept recording (retries are safe: it's removed from the device only after success). */
export async function sendRecording(rec, onProgress) {
  const meeting = await uploadRecording(rec, onProgress);
  await forget(rec.localId);
  announce(rec.localId, meeting);
  await attachToSavedNote(rec.noteId, rec.localId, meeting.id).catch(() => {});
  return meeting;
}

/** If the note isn't open, write the meeting's id into the saved note so the block finds it later. */
async function attachToSavedNote(noteId, localId, meetingId) {
  if (!noteId) return;
  const { openNoteId } = useRecorder.getState();
  const { saveNote } = await import('../offline/sync');
  const d = await db();
  const note = await d.get('notes', noteId);
  if (!note?.rich_content?.includes(`data-local-id="${localId}"`) || note.rich_content.includes(`data-meeting="${meetingId}"`)) return;
  if (openNoteId === noteId) return; // the open editor updates its own block
  const html = note.rich_content.replace(`data-local-id="${localId}"`, `data-local-id="${localId}" data-meeting="${meetingId}" data-status="processing"`);
  await saveNote(noteId, { rich_content: html });
}

/** Try again to upload recordings left from a failed upload / closed tab. */
export async function retryUnsent() {
  for (const rec of await unsentRecordings()) {
    if (useRecorder.getState().localId === rec.localId) continue; // still recording
    if (!rec.chunks?.length && !rec.blob) { await forget(rec.localId); continue; }
    try { await sendRecording(rec); toast.success(`Uploaded the recording “${rec.title || 'Meeting'}”`); } catch { /* offline: later */ }
  }
}

// ───────────────────────── recorder ─────────────────────────

export const canRecordScreenAudio = () => !!navigator.mediaDevices?.getDisplayMedia && !/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

let media = null; // { recorder, streams, ctx, analyser, timer, chunks }

export const useRecorder = create((set, get) => ({
  state: 'idle',        // idle | recording | paused | stopping | uploading
  localId: null,
  noteId: null,
  workspaceId: null,
  title: 'Meeting',
  mode: 'mic',
  startedAt: 0,
  elapsedBefore: 0,     // seconds recorded before the last pause
  level: 0,
  progress: 0,
  openNoteId: null,     // the note open in the editor (for attaching the meeting id)

  /** Start recording. mode: 'mic' (in the room) | 'call' (screen/tab audio + microphone). */
  async start({ mode, localId, noteId, workspaceId, title }) {
    if (get().state !== 'idle') throw new Error('A recording is already running');
    if (!canRecord()) throw new Error('This browser can’t record audio');
    if (!window.isSecureContext) throw new Error('Recording needs Synapse opened over https:// (browsers only allow the microphone there)');
    const streams = [];
    try {
      if (mode === 'call') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false }, systemAudio: 'include', selfBrowserSurface: 'exclude' });
        streams.push(display);
        if (!display.getAudioTracks().length) {
          display.getTracks().forEach(t => t.stop());
          throw new Error('No sound was shared. Start again and tick “Share system audio” (or “Share tab audio”) in the sharing window.');
        }
      }
      try {
        streams.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
      } catch (err) {
        if (mode !== 'call') throw err; // a call can still be recorded without the mic
        toast('Recording without your microphone (it wasn’t allowed) — only the other people will be heard.', { icon: '🎙', duration: 6000 });
      }
    } catch (err) {
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      if (err?.name === 'NotAllowedError') throw new Error(mode === 'call' ? 'Sharing was cancelled or not allowed' : 'The microphone wasn’t allowed — allow it in the browser’s address bar and try again');
      throw err;
    }
    // Mix everything into one track.
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    for (const s of streams) {
      if (!s.getAudioTracks().length) continue;
      const src = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
      src.connect(dest); src.connect(analyser);
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(dest.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    const chunks = [];
    const rec = { localId, noteId, workspaceId, title: title || 'Meeting', mime: recorder.mimeType || mime || 'audio/webm', chunks, startedAt: Date.now() };
    recorder.ondataavailable = e => { if (e.data?.size) { chunks.push(e.data); keep(rec); } };
    // If the person stops sharing from the browser's own bar, stop the recording too.
    streams.forEach(s => s.getVideoTracks().forEach(t => { t.onended = () => { if (get().state === 'recording' || get().state === 'paused') get().stop(); }; }));
    recorder.start(10_000); // a chunk every 10 s, kept on the device as we go
    const buf = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      set({ level: Math.min(1, peak / 90) });
    }, 120);
    media = { recorder, streams, ctx, timer, rec };
    set({ state: 'recording', localId, noteId, workspaceId, title: rec.title, mode, startedAt: Date.now(), elapsedBefore: 0, level: 0, progress: 0 });
    window.addEventListener('beforeunload', warnUnload);
  },

  pause() {
    if (get().state !== 'recording' || !media) return;
    media.recorder.pause();
    set(s => ({ state: 'paused', elapsedBefore: s.elapsedBefore + (Date.now() - s.startedAt) / 1000 }));
  },
  resume() {
    if (get().state !== 'paused' || !media) return;
    media.recorder.resume();
    set({ state: 'recording', startedAt: Date.now() });
  },

  /** Stop and keep the recording on this device; resolves with it (call send() to upload). */
  stop() {
    if (!media) return Promise.resolve(null);
    const { recorder, streams, ctx, timer, rec } = media;
    set({ state: 'stopping' });
    return new Promise(resolve => {
      recorder.onstop = async () => {
        clearInterval(timer);
        streams.forEach(s => s.getTracks().forEach(t => t.stop()));
        ctx.close().catch(() => {});
        media = null;
        window.removeEventListener('beforeunload', warnUnload);
        await keep(rec);
        set({ state: 'stopped', level: 0 });
        resolve(rec);
      };
      try { recorder.stop(); } catch { recorder.onstop(); }
    });
  },

  /** Throw the recording away. */
  async cancel() {
    const rec = media?.rec;
    if (media) await get().stop();
    if (rec) await forget(rec.localId);
    set({ state: 'idle', localId: null });
    return rec;
  },

  /** Upload the stopped recording (with a title / number of speakers chosen afterwards). */
  async send(rec, extra = {}) {
    const r = { ...rec, ...extra };
    await keep(r);
    set({ state: 'uploading', progress: 0 });
    try {
      const meeting = await sendRecording(r, p => set({ progress: p }));
      set({ state: 'idle', localId: null });
      return meeting;
    } catch (err) {
      set({ state: 'idle', localId: null });
      if (!err.response) toast('You’re offline — the recording is saved on this device and will upload when you’re back online.', { icon: '💾', duration: 7000 });
      throw err;
    }
  },

  elapsed() {
    const s = get();
    return s.state === 'recording' ? s.elapsedBefore + (Date.now() - s.startedAt) / 1000 : s.elapsedBefore;
  },
}));

function warnUnload(e) { e.preventDefault(); e.returnValue = ''; }

/** Throw away a recording kept on this device. */
export async function discardRecording(localId) {
  if (localId) await forget(localId);
  useRecorder.setState({ state: 'idle', localId: null });
}

/** Upload an existing audio file (voice memo, Teams recording…) as a meeting. */
export async function uploadAudioFile(file, { localId, noteId, workspaceId, title }) {
  const rec = { localId, noteId, workspaceId, title: title || file.name.replace(/\.[^.]+$/, ''), mime: file.type || 'audio/mpeg', blob: file, fileName: file.name };
  await keep(rec);
  return sendRecording(rec);
}

export const clock = t => {
  const s = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
