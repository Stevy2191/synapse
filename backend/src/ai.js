// AI assistant: each person connects their own AI account (Claude, ChatGPT, Grok, Gemini, a local
// Ollama / LM Studio, or any OpenAI-compatible service). Keys are stored encrypted and only ever
// used here on the server — they never go back to the browser.
//
// Two ways of talking to providers:
//   • Claude — the official Anthropic SDK (Messages API, streaming).
//   • Everything else — the OpenAI-compatible "chat completions" API, which all of them offer.
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db/index.js';
import { JWT_SECRET } from './config.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_accounts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    api_key_enc TEXT,
    base_url TEXT,
    model TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, provider)
  );
  CREATE TABLE IF NOT EXISTS ai_active (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    task TEXT,
    chars_in INTEGER NOT NULL DEFAULT 0,
    chars_out INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);
`);

// ───────────────────────── providers ─────────────────────────

export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)', protocol: 'anthropic', needsKey: true, defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…',
  },
  openai: {
    label: 'ChatGPT (OpenAI)', protocol: 'openai', needsKey: true, baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…',
  },
  xai: {
    label: 'Grok (xAI)', protocol: 'openai', needsKey: true, baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai', keyHint: 'xai-…',
  },
  gemini: {
    label: 'Gemini (Google)', protocol: 'openai', needsKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…',
  },
  ollama: {
    label: 'Ollama (runs on your own computer)', protocol: 'openai', needsKey: false, editableUrl: true,
    baseUrl: 'http://localhost:11434/v1', urlHint: 'http://<computer-ip>:11434/v1',
  },
  lmstudio: {
    label: 'LM Studio (runs on your own computer)', protocol: 'openai', needsKey: false, editableUrl: true,
    baseUrl: 'http://localhost:1234/v1', urlHint: 'http://<computer-ip>:1234/v1',
  },
  custom: {
    label: 'Other (OpenAI-compatible, e.g. OpenRouter)', protocol: 'openai', needsKey: false, editableUrl: true,
    baseUrl: '', urlHint: 'https://openrouter.ai/api/v1',
  },
};

// Claude models that accept server-side refusal fallbacks (re-run on another model if declined).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export class AiError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ───────────────────────── encrypted keys ─────────────────────────

const KEY = crypto.createHash('sha256').update(`synapse-ai-keys:${JWT_SECRET}`).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join(':');
}
function decrypt(blob) {
  if (!blob) return null;
  try {
    const [iv, tag, enc] = blob.split(':').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; } // server secret changed: the person re-enters their key
}

/** The key that protects saved AI keys (included in password-protected backups). */
export const aiKeyHex = () => KEY.toString('hex');

/** After restoring a backup made on a server with a different secret: re-protect the AI keys. */
export function reencryptAiKeys(oldKeyHex) {
  const old = Buffer.from(String(oldKeyHex || ''), 'hex');
  if (old.length !== 32 || old.equals(KEY)) return 0;
  let n = 0;
  for (const r of db.prepare('SELECT rowid, api_key_enc FROM ai_accounts WHERE api_key_enc IS NOT NULL').all()) {
    try {
      const [iv, tag, enc] = r.api_key_enc.split(':').map(s => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', old, iv);
      d.setAuthTag(tag);
      const text = Buffer.concat([d.update(enc), d.final()]).toString('utf8');
      db.prepare('UPDATE ai_accounts SET api_key_enc=? WHERE rowid=?').run(encrypt(text), r.rowid);
      n++;
    } catch { /* already readable here, or damaged */ }
  }
  return n;
}

// ───────────────────────── accounts ─────────────────────────

export function cleanBaseUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url).trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch { return null; }
}

/** Settings as the browser sees them (no keys — just whether one is saved). */
export function publicSettings(userId) {
  const active = db.prepare('SELECT provider FROM ai_active WHERE user_id=?').get(userId)?.provider || null;
  const rows = db.prepare('SELECT provider, api_key_enc, base_url, model, updated_at FROM ai_accounts WHERE user_id=?').all(userId);
  const accounts = {};
  for (const r of rows) {
    const key = decrypt(r.api_key_enc);
    accounts[r.provider] = {
      has_key: !!key, key_hint: key ? `…${key.slice(-4)}` : '', key_unreadable: !!r.api_key_enc && !key,
      base_url: r.base_url || '', model: r.model || '', updated_at: r.updated_at,
    };
  }
  const month = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(chars_in),0) AS cin, COALESCE(SUM(chars_out),0) AS cout
    FROM ai_usage WHERE user_id=? AND created_at > unixepoch() - 30*86400`).get(userId);
  return {
    active, accounts,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { ...p }])),
    usage_30d: { requests: month.n, chars_in: month.cin, chars_out: month.cout },
  };
}

export function saveAccount(userId, { provider, api_key, base_url, model, activate = true }) {
  const p = PROVIDERS[provider];
  if (!p) throw new AiError(400, 'Unknown AI provider');
  const existing = db.prepare('SELECT * FROM ai_accounts WHERE user_id=? AND provider=?').get(userId, provider);
  let keyEnc = existing?.api_key_enc || null;
  if (api_key !== undefined) {
    const k = String(api_key || '').trim();
    if (k.length > 500 || /\s/.test(k)) throw new AiError(400, 'That key doesn’t look right');
    keyEnc = k ? encrypt(k) : null;
  }
  let url = existing?.base_url || null;
  if (base_url !== undefined) {
    const u = cleanBaseUrl(base_url);
    if (u === null) throw new AiError(400, 'The address must start with http:// or https://');
    url = u || null;
  }
  const m = model !== undefined ? String(model || '').trim().slice(0, 120) || null : existing?.model || null;
  db.prepare(`INSERT INTO ai_accounts (user_id, provider, api_key_enc, base_url, model, updated_at) VALUES (?,?,?,?,?,unixepoch())
    ON CONFLICT(user_id, provider) DO UPDATE SET api_key_enc=excluded.api_key_enc, base_url=excluded.base_url, model=excluded.model, updated_at=unixepoch()`)
    .run(userId, provider, keyEnc, url, m);
  if (activate) db.prepare('INSERT INTO ai_active (user_id, provider) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider').run(userId, provider);
}

export function removeAccount(userId, provider) {
  db.prepare('DELETE FROM ai_accounts WHERE user_id=? AND provider=?').run(userId, provider);
  const active = db.prepare('SELECT provider FROM ai_active WHERE user_id=?').get(userId)?.provider;
  if (active === provider) db.prepare('DELETE FROM ai_active WHERE user_id=?').run(userId);
}

/** The connection to use for a request: active provider, or an explicit one (for testing). */
export function resolveAccount(userId, override = {}) {
  const provider = override.provider || db.prepare('SELECT provider FROM ai_active WHERE user_id=?').get(userId)?.provider;
  if (!provider) throw new AiError(400, 'No AI is set up yet — add one in Settings → AI assistant');
  const p = PROVIDERS[provider];
  if (!p) throw new AiError(400, 'Unknown AI provider');
  const row = db.prepare('SELECT * FROM ai_accounts WHERE user_id=? AND provider=?').get(userId, provider) || {};
  const apiKey = override.api_key ? String(override.api_key).trim() : decrypt(row.api_key_enc);
  const baseUrl = (override.base_url !== undefined ? cleanBaseUrl(override.base_url) : null) || row.base_url || p.baseUrl || '';
  const model = (override.model !== undefined ? String(override.model || '').trim() : '') || row.model || p.defaultModel || '';
  if (p.needsKey && !apiKey) throw new AiError(400, `Add your ${p.label} key in Settings → AI assistant`);
  if (p.protocol === 'openai' && !baseUrl) throw new AiError(400, 'Add the address of your AI service in Settings → AI assistant');
  return { provider, protocol: p.protocol, label: p.label, apiKey, baseUrl, model };
}

export function logUsage(userId, acct, task, charsIn, charsOut) {
  db.prepare('INSERT INTO ai_usage (user_id, provider, model, task, chars_in, chars_out) VALUES (?,?,?,?,?,?)')
    .run(userId, acct.provider, acct.model, task, charsIn, charsOut);
}

// ───────────────────────── talking to providers ─────────────────────────

function friendly(err, acct) {
  const status = err?.status || err?.statusCode;
  const raw = String(err?.error?.error?.message || err?.message || err || '').slice(0, 300);
  if (status === 401 || status === 403) return new AiError(400, `${acct.label} didn’t accept the key. Check it in Settings → AI assistant.`);
  if (status === 404) return new AiError(400, `${acct.label} doesn’t know the model “${acct.model}”. Pick another in Settings → AI assistant.`);
  if (status === 429) return new AiError(429, `${acct.label} says you’ve hit a limit (too many requests or out of credit). ${raw}`);
  if (err?.name === 'AbortError') return new AiError(499, 'Stopped');
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|EAI_AGAIN|ETIMEDOUT/i.test(raw + (err?.cause?.code || ''))) {
    return new AiError(502, `Couldn’t reach ${acct.label}${acct.baseUrl ? ` at ${acct.baseUrl}` : ''}. Is it running, and can the Synapse server reach it?`);
  }
  return new AiError(status && status < 500 ? 400 : 502, `${acct.label}: ${raw || 'something went wrong'}`);
}

/**
 * Stream a reply. `onText(chunk)` is called as text arrives. Resolves with the full text.
 * messages: [{ role: 'user'|'assistant', content: string }]
 */
export async function streamChat(acct, { system, messages, signal, onText }) {
  if (!acct.model) throw new AiError(400, 'Pick a model in Settings → AI assistant');
  let full = '';
  try {
    if (acct.protocol === 'anthropic') {
      const client = new Anthropic({ apiKey: acct.apiKey, maxRetries: 1 });
      const params = { model: acct.model, max_tokens: 64000, system, messages };
      // Current Claude models: if a safety check declines, re-run on a fallback model instead of failing.
      const stream = FALLBACK_MODELS.has(acct.model)
        ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
        : client.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          full += event.delta.text;
          onText?.(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new AiError(400, 'Claude declined to help with this request.');
      return full;
    }
    // OpenAI-compatible
    const res = await fetch(`${acct.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...(acct.apiKey ? { Authorization: `Bearer ${acct.apiKey}` } : {}) },
      body: JSON.stringify({ model: acct.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 200); } catch { /* not JSON */ }
      throw Object.assign(new Error(msg || res.statusText), { status: res.status });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return full;
        try {
          const j = JSON.parse(data);
          if (j.error) throw Object.assign(new Error(j.error.message || 'error'), { status: 400 });
          const t = j.choices?.[0]?.delta?.content;
          if (t) { full += t; onText?.(t); }
        } catch (e) { if (e.status) throw e; }
      }
    }
    return full;
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw friendly(err, acct);
  }
}

/** The models this account can use (for the picker in Settings). */
export async function listModels(acct) {
  try {
    if (acct.protocol === 'anthropic') {
      const client = new Anthropic({ apiKey: acct.apiKey, maxRetries: 1 });
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    }
    const res = await fetch(`${acct.baseUrl}/models`, {
      headers: acct.apiKey ? { Authorization: `Bearer ${acct.apiKey}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Object.assign(new Error(res.statusText), { status: res.status });
    const j = await res.json();
    return (j.data || j.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw friendly(err, acct);
  }
}
