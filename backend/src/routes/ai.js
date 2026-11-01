// AI assistant API: settings, writing help (streamed), action items from a note, and
// "Ask your notes" (answers from the person's own notes, with the notes it used).
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  PROVIDERS, AiError, publicSettings, saveAccount, removeAccount, resolveAccount, streamChat, listModels, logUsage,
} from '../ai.js';

const router = Router();
router.use(requireAuth);

const limiter = rateLimit({ windowMs: 60_000, max: 40, message: 'That’s a lot of AI requests — wait a minute' });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const MAX_TEXT = 60_000; // characters of note text sent with one request

// Each workspace can be kept away from AI entirely (Settings → Workspace → Preferences).
function checkWorkspace(workspaceId, userId) {
  if (!workspaceId) return;
  const ws = db.prepare('SELECT settings FROM workspaces WHERE id=? AND user_id=?').get(workspaceId, userId);
  if (!ws) throw new AiError(404, 'Workspace not found');
  let s = {};
  try { s = JSON.parse(ws.settings || '{}'); } catch { /* none */ }
  if (s.ai === 'off') throw new AiError(403, 'AI is turned off for this workspace (Settings → Workspace → Preferences).');
}

// ───────────────────────── settings ─────────────────────────

router.get('/settings', (req, res) => res.json(publicSettings(req.user.id)));

router.put('/settings', wrap(async (req, res) => {
  const { provider, api_key, base_url, model } = req.body || {};
  saveAccount(req.user.id, { provider, api_key, base_url, model });
  res.json(publicSettings(req.user.id));
}));

router.delete('/settings/:provider', (req, res) => {
  removeAccount(req.user.id, req.params.provider);
  res.json(publicSettings(req.user.id));
});

// Models for the picker. Uses what's typed in Settings (not yet saved) when given.
router.post('/models', limiter, wrap(async (req, res) => {
  const { provider, api_key, base_url } = req.body || {};
  const acct = resolveAccount(req.user.id, { provider, api_key: api_key || undefined, base_url, model: 'x' });
  res.json({ models: await listModels(acct) });
}));

router.post('/test', limiter, wrap(async (req, res) => {
  const acct = resolveAccount(req.user.id, req.body || {});
  const text = await streamChat(acct, {
    system: 'Reply with one short, friendly sentence.',
    messages: [{ role: 'user', content: 'Say hello to the person setting you up in their notes app, Synapse.' }],
    signal: AbortSignal.timeout(60_000),
  });
  res.json({ ok: true, reply: text.trim(), provider: acct.label, model: acct.model });
}));

// ───────────────────────── streaming helper ─────────────────────────

function startStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); res.flush?.(); } catch { /* closed */ } };
  return { send, signal: controller.signal };
}

async function runStream(req, res, { acct, task, system, messages, before }) {
  const { send, signal } = startStream(req, res);
  send('meta', { provider: acct.label, model: acct.model });
  if (before) before(send);
  const charsIn = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  try {
    const text = await streamChat(acct, { system, messages, signal, onText: t => send('delta', { text: t }) });
    logUsage(req.user.id, acct, task, charsIn, text.length);
    send('done', {});
  } catch (err) {
    if (err.status !== 499) send('error', { error: err instanceof AiError ? err.message : 'Something went wrong' });
  }
  res.end();
}

// ───────────────────────── writing help ─────────────────────────

const WRITER = `You are a writing assistant built into Synapse, a personal notes app.
Reply with only the requested text, written in Markdown, ready to drop into the note: no introduction, no explanation of what you changed, no surrounding quotes or code fences.
Write in the same language as the text unless asked to translate.
Keep [[wiki links]], checklists ("- [ ]" / "- [x]"), dates like "📅 2026-11-20", tables and other Markdown exactly as they are unless the request is to change them.`;

const TONES = { professional: 'professional', friendly: 'warm and friendly', casual: 'casual and relaxed', confident: 'confident and direct', simple: 'simple, plain English' };

function instructionFor(action, opts = {}) {
  switch (action) {
    case 'improve': return 'Improve the writing: clearer, better flow, same meaning and roughly the same length.';
    case 'grammar': return 'Fix spelling, grammar and punctuation only. Change nothing else.';
    case 'shorter': return 'Make it shorter and tighter while keeping every important point.';
    case 'longer': return 'Expand it with more detail and explanation, keeping the same voice.';
    case 'summarize': return 'Summarise it as a few short bullet points.';
    case 'explain': return 'Explain it simply, as if to a smart friend who is new to the topic.';
    case 'tone': return `Rewrite it in a ${TONES[opts.tone] || 'professional'} tone. Keep the meaning.`;
    case 'translate': return `Translate it into ${String(opts.language || 'English').slice(0, 40)}. Keep the formatting.`;
    case 'continue': return 'Continue writing from where the text ends, in the same style. Reply with only the new text that comes next (a paragraph or two).';
    case 'custom': return String(opts.instruction || '').slice(0, 2000);
    default: throw new AiError(400, 'Unknown action');
  }
}

/**
 * Writing help. body: { action, text, note_title, note_text, workspace_id, tone, language, instruction }
 * `text` is what it works on (selected text, or the whole note); `note_text` gives context.
 */
router.post('/write', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  checkWorkspace(b.workspace_id, req.user.id);
  const acct = resolveAccount(req.user.id);
  const instruction = instructionFor(b.action, b);
  if (!instruction.trim()) throw new AiError(400, 'Tell the AI what to do');
  const text = String(b.text || '').slice(0, MAX_TEXT);
  const noteText = String(b.note_text || '').slice(0, MAX_TEXT);
  const title = String(b.note_title || '').slice(0, 200);
  const parts = [`Request: ${instruction}`];
  if (noteText && noteText !== text) parts.push(`The whole note, for context only (don't repeat it):\n<note title="${title.replace(/"/g, "'")}">\n${noteText}\n</note>`);
  if (text.trim()) parts.push(`${b.action === 'custom' && !b.has_selection ? 'Text to use' : 'Text to work on'}:\n<text>\n${text}\n</text>`);
  else if (title) parts.push(`(The note is called "${title}" and is empty so far.)`);
  await runStream(req, res, { acct, task: b.action, system: WRITER, messages: [{ role: 'user', content: parts.join('\n\n') }] });
}));

// ───────────────────────── action items ─────────────────────────

router.post('/tasks', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  checkWorkspace(b.workspace_id, req.user.id);
  const acct = resolveAccount(req.user.id);
  const text = String(b.text || '').slice(0, MAX_TEXT);
  if (!text.trim()) throw new AiError(400, 'This note is empty');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const system = `You find action items (to-dos) in notes such as meeting notes.
Reply with only a JSON array, no other text. Each item: {"task": "short imperative to-do", "due": "YYYY-MM-DD" or null, "who": "person's name" or null}.
Today is ${today} (${new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}). Turn relative dates like "next Friday" or "end of the month" into real dates.
Skip anything already marked done ("- [x]"). If there are no action items, reply [].`;
  const raw = await streamChat(acct, { system, messages: [{ role: 'user', content: `<note title="${String(b.note_title || '').replace(/"/g, "'")}">\n${text}\n</note>` }], signal: AbortSignal.timeout(180_000) });
  logUsage(req.user.id, acct, 'tasks', system.length + text.length, raw.length);
  const m = raw.match(/\[[\s\S]*\]/);
  let items = [];
  try { items = JSON.parse(m ? m[0] : '[]'); } catch { throw new AiError(502, 'The AI’s answer couldn’t be read — try again'); }
  items = (Array.isArray(items) ? items : []).map(x => ({
    task: String(x?.task || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    due: /^\d{4}-\d{2}-\d{2}$/.test(x?.due) ? x.due : null,
    who: x?.who ? String(x.who).trim().slice(0, 60) : null,
  })).filter(x => x.task).slice(0, 50);
  res.json({ items, provider: acct.label, model: acct.model });
}));

// ───────────────────────── ask your notes ─────────────────────────

const STOP = new Set(('a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our should so that the their them then there these they this to was we were what when where which who why will with would you your about any all also been just like more most much not only other some than too very am vs ' +
  'tell show find give list please know need want').split(' '));

function plainText(n) {
  if (n.note_type === 'note') {
    const md = n.content || '';
    if (md.trim()) return md.replace(/```synapse-diagram\n[\s\S]*?\n```/g, '[diagram]').replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '[picture]');
    return (n.rich_content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }
  return n.note_type === 'draw' ? '[Free Draw drawing]' : '[flowchart]';
}

/** The notes most likely to answer the question (full-text search, any of the words). */
function findNotes(workspaceId, question, limit = 8) {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w));
  const unique = [...new Set(words)].slice(0, 12);
  let rows = [];
  if (unique.length) {
    const match = unique.map(t => `"${t}"*`).join(' OR ');
    rows = db.prepare(`SELECT n.* FROM notes_fts JOIN notes n ON n.id = notes_fts.id
      WHERE notes_fts MATCH ? AND n.workspace_id=? AND n.deleted_at IS NULL ORDER BY rank LIMIT ?`).all(match, workspaceId, limit);
  }
  if (!rows.length) {
    // Nothing matched: fall back to the most recently edited notes.
    rows = db.prepare(`SELECT * FROM notes WHERE workspace_id=? AND deleted_at IS NULL AND note_type='note' ORDER BY updated_at DESC LIMIT 5`).all(workspaceId);
  }
  return rows;
}

router.post('/ask', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.workspace_id) throw new AiError(400, 'No workspace');
  checkWorkspace(b.workspace_id, req.user.id);
  const acct = resolveAccount(req.user.id);
  const question = String(b.question || '').trim().slice(0, 4000);
  if (!question) throw new AiError(400, 'Ask a question');
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .filter(h => h && typeof h.q === 'string' && typeof h.a === 'string');

  // Search with the question plus the previous one, so follow-ups ("and when is it?") still find the notes.
  const notes = findNotes(b.workspace_id, `${history.length ? history[history.length - 1].q + ' ' : ''}${question}`);
  let budget = 48_000;
  const blocks = [];
  const sources = [];
  for (const n of notes) {
    if (budget <= 500) break;
    const text = plainText(n).slice(0, Math.min(12_000, budget));
    budget -= text.length;
    sources.push({ id: n.id, title: n.title });
    blocks.push(`<note title="${n.title.replace(/"/g, "'")}" updated="${new Date(n.updated_at * 1000).toISOString().slice(0, 10)}">\n${text}\n</note>`);
  }
  const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const system = `You answer questions about the user's own notes in Synapse, their notes app. Today is ${today}.
Use the notes provided with each question. Be concise and specific; use Markdown (short paragraphs, bullet points).
Mention the notes you used by title as [[Note title]] — exactly as titled — so the user can open them.
If the notes don't contain the answer, say so plainly, then add a brief general answer only if it's clearly useful and say that part isn't from their notes.`;
  const messages = [];
  for (const h of history) {
    messages.push({ role: 'user', content: h.q.slice(0, 4000) });
    messages.push({ role: 'assistant', content: h.a.slice(0, 8000) || '…' });
  }
  messages.push({ role: 'user', content: `Notes that may help:\n\n${blocks.join('\n\n') || '(no notes found)'}\n\nQuestion: ${question}` });
  await runStream(req, res, { acct, task: 'ask', system, messages, before: send => send('sources', { sources }) });
}));

router.get('/providers', (req, res) => res.json({ providers: PROVIDERS }));

router.use((err, req, res, next) => {
  if (err instanceof AiError) {
    if (res.headersSent) { try { res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch { /* closed */ } return; }
    return res.status(err.status === 499 ? 400 : err.status).json({ error: err.message });
  }
  next(err);
});

export default router;
