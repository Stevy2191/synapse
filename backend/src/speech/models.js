// Speech models for transcribing meetings on this server (sherpa-onnx): a Whisper model for
// speech-to-text, Silero for finding speech, and two small models for telling speakers apart.
// The admin downloads them once (Settings → Server → Meetings) into DATA_DIR/speech-models.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DATA_DIR } from '../config.js';
import { getSetting, setSetting } from '../settings.js';

export const MODELS_DIR = path.join(DATA_DIR, 'speech-models');
const BASE = () => (process.env.SPEECH_MODELS_BASE || 'https://github.com/k2-fsa/sherpa-onnx/releases/download').replace(/\/+$/, '');

// Speech-to-text choices (Whisper). Sizes are the download; `.en` = English only (more accurate).
export const ASR_MODELS = {
  'tiny.en': { label: 'Fast — English', size: 118, speed: 'fastest, less accurate' },
  'base.en': { label: 'Balanced — English', size: 209, speed: 'recommended' },
  'small.en': { label: 'Accurate — English', size: 610, speed: 'slow on most servers' },
  tiny: { label: 'Fast — many languages', size: 111, speed: 'fastest, less accurate' },
  base: { label: 'Balanced — many languages', size: 198, speed: 'good for other languages' },
  small: { label: 'Accurate — many languages', size: 606, speed: 'slow on most servers' },
};
const EXTRA = [
  { id: 'vad', url: '/asr-models/silero_vad.onnx', file: 'silero_vad.onnx', size: 1 },
  { id: 'segmentation', url: '/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2', file: 'segmentation.int8.onnx', from: 'sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx', size: 7 },
  { id: 'embedding', url: '/speaker-recongition-models/nemo_en_titanet_small.onnx', file: 'speaker-embedding.onnx', size: 40 },
];

const asrFiles = id => ({
  encoder: path.join(MODELS_DIR, `whisper-${id}`, `${id}-encoder.int8.onnx`),
  decoder: path.join(MODELS_DIR, `whisper-${id}`, `${id}-decoder.int8.onnx`),
  tokens: path.join(MODELS_DIR, `whisper-${id}`, `${id}-tokens.txt`),
});

export const chosenModel = () => (ASR_MODELS[getSetting('speech_model')] ? getSetting('speech_model') : 'base.en');
const have = f => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const asrInstalled = id => Object.values(asrFiles(id)).every(have);
const extrasInstalled = () => EXTRA.every(e => have(path.join(MODELS_DIR, e.file)));

/** Model paths for the worker, or null when something is missing. */
export function modelPaths() {
  const id = chosenModel();
  if (!asrInstalled(id) || !extrasInstalled()) return null;
  return {
    asr: { ...asrFiles(id), language: id.endsWith('.en') ? 'en' : '' },
    vad: path.join(MODELS_DIR, 'silero_vad.onnx'),
    segmentation: path.join(MODELS_DIR, 'segmentation.int8.onnx'),
    embedding: path.join(MODELS_DIR, 'speaker-embedding.onnx'),
  };
}

let download = null; // { model, step, done, total, error }

export function modelsStatus() {
  return {
    chosen: chosenModel(),
    models: Object.fromEntries(Object.entries(ASR_MODELS).map(([id, m]) => [id, { ...m, installed: asrInstalled(id) }])),
    extras_installed: extrasInstalled(),
    extras_size: EXTRA.reduce((s, e) => s + e.size, 0),
    ready: !!modelPaths(),
    download,
  };
}

async function fetchTo(url, dest, onBytes) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', c => { got += c.length; onBytes?.(got, total); });
  await pipeline(body, fs.createWriteStream(dest));
}

function untar(archive, dir) {
  return new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xjf', archive, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`couldn’t unpack the model (${err.trim().slice(0, 200) || code})`))));
  });
}

/** Download a speech-to-text model (plus the shared models if missing), in the background. */
export function startDownload(id) {
  if (!ASR_MODELS[id]) throw Object.assign(new Error('Unknown model'), { status: 400 });
  if (download && !download.finished) throw Object.assign(new Error('A download is already running'), { status: 409 });
  download = { model: id, step: 'Starting…', done: 0, total: 0, finished: false, error: null };
  (async () => {
    const tmp = path.join(MODELS_DIR, `.download-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      for (const e of EXTRA) {
        const dest = path.join(MODELS_DIR, e.file);
        if (have(dest)) continue;
        download.step = e.id === 'vad' ? 'Speech detector' : 'Speaker detection';
        const file = path.join(tmp, path.basename(e.url));
        await fetchTo(BASE() + e.url, file, (d, t) => { download.done = d; download.total = t; });
        if (e.from) { await untar(file, tmp); fs.renameSync(path.join(tmp, e.from), dest); } else fs.renameSync(file, dest);
      }
      if (!asrInstalled(id)) {
        download.step = `Speech-to-text (${ASR_MODELS[id].label})`;
        const name = `sherpa-onnx-whisper-${id}`;
        const archive = path.join(tmp, `${name}.tar.bz2`);
        await fetchTo(`${BASE()}/asr-models/${name}.tar.bz2`, archive, (d, t) => { download.done = d; download.total = t; });
        download.step = 'Unpacking…';
        await untar(archive, tmp);
        const out = path.join(MODELS_DIR, `whisper-${id}`);
        fs.mkdirSync(out, { recursive: true });
        for (const f of Object.values(asrFiles(id))) fs.renameSync(path.join(tmp, name, path.basename(f)), f);
      }
      setSetting('speech_model', id);
      download = { ...download, step: 'Ready', finished: true };
    } catch (err) {
      download = { ...download, finished: true, error: err.message || String(err) };
      console.error('Speech model download failed:', err.message);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return modelsStatus();
}

export function chooseModel(id) {
  if (!ASR_MODELS[id]) throw Object.assign(new Error('Unknown model'), { status: 400 });
  if (!asrInstalled(id)) throw Object.assign(new Error('Download that model first'), { status: 400 });
  setSetting('speech_model', id);
  return modelsStatus();
}

export function removeModel(id) {
  if (!ASR_MODELS[id]) throw Object.assign(new Error('Unknown model'), { status: 400 });
  fs.rmSync(path.join(MODELS_DIR, `whisper-${id}`), { recursive: true, force: true });
  return modelsStatus();
}

fs.mkdirSync(MODELS_DIR, { recursive: true });
for (const n of fs.readdirSync(MODELS_DIR)) if (n.startsWith('.download-')) fs.rmSync(path.join(MODELS_DIR, n), { recursive: true, force: true });
