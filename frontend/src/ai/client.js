// AI assistant: talking to Synapse's /api/ai (which talks to the person's chosen AI).
// Replies stream in piece by piece, so text appears as it's written.
import api from '../api';

function token() {
  try { return JSON.parse(localStorage.getItem('synapse-store') || '{}')?.state?.token || null; } catch { return null; }
}

export const getAiSettings = () => api.get('/ai/settings').then(r => r.data);
export const saveAiSettings = body => api.put('/ai/settings', body).then(r => r.data);
export const removeAiAccount = provider => api.delete(`/ai/settings/${provider}`).then(r => r.data);
export const listAiModels = body => api.post('/ai/models', body, { timeout: 30_000 }).then(r => r.data.models);
export const testAi = body => api.post('/ai/test', body, { timeout: 90_000 }).then(r => r.data);
export const findActionItems = body => api.post('/ai/tasks', body, { timeout: 200_000 }).then(r => r.data);

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || (err?.response ? fallback : err?.message === 'Network Error' ? 'You’re offline — the AI assistant needs a connection' : err?.message || fallback);

/** Today's date on this device, as YYYY-MM-DD (so "next Friday" means the right day). */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * POST to a streaming AI endpoint. Handlers: onMeta({provider, model}), onSources([...]),
 * onText(chunk). Resolves with the full text; rejects with an Error whose message is readable.
 */
export async function streamAi(path, body, { signal, onMeta, onSources, onText } = {}) {
  let res;
  try {
    res = await fetch(`/api/ai/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('You’re offline — the AI assistant needs a connection');
  }
  if (!res.ok) {
    let msg = 'Something went wrong';
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let type = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      const d = JSON.parse(data);
      if (type === 'delta') { full += d.text; onText?.(d.text, full); }
      else if (type === 'meta') onMeta?.(d);
      else if (type === 'sources') onSources?.(d.sources);
      else if (type === 'error') throw new Error(d.error);
    }
  }
  return full;
}
