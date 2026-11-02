// Speech work in a background thread (worker_threads), so the server stays responsive while a
// meeting is being transcribed. Uses sherpa-onnx (WebAssembly build — runs anywhere, no native libs).
//
// Tasks (workerData.task):
//   vad      — find the stretches of speech in the audio → [{ start, end }] (sample indexes)
//   asr      — speech-to-text for given stretches → [text]
//   diarize  — who spoke when → [{ start, end, speaker }] (seconds)
// Audio is a raw file of 16 kHz mono 32-bit float samples (made by ffmpeg in meetings.js).
import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx');
const RATE = 16000;
const { task, pcm, models } = workerData;
const progress = p => parentPort.postMessage({ type: 'progress', value: p });

function readSamples(startSample, count) {
  const fd = fs.openSync(pcm, 'r');
  try {
    const buf = Buffer.alloc(count * 4);
    const n = fs.readSync(fd, buf, 0, buf.length, startSample * 4);
    return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(n / 4)).slice();
  } finally { fs.closeSync(fd); }
}
const totalSamples = () => Math.floor(fs.statSync(pcm).size / 4);

function vad() {
  const v = sherpa.createVad({
    sileroVad: { model: models.vad, threshold: 0.45, minSpeechDuration: 0.25, minSilenceDuration: 0.6, maxSpeechDuration: 25, windowSize: 512 },
    sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0, bufferSizeInSeconds: 60,
  });
  const total = totalSamples();
  const out = [];
  const take = () => { while (!v.isEmpty()) { const s = v.front(); out.push({ start: s.start, end: s.start + s.samples.length }); v.pop(); } };
  const CHUNK = RATE * 30;
  for (let pos = 0; pos < total; pos += CHUNK) {
    const block = readSamples(pos, Math.min(CHUNK, total - pos));
    for (let i = 0; i + 512 <= block.length; i += 512) { v.acceptWaveform(block.subarray(i, i + 512)); take(); }
    progress(Math.min(1, (pos + CHUNK) / total));
  }
  v.flush(); take();
  return out;
}

function asr() {
  const m = models.asr;
  const rec = sherpa.createOfflineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: m.encoder, decoder: m.decoder, language: m.language || '', task: 'transcribe', tailPaddings: -1 },
      tokens: m.tokens, numThreads: 1, provider: 'cpu', debug: 0,
    },
  });
  const texts = [];
  workerData.segments.forEach((s, i) => {
    const samples = readSamples(s.start, s.end - s.start);
    const st = rec.createStream();
    st.acceptWaveform(RATE, samples);
    rec.decode(st);
    texts.push(rec.getResult(st).text.trim());
    st.free?.();
    progress((i + 1) / workerData.segments.length);
  });
  return texts;
}

function diarize() {
  const sd = sherpa.createOfflineSpeakerDiarization({
    segmentation: { pyannote: { model: models.segmentation, windowShiftRatio: 0.5 }, numThreads: 1, debug: 0 },
    embedding: { model: models.embedding, numThreads: 1, debug: 0 },
    clustering: workerData.speakers > 0 ? { numClusters: workerData.speakers, threshold: 0.5 } : { numClusters: -1, threshold: 0.6 },
    minDurationOn: 0.3, minDurationOff: 0.5,
  });
  const samples = readSamples(0, totalSamples());
  progress(0.1);
  return sd.process(samples).map(d => ({ start: d.start, end: d.end, speaker: d.speaker }));
}

try {
  const result = task === 'vad' ? vad() : task === 'asr' ? asr() : diarize();
  parentPort.postMessage({ type: 'done', result });
} catch (err) {
  parentPort.postMessage({ type: 'error', error: String(err?.message || err) });
}
