// "Ask AI": ask questions and get answers from your own notes, with the notes it used as links.
// The conversation lives on this page only (nothing is saved); follow-up questions keep context.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Square, PanelLeft, FileText, Trash2, Settings2, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useStore } from '../../stores/useStore';
import { workspaceSettings } from '../Avatar';
import { getWorkspaceNotes, openNote } from '../../offline/sync';
import { streamAi, getAiSettings, localToday } from '../../ai/client';

const SUGGESTIONS = [
  'What did we decide in my last meeting?',
  'What tasks are due this week?',
  'Summarise everything I wrote about vacation',
  'What are my open questions about the project?',
];

function renderAnswer(md) {
  const withLinks = (md || '').replace(/\[\[([^\[\]\n]+)\]\]/g, (m, t) => {
    const title = t.split('|')[0].trim();
    return `<a href="#" class="ask-notelink" data-note="${title.replace(/"/g, '&quot;')}">📄 ${t.split('|').pop().trim()}</a>`;
  });
  return DOMPurify.sanitize(marked.parse(withLinks, { gfm: true, breaks: true }), { ADD_ATTR: ['data-note'] });
}

let conversation = []; // kept while switching pages (until the app is reloaded)

export default function AskView() {
  const workspace = useStore(s => s.activeWorkspace);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const [items, setItems] = useState(conversation); // [{ q, a, sources, error, done }]
  const [q, setQ] = useState('');
  const [setup, setSetup] = useState(null);
  const ctrl = useRef(null);
  const scroller = useRef(null);
  const input = useRef(null);
  const allowed = workspaceSettings(workspace).ai !== 'off';

  useEffect(() => { conversation = items; }, [items]);
  useEffect(() => { getAiSettings().then(setSetup).catch(() => setSetup({})); input.current?.focus(); return () => ctrl.current?.abort(); }, []);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [items]);

  const busy = items.some(i => !i.done);
  const configured = setup?.active && setup.accounts?.[setup.active];

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy || !workspace) return;
    setQ('');
    const history = items.filter(i => i.done && !i.error && i.a).map(i => ({ q: i.q, a: i.a }));
    const index = items.length;
    setItems(list => [...list, { q: text, a: '', sources: [], done: false }]);
    const update = patch => setItems(list => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    const c = new AbortController();
    ctrl.current = c;
    try {
      await streamAi('ask', { workspace_id: workspace.id, question: text, history, today: localToday() }, {
        signal: c.signal,
        onSources: sources => update({ sources }),
        onText: (t, full) => update({ a: full }),
      });
      update({ done: true });
    } catch (err) {
      update({ done: true, ...(err.name === 'AbortError' ? { stopped: true } : { error: err.message }) });
    }
    ctrl.current = null;
  };

  const openByTitle = async (title) => {
    const all = await getWorkspaceNotes(workspace.id);
    const n = all.find(x => x.title.toLowerCase() === String(title).toLowerCase());
    if (!n) { toast(`No note called “${title}” here`); return; }
    await openNote(n.id);
    useStore.getState().setView('editor');
  };

  const onAnswerClick = e => {
    const a = e.target.closest('.ask-notelink');
    if (a) { e.preventDefault(); openByTitle(a.getAttribute('data-note')); }
  };

  return (
    <div className="ask-view">
      <div className="ask-head">
        {!sidebarOpen && <button className="btn-ghost" onClick={() => useStore.getState().setSidebarOpen(true)} title="Show sidebar"><PanelLeft size={16} /></button>}
        <Sparkles size={18} style={{ color: 'var(--accent)' }} />
        <h2>Ask AI</h2>
        <span className="ask-sub">about your notes in {workspace?.name}</span>
        <span style={{ flex: 1 }} />
        {configured && <span className="ai-model">{setup.providers[setup.active].label.split(' (')[0]} · {setup.accounts[setup.active].model}</span>}
        {items.length > 0 && <button className="btn-ghost" onClick={() => { ctrl.current?.abort(); setItems([]); }} title="Start over"><Trash2 size={14} /><span className="hide-narrow">Clear</span></button>}
      </div>

      <div className="ask-scroll" ref={scroller}>
        {!allowed ? (
          <div className="ask-empty"><p>AI is turned off for this workspace. You can turn it on in <b>Settings → Workspace → Preferences</b>.</p></div>
        ) : setup && !configured ? (
          <div className="ask-empty">
            <Sparkles size={34} style={{ color: 'var(--accent)' }} />
            <p>Connect your AI to ask questions about your notes — Claude, ChatGPT, Grok, Gemini, or one running on your own computer.</p>
            <button className="export-go" onClick={() => useStore.getState().setSettingsOpen('ai')}><Settings2 size={14} style={{ verticalAlign: -2 }} /> Set up AI</button>
          </div>
        ) : items.length === 0 ? (
          <div className="ask-empty">
            <Sparkles size={34} style={{ color: 'var(--accent)' }} />
            <p>Ask anything about your notes. The AI reads the notes that match your question and tells you which ones it used.</p>
            <div className="ask-suggestions">
              {SUGGESTIONS.map(s => <button key={s} className="ai-chip" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        ) : items.map((it, i) => (
          <div key={i} className="ask-turn">
            <div className="ask-q">{it.q}</div>
            <div className="ask-a">
              {it.error ? <div className="ai-error">⚠️ {it.error}</div>
                : <div className="ask-answer" onClick={onAnswerClick} dangerouslySetInnerHTML={{ __html: renderAnswer(it.a) || (it.done ? '<p><em>(no answer)</em></p>' : '') }} />}
              {!it.done && <span className="ai-dots"><i /><i /><i /></span>}
              {it.stopped && <div className="ask-note">Stopped.</div>}
              {it.sources?.length > 0 && it.done && (
                <div className="ask-sources">
                  <span>Looked at:</span>
                  {it.sources.map(s => (
                    <button key={s.id} className="ask-source" onClick={async () => { await openNote(s.id); useStore.getState().setView('editor'); }}><FileText size={12} /> {s.title}</button>
                  ))}
                </div>
              )}
              {it.done && it.a && !it.error && (
                <button className="btn-ghost ask-copy" onClick={() => { navigator.clipboard?.writeText(it.a); toast.success('Copied'); }}><Copy size={12} /> Copy</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {allowed && configured && (
        <div className="ask-input">
          <textarea ref={input} rows={1} value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about your notes…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          {busy
            ? <button className="chat-send" onClick={() => ctrl.current?.abort()} title="Stop"><Square size={14} /></button>
            : <button className="chat-send" onClick={() => ask()} disabled={!q.trim()} title="Ask (Enter)"><Send size={15} /></button>}
        </div>
      )}
    </div>
  );
}
