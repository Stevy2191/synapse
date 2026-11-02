// Meetings: record in the browser → upload → transcribe with speaker detection → (optional) AI
// summary + to-do list. The transcript appears in a meeting block in the note.
//
// Engines (each person picks theirs in Settings → Meetings):
//   server     — free and private: sherpa-onnx (Whisper + Silero VAD + pyannote/TitaNet speaker
//                detection) in worker threads on this server. Needs the admin to download models.
//   assemblyai / deepgram — the person's own API key; faster, better at telling voices apart.
// Audio is kept with the note (UPLOADS_DIR/meetings, so backups include it) until deleted.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Worker } from 'worker_threads';
import { db, UPLOADS_DIR } from './db/index.js';
import { DATA_DIR, JWT_SECRET } from './config.js';
import { getSetting } from './settings.js';
import { modelPaths } from './speech/models.js';
import { sendTo, pushTo, isOnScreen } from './chat.js';
import { resolveAccount, streamChat, logUsage } from './ai.js';

export class MeetingError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const AUDIO_DIR = path.join(UPLOADS_DIR, 'meetings');
const TMP_DIR = path.join(DATA_DIR, '.meeting-tmp');
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    note_id TEXT,
    workspace_id TEXT,
    title TEXT NOT NULL DEFAULT 'Meeting',
    status TEXT NOT NULL DEFAULT 'queued',   -- queued | transcribing | summarizing | done | failed
    stage TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'server',
    error TEXT,
    audio_file TEXT,
    audio_mime TEXT,
    audio_size INTEGER,
    duration REAL,
    speakers_hint INTEGER NOT NULL DEFAULT 0,
    transcript TEXT,                          -- JSON [{ start, end, speaker, text }]
    speaker_names TEXT NOT NULL DEFAULT '{}', -- JSON { "0": "Sean" }
    summary TEXT,                             -- Markdown
    actions TEXT,                             -- JSON [{ task, who, due }]
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meetings_note ON meetings(note_id);
  CREATE TABLE IF NOT EXISTS meeting_prefs (
    user_id TEXT PRIMARY KEY,
    engine TEXT NOT NULL DEFAULT 'server',
    auto_summary INTEGER NOT NULL DEFAULT 1,
    auto_todos INTEGER NOT NULL DEFAULT 1,
    keys_enc TEXT NOT NULL DEFAULT '',        -- encrypted JSON { assemblyai, deepgram }
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ───────────────────────── prefs + keys ─────────────────────────

const KEY = crypto.createHash('sha256').update(`synapse-speech-keys:${JWT_SECRET}`).digest();
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join(':');
}
function decrypt(blob) {
  if (!blob) return {};
  try {
    const [iv, tag, enc] = blob.split(':').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  } catch { return {}; }
}

export const ENGINES = {
  server: { label: 'This server (free, private)' },
  assemblyai: { label: 'AssemblyAI', keyUrl: 'https://www.assemblyai.com/dashboard/signup' },
  deepgram: { label: 'Deepgram', keyUrl: 'https://console.deepgram.com/signup' },
};

function prefsRow(userId) {
  return db.prepare('SELECT * FROM meeting_prefs WHERE user_id=?').get(userId) || { engine: 'server', auto_summary: 1, auto_todos: 1, keys_enc: '' };
}

export function getPrefs(userId) {
  const r = prefsRow(userId);
  const keys = decrypt(r.keys_enc);
  let aiReady = true;
  try { resolveAccount(userId); } catch { aiReady = false; }
  return {
    engine: ENGINES[r.engine] ? r.engine : 'server',
    auto_summary: !!r.auto_summary,
    auto_todos: !!r.auto_todos,
    keys: Object.fromEntries(Object.keys(ENGINES).filter(e => e !== 'server').map(e => [e, keys[e] ? `…${keys[e].slice(-4)}` : ''])),
    engines: ENGINES,
    server_ready: !!modelPaths(),
    ai_ready: aiReady,
  };
}

export function savePrefs(userId, body) {
  const r = prefsRow(userId);
  const keys = decrypt(r.keys_enc);
  let engine = r.engine;
  if (body.engine !== undefined) {
    if (!ENGINES[body.engine]) throw new MeetingError(400, 'Unknown transcription service');
    engine = body.engine;
  }
  for (const e of ['assemblyai', 'deepgram']) {
    if (body[`${e}_key`] !== undefined) {
      const k = String(body[`${e}_key`] || '').trim();
      if (k) keys[e] = k.slice(0, 300); else delete keys[e];
    }
  }
  if (engine !== 'server' && !keys[engine]) throw new MeetingError(400, `Add your ${ENGINES[engine].label} key first`);
  db.prepare(`INSERT INTO meeting_prefs (user_id, engine, auto_summary, auto_todos, keys_enc) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET engine=excluded.engine, auto_summary=excluded.auto_summary, auto_todos=excluded.auto_todos, keys_enc=excluded.keys_enc`)
    .run(userId, engine,
      body.auto_summary !== undefined ? (body.auto_summary ? 1 : 0) : r.auto_summary,
      body.auto_todos !== undefined ? (body.auto_todos ? 1 : 0) : r.auto_todos,
      encrypt(keys));
  return getPrefs(userId);
}

// ───────────────────────── meetings ─────────────────────────

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export function publicMeeting(m) {
  if (!m) return null;
  return {
    id: m.id, note_id: m.note_id, title: m.title, status: m.status, stage: m.stage, progress: m.progress,
    engine: m.engine, error: m.error, duration: m.duration, has_audio: !!m.audio_file, created_at: m.created_at,
    finished_at: m.finished_at, speakers_hint: m.speakers_hint,
    transcript: parse(m.transcript, null), speaker_names: parse(m.speaker_names, {}),
    summary: m.summary || '', actions: parse(m.actions, []),
  };
}
const row = id => db.prepare('SELECT * FROM meetings WHERE id=?').get(id);
export const getMeeting = id => row(id);

const EXT = { 'audio/webm': '.webm', 'video/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'audio/x-m4a': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.aac' };

/** A new meeting from an uploaded audio file (multer temp file). */
export function createMeeting(userId, file, { note_id: noteId, workspace_id: workspaceId, title, speakers }) {
  const id = crypto.randomUUID();
  const mime = String(file.mimetype || '').split(';')[0].toLowerCase();
  const ext = EXT[mime] || path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6) || '.audio';
  const audio = `${id}${ext}`;
  fs.renameSync(file.path, path.join(AUDIO_DIR, audio));
  const engine = getPrefs(userId).engine;
  db.prepare(`INSERT INTO meetings (id, user_id, note_id, workspace_id, title, engine, audio_file, audio_mime, audio_size, speakers_hint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, noteId || null, workspaceId || null, String(title || 'Meeting').slice(0, 200), engine, audio, mime || 'application/octet-stream', file.size,
      Math.max(0, Math.min(20, parseInt(speakers, 10) || 0)));
  enqueue(id);
  return publicMeeting(row(id));
}

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE meetings SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => fields[k]), id);
  const m = row(id);
  if (m) sendTo([m.user_id], 'meeting:update', { id, status: m.status, stage: m.stage, progress: m.progress, error: m.error });
  return m;
}

export function renameSpeakers(id, names) {
  const m = row(id);
  const cur = parse(m.speaker_names, {});
  for (const [k, v] of Object.entries(names || {})) {
    if (!/^\d{1,2}$/.test(k)) continue;
    const name = String(v || '').trim().slice(0, 60);
    if (name) cur[k] = name; else delete cur[k];
  }
  db.prepare('UPDATE meetings SET speaker_names=? WHERE id=?').run(JSON.stringify(cur), id);
  return publicMeeting(row(id));
}

export function deleteAudio(id) {
  const m = row(id);
  if (m?.audio_file) fs.rmSync(path.join(AUDIO_DIR, path.basename(m.audio_file)), { force: true });
  db.prepare('UPDATE meetings SET audio_file=NULL WHERE id=?').run(id);
  return publicMeeting(row(id));
}

export function retry(id, { speakers, engine } = {}) {
  const m = row(id);
  if (!m.audio_file) throw new MeetingError(400, 'The recording was deleted, so it can’t be transcribed again');
  const fields = { status: 'queued', stage: 'Waiting…', progress: 0, error: null };
  if (speakers !== undefined) fields.speakers_hint = Math.max(0, Math.min(20, parseInt(speakers, 10) || 0));
  if (engine && ENGINES[engine]) fields.engine = engine;
  update(id, fields);
  enqueue(id);
  return publicMeeting(row(id));
}

export function audioPath(m) { return m?.audio_file ? path.join(AUDIO_DIR, path.basename(m.audio_file)) : null; }

// Signed audio links (the <audio> player can't send the sign-in header).
const sig = (id, exp) => crypto.createHmac('sha256', JWT_SECRET).update(`meeting-audio.${id}.${exp}`).digest('base64url');
export function audioLink(id) {
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return `/api/meetings/audio/${id}?exp=${exp}&sig=${sig(id, exp)}`;
}
export function checkAudioLink(id, exp, s) {
  if (!exp || Number(exp) < Date.now() / 1000 || !s) return false;
  const a = Buffer.from(sig(id, exp)); const b = Buffer.from(String(s));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ───────────────────────── the queue ─────────────────────────

const queue = [];
let busy = false;
function enqueue(id) { if (!queue.includes(id)) queue.push(id); setImmediate(work); }

async function work() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  try { await processMeeting(id); } catch (err) {
    console.error('Meeting failed:', err);
    update(id, { status: 'failed', error: err instanceof MeetingError ? err.message : `Something went wrong: ${err.message || err}`, stage: '' });
  } finally {
    busy = false;
    setImmediate(work);
  }
}

export function startMeetings() {
  db.prepare("UPDATE meetings SET status='queued' WHERE status IN ('transcribing','summarizing')").run();
  for (const m of db.prepare("SELECT id FROM meetings WHERE status='queued' ORDER BY created_at").all()) enqueue(m.id);
}

/** People waiting: position in the queue (0 = being worked on now). */
export const queuePosition = id => queue.indexOf(id) + 1;

// ───────────────────────── processing ─────────────────────────

function ffmpegToPcm(input, output) {
  return new Promise((resolve, reject) => {
    // Only plain local files in ordinary audio/video formats: a "recording" that is really a playlist
    // (HLS, concat…) could otherwise make ffmpeg read other files or fetch web addresses.
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-protocol_whitelist', 'file',
      '-format_whitelist', 'mov,mp4,m4a,3gp,matroska,webm,ogg,wav,mp3,flac,aac,avi,asf,amr,caf,aiff,w64,wv',
      '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', output], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => reject(new MeetingError(500, e.code === 'ENOENT' ? 'ffmpeg isn’t installed on the server, so the recording can’t be read' : e.message)));
    p.on('close', code => (code === 0 ? resolve() : reject(new MeetingError(400, `The recording couldn’t be read (${err.trim().split('\n').pop() || code})`))));
  });
}

function runWorker(data, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./speech/worker.js', import.meta.url), { workerData: data });
    w.on('message', msg => {
      if (msg.type === 'progress') onProgress?.(msg.value);
      else if (msg.type === 'done') { resolve(msg.result); w.terminate(); }
      else if (msg.type === 'error') { reject(new MeetingError(500, `Transcription failed: ${msg.error}`)); w.terminate(); }
    });
    w.on('error', err => reject(new MeetingError(500, `Transcription failed: ${err.message}`)));
    w.on('exit', code => { if (code !== 0) reject(new MeetingError(500, `Transcription stopped unexpectedly (out of memory?)`)); });
  });
}

const workerCount = () => {
  const n = parseInt(getSetting('speech_workers'), 10);
  return n >= 1 && n <= 8 ? n : Math.max(1, Math.min(2, os.cpus().length - 1));
};

/** Which speaker talked most during [a, b] (seconds), by overlap. */
function speakerFor(a, b, turns) {
  let best = null, bestOverlap = 0;
  for (const t of turns) {
    const o = Math.min(b, t.end) - Math.max(a, t.start);
    if (o > bestOverlap) { bestOverlap = o; best = t.speaker; }
  }
  return best;
}

async function transcribeOnServer(m, pcm, setProgress) {
  const models = modelPaths();
  if (!models) throw new MeetingError(400, 'Transcribing on this server isn’t set up yet — an admin downloads the speech models in Settings → Server → Meetings');
  const p = { vad: 0, asr: 0, diar: 0 };
  const report = () => setProgress(0.05 + 0.1 * p.vad + 0.6 * p.asr + 0.2 * p.diar);
  // Speaker detection runs alongside finding speech + speech-to-text.
  const diarJob = runWorker({ task: 'diarize', pcm, models, speakers: m.speakers_hint }, v => { p.diar = v; report(); })
    .catch(err => { console.warn('Speaker detection failed:', err.message); return null; });
  const segments = await runWorker({ task: 'vad', pcm, models }, v => { p.vad = v; report(); });
  const n = Math.max(1, Math.min(workerCount(), segments.length));
  const parts = Array.from({ length: n }, (_, i) => segments.filter((_, j) => j % n === i));
  const done = new Array(n).fill(0);
  const texts = await Promise.all(parts.map((part, i) => (part.length
    ? runWorker({ task: 'asr', pcm, models, segments: part }, v => { done[i] = v * part.length; p.asr = done.reduce((a, b) => a + b, 0) / segments.length; report(); })
    : Promise.resolve([]))));
  const out = [];
  parts.forEach((part, i) => part.forEach((s, j) => out.push({ start: s.start / 16000, end: s.end / 16000, text: texts[i][j] || '' })));
  out.sort((a, b) => a.start - b.start);
  p.diar = 1; // whatever is left of it now counts as waiting
  setProgress(0.88);
  const turns = (await diarJob) || [];
  return out.filter(s => s.text).map(s => ({ ...s, speaker: turns.length ? speakerFor(s.start, s.end, turns) : null }));
}

const AAI = () => (process.env.ASSEMBLYAI_BASE || 'https://api.assemblyai.com').replace(/\/+$/, '');
const DG = () => (process.env.DEEPGRAM_BASE || 'https://api.deepgram.com').replace(/\/+$/, '');

async function cloudFetch(url, opts, label) {
  let res;
  try { res = await fetch(url, opts); } catch { throw new MeetingError(502, `Couldn’t reach ${label} from the server`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.err_msg || data.message || res.statusText;
    throw new MeetingError(res.status === 401 || res.status === 403 ? 400 : 502, res.status === 401 || res.status === 403 ? `${label} didn’t accept your key — check it in Settings → Meetings` : `${label}: ${msg}`);
  }
  return data;
}

async function transcribeAssemblyAI(m, key, setProgress) {
  const file = audioPath(m);
  setProgress(0.1);
  const up = await cloudFetch(`${AAI()}/v2/upload`, { method: 'POST', headers: { authorization: key, 'content-type': 'application/octet-stream' }, body: fs.readFileSync(file) }, 'AssemblyAI');
  setProgress(0.25);
  const job = await cloudFetch(`${AAI()}/v2/transcript`, {
    method: 'POST', headers: { authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: up.upload_url, speaker_labels: true, ...(m.speakers_hint ? { speakers_expected: m.speakers_hint } : {}), punctuate: true, format_text: true }),
  }, 'AssemblyAI');
  for (let i = 0; i < 720; i++) { // up to an hour
    await new Promise(r => setTimeout(r, i < 5 ? 2000 : 5000));
    const t = await cloudFetch(`${AAI()}/v2/transcript/${job.id}`, { headers: { authorization: key } }, 'AssemblyAI');
    if (t.status === 'completed') {
      const order = [];
      return (t.utterances || []).map(u => {
        if (!order.includes(u.speaker)) order.push(u.speaker);
        return { start: u.start / 1000, end: u.end / 1000, speaker: order.indexOf(u.speaker), text: u.text };
      });
    }
    if (t.status === 'error') throw new MeetingError(502, `AssemblyAI: ${t.error || 'transcription failed'}`);
    setProgress(Math.min(0.85, 0.25 + i * 0.01));
  }
  throw new MeetingError(504, 'AssemblyAI took too long');
}

async function transcribeDeepgram(m, key, setProgress) {
  setProgress(0.15);
  const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', diarize: 'true', utterances: 'true', punctuate: 'true' });
  const data = await cloudFetch(`${DG()}/v1/listen?${q}`, {
    method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': m.audio_mime || 'application/octet-stream' }, body: fs.readFileSync(audioPath(m)),
  }, 'Deepgram');
  return (data.results?.utterances || []).map(u => ({ start: u.start, end: u.end, speaker: Number.isInteger(u.speaker) ? u.speaker : null, text: u.transcript }));
}

// Speakers numbered in the order they first speak (0 = first person to talk).
function renumber(segs) {
  const order = [];
  for (const s of segs) if (s.speaker !== null && s.speaker !== undefined && !order.includes(s.speaker)) order.push(s.speaker);
  return segs.map(s => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, speaker: s.speaker === null || s.speaker === undefined ? null : order.indexOf(s.speaker), text: String(s.text || '').trim() }));
}

const clock = t => { const s = Math.floor(t); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };

const SUMMARIZER = `You write short, useful meeting notes from a transcript. Speakers are labelled; use their names when given.
Reply with JSON only, no other text:
{"summary": ["3–8 short bullet points: what was discussed and decided"], "action_items": [{"task": "what to do", "who": "person or null", "due": "YYYY-MM-DD or null"}]}
Only include action items someone actually agreed to or was asked to do. Use the meeting date to turn "Friday" etc. into dates.`;

async function summarize(m, segs, prefs) {
  let acct;
  try { acct = resolveAccount(m.user_id); } catch { return null; }
  if (m.workspace_id) {
    const ws = db.prepare('SELECT settings FROM workspaces WHERE id=?').get(m.workspace_id);
    if (parse(ws?.settings || '{}', {}).ai === 'off') return null;
  }
  const names = parse(m.speaker_names, {});
  const who = s => (s === null ? 'Someone' : names[s] || `Speaker ${s + 1}`);
  let text = segs.map(s => `[${clock(s.start)}] ${who(s.speaker)}: ${s.text}`).join('\n');
  if (text.length > 120_000) text = `${text.slice(0, 120_000)}\n[…transcript shortened…]`;
  const date = new Date(m.created_at * 1000).toISOString().slice(0, 10);
  const out = await streamChat(acct, {
    system: SUMMARIZER,
    messages: [{ role: 'user', content: `Meeting: "${m.title}" on ${date}.\n\nTranscript:\n${text}` }],
    signal: AbortSignal.timeout(300_000),
  });
  logUsage(m.user_id, acct, 'meeting-summary', text.length, out.length);
  const json = parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0], {});
  const summary = prefs.auto_summary && Array.isArray(json.summary) ? json.summary.filter(Boolean).map(b => `- ${String(b).trim()}`).join('\n') : '';
  const actions = prefs.auto_todos && Array.isArray(json.action_items)
    ? json.action_items.filter(a => a?.task).map(a => ({ task: String(a.task).trim(), who: a.who ? String(a.who).trim() : null, due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : null }))
    : [];
  return { summary, actions };
}

async function processMeeting(id) {
  let m = row(id);
  if (!m || m.status !== 'queued') return;
  const file = audioPath(m);
  if (!file || !fs.existsSync(file)) throw new MeetingError(400, 'The recording file is missing');
  const prefsRaw = prefsRow(m.user_id);
  const prefs = { auto_summary: !!prefsRaw.auto_summary, auto_todos: !!prefsRaw.auto_todos };
  let last = 0;
  const setProgress = v => { if (v - last >= 0.02 || v >= 1) { last = v; update(id, { progress: Math.min(1, v) }); } };
  update(id, { status: 'transcribing', stage: 'Reading the recording…', progress: 0.01, error: null });
  const pcm = path.join(TMP_DIR, `${id}.f32`);
  try {
    await ffmpegToPcm(file, pcm);
    const duration = fs.statSync(pcm).size / 4 / 16000;
    if (duration < 0.5) throw new MeetingError(400, 'The recording is empty');
    update(id, { duration, stage: 'Transcribing…' });
    let segs;
    if (m.engine === 'server') segs = await transcribeOnServer(m, pcm, setProgress);
    else {
      const key = decrypt(prefsRaw.keys_enc)[m.engine];
      if (!key) throw new MeetingError(400, `Add your ${ENGINES[m.engine]?.label || m.engine} key in Settings → Meetings`);
      segs = m.engine === 'assemblyai' ? await transcribeAssemblyAI(m, key, setProgress) : await transcribeDeepgram(m, key, setProgress);
    }
    segs = renumber(segs);
    m = update(id, { transcript: JSON.stringify(segs), progress: 0.9 });
    let ai = null;
    if ((prefs.auto_summary || prefs.auto_todos) && segs.length) {
      update(id, { status: 'summarizing', stage: 'Writing the summary…' });
      try { ai = await summarize(m, segs, prefs); } catch (err) { console.warn('Meeting summary failed:', err.message); }
    }
    update(id, { status: 'done', stage: '', progress: 1, summary: ai?.summary || '', actions: JSON.stringify(ai?.actions || []), finished_at: Math.floor(Date.now() / 1000) });
    if (!isOnScreen(m.user_id)) {
      pushTo(m.user_id, { title: 'Transcript ready', body: `“${m.title}” has been transcribed${ai?.summary ? ' and summarised' : ''}.`, url: '/', tag: `meeting-${id}` }).catch(() => {});
    }
  } finally {
    fs.rmSync(pcm, { force: true });
  }
}
