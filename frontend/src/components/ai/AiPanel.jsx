// The AI window on a note: pick an action (improve, fix grammar, translate, continue…) or type a
// request; the reply streams in as a preview, then Replace / Insert below / Copy. "Find action
// items" turns meeting notes into checklist tasks with due dates.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Send, Square, RotateCcw, Copy, Replace, ArrowDownToLine, ListChecks, ChevronDown, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DOMPurify from 'dompurify';
import { markdownToHtml } from '../editor/convert';
import { useStore } from '../../stores/useStore';
import { streamAi, findActionItems, getAiSettings, errorText, localToday } from '../../ai/client';

const ACTIONS = [
  { id: 'improve', label: 'Improve writing' },
  { id: 'grammar', label: 'Fix spelling & grammar' },
  { id: 'shorter', label: 'Make shorter' },
  { id: 'longer', label: 'Make longer' },
  { id: 'summarize', label: 'Summarise' },
  { id: 'explain', label: 'Explain' },
];
const TONES = [['professional', 'Professional'], ['friendly', 'Friendly'], ['casual', 'Casual'], ['confident', 'Confident'], ['simple', 'Simpler']];
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Hindi'];

let settingsCache = null;

/**
 * target: { scope: 'selection'|'note'|'cursor', text, noteText }
 * onApply(markdown, how) — how: 'replace' | 'below' | 'end'
 */
export default function AiPanel({ target, note, onApply, onClose }) {
  const workspace = useStore(s => s.activeWorkspace);
  const [prompt, setPrompt] = useState('');
  const [menu, setMenu] = useState(null); // 'tone' | 'translate'
  const [run, setRun] = useState(null);   // { label, text, done, error }
  const [meta, setMeta] = useState(null);
  const [tasks, setTasks] = useState(null); // { items: [...], picked: Set }
  const [setup, setSetup] = useState(settingsCache);
  const ctrl = useRef(null);
  const input = useRef(null);
  const last = useRef(null);

  useEffect(() => {
    getAiSettings().then(d => { settingsCache = d; setSetup(d); }).catch(() => {});
    setTimeout(() => input.current?.focus(), 30);
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.ai-menu')) { e.preventDefault(); stop(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); ctrl.current?.abort(); };
  }, []);

  const hasSelection = target.scope === 'selection';
  const scopeLabel = hasSelection ? `Selected text · ${target.text.trim().split(/\s+/).length} words` : target.scope === 'cursor' ? 'At the cursor' : 'The whole note';
  const configured = setup?.active && setup.accounts?.[setup.active];

  function stop() { ctrl.current?.abort(); ctrl.current = null; }

  async function go(action, extra = {}, label) {
    stop();
    setMenu(null); setTasks(null);
    const request = { action, ...extra };
    last.current = { action, extra, label };
    // Writing from scratch / continuing works on the whole note; other actions on the selection (or whole note).
    const text = action === 'continue' ? target.noteText : target.text;
    if (!text.trim() && !['custom', 'continue'].includes(action)) { toast('This note is empty — write something first, or type a request'); return; }
    setRun({ label: label || ACTIONS.find(a => a.id === action)?.label || action, text: '', done: false, error: '' });
    const c = new AbortController();
    ctrl.current = c;
    try {
      await streamAi('write', {
        ...request, text, has_selection: hasSelection, note_title: note.title, note_text: target.noteText, workspace_id: workspace?.id,
      }, {
        signal: c.signal,
        onMeta: setMeta,
        onText: (t, full) => setRun(r => (r ? { ...r, text: full } : r)),
      });
      setRun(r => (r ? { ...r, done: true } : r));
    } catch (err) {
      if (err.name === 'AbortError') setRun(r => (r ? { ...r, done: true, stopped: true } : r));
      else setRun(r => ({ ...(r || {}), done: true, error: err.message }));
    } finally { if (ctrl.current === c) ctrl.current = null; }
  }

  async function actionItems() {
    stop();
    setMenu(null); setRun(null);
    if (!target.noteText.trim()) { toast('This note is empty'); return; }
    setTasks({ loading: true });
    try {
      const r = await findActionItems({ text: target.noteText, note_title: note.title, workspace_id: workspace?.id, today: localToday() });
      setMeta({ provider: r.provider, model: r.model });
      setTasks({ items: r.items, picked: new Set(r.items.map((_, i) => i)) });
    } catch (err) { setTasks({ error: errorText(err) }); }
  }

  const submit = () => {
    const p = prompt.trim();
    if (!p) return;
    go('custom', { instruction: p }, p.length > 60 ? `${p.slice(0, 60)}…` : p);
  };

  const preview = useMemo(() => (run?.text ? DOMPurify.sanitize(markdownToHtml(run.text)) : ''), [run?.text]);

  const addTasks = () => {
    const chosen = tasks.items.filter((_, i) => tasks.picked.has(i));
    if (!chosen.length) return;
    const lines = chosen.map(t => `- [ ] ${t.task}${t.who ? ` (${t.who})` : ''}${t.due ? ` 📅 ${t.due}` : ''}`);
    onApply(`## Action items\n\n${lines.join('\n')}`, 'end');
    toast.success(`Added ${chosen.length} task${chosen.length === 1 ? '' : 's'} — they’ll show in Tasks`);
    onClose();
  };

  return (
    <div className="ai-panel fade-in" role="dialog" aria-label="AI assistant">
      <div className="ai-panel-head">
        <Sparkles size={15} style={{ color: 'var(--accent)' }} />
        <span className="ai-panel-title">AI assistant</span>
        <span className="ai-scope">{scopeLabel}</span>
        <span style={{ flex: 1 }} />
        {(meta || configured) && (
          <span className="ai-model" title="The AI service your text is sent to">
            {meta ? `${meta.provider.split(' (')[0]} · ${meta.model}` : `${setup.providers[setup.active].label.split(' (')[0]} · ${setup.accounts[setup.active].model}`}
          </span>
        )}
        <button className="btn-ghost" onClick={() => { stop(); onClose(); }} title="Close (Esc)"><X size={15} /></button>
      </div>

      {setup && !configured ? (
        <div className="ai-setup">
          <p>Connect your AI first — Claude, ChatGPT, Grok, Gemini, or one running on your own computer.</p>
          <button className="export-go" onClick={() => { onClose(); useStore.getState().setSettingsOpen('ai'); }}><Settings2 size={14} style={{ verticalAlign: -2 }} /> Set up AI</button>
        </div>
      ) : (
        <>
          {!run && !tasks && (
            <div className="ai-actions">
              {ACTIONS.map(a => <button key={a.id} type="button" className="ai-chip" onClick={() => go(a.id)}>{a.label}</button>)}
              <span style={{ position: 'relative' }}>
                <button type="button" className="ai-chip" onClick={() => setMenu(m => (m === 'tone' ? null : 'tone'))}>Change tone <ChevronDown size={12} /></button>
                {menu === 'tone' && (
                  <div className="ai-menu">{TONES.map(([id, l]) => <button key={id} type="button" onClick={() => go('tone', { tone: id }, `Tone: ${l}`)}>{l}</button>)}</div>
                )}
              </span>
              <span style={{ position: 'relative' }}>
                <button type="button" className="ai-chip" onClick={() => setMenu(m => (m === 'translate' ? null : 'translate'))}>Translate <ChevronDown size={12} /></button>
                {menu === 'translate' && (
                  <div className="ai-menu">{LANGUAGES.map(l => <button key={l} type="button" onClick={() => go('translate', { language: l }, `Translate to ${l}`)}>{l}</button>)}</div>
                )}
              </span>
              <button type="button" className="ai-chip" onClick={() => go('continue', {}, 'Continue writing')}>Continue writing</button>
              <button type="button" className="ai-chip accent" onClick={actionItems}><ListChecks size={13} /> Find action items</button>
            </div>
          )}

          {run && (
            <div className="ai-result">
              <div className="ai-result-label">{run.label}{!run.done && <span className="ai-dots"><i /><i /><i /></span>}</div>
              {run.error ? <div className="ai-error">⚠️ {run.error}</div>
                : <div className="ai-preview" dangerouslySetInnerHTML={{ __html: preview || (run.done ? '<p><em>(no reply)</em></p>' : '') }} />}
              <div className="ai-result-actions">
                {!run.done ? (
                  <button type="button" className="btn-ghost" onClick={stop}><Square size={13} /> Stop</button>
                ) : (
                  <>
                    {!run.error && run.text && hasSelection && last.current?.action !== 'continue' && (
                      <button type="button" className="export-go" onClick={() => { onApply(run.text, 'replace'); onClose(); }}><Replace size={14} style={{ verticalAlign: -2 }} /> Replace selection</button>
                    )}
                    {!run.error && run.text && (
                      <button type="button" className={hasSelection && last.current?.action !== 'continue' ? 'btn-ghost' : 'export-go'} onClick={() => { onApply(run.text, 'below'); onClose(); }}>
                        <ArrowDownToLine size={14} style={{ verticalAlign: -2 }} /> {target.scope === 'note' && last.current?.action !== 'continue' ? 'Add to end of note' : 'Insert below'}
                      </button>
                    )}
                    {!run.error && run.text && <button type="button" className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(run.text); toast.success('Copied'); }}><Copy size={13} /> Copy</button>}
                    <button type="button" className="btn-ghost" onClick={() => go(last.current.action, last.current.extra, last.current.label)}><RotateCcw size={13} /> Try again</button>
                    <button type="button" className="btn-ghost" onClick={() => setRun(null)}>Back</button>
                  </>
                )}
              </div>
            </div>
          )}

          {tasks && (
            <div className="ai-result">
              <div className="ai-result-label">Action items{tasks.loading && <span className="ai-dots"><i /><i /><i /></span>}</div>
              {tasks.error && <div className="ai-error">⚠️ {tasks.error}</div>}
              {tasks.items && !tasks.items.length && <p className="ai-empty">No action items found in this note.</p>}
              {tasks.items?.length > 0 && (
                <div className="ai-tasks">
                  {tasks.items.map((t, i) => (
                    <label key={i} className="ai-task">
                      <input type="checkbox" checked={tasks.picked.has(i)} onChange={() => setTasks(s => {
                        const picked = new Set(s.picked);
                        picked.has(i) ? picked.delete(i) : picked.add(i);
                        return { ...s, picked };
                      })} />
                      <span className="ai-task-text">{t.task}{t.who && <span className="ai-task-who"> · {t.who}</span>}</span>
                      <input type="date" value={t.due || ''} onChange={e => setTasks(s => ({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, due: e.target.value || null } : x)) }))} />
                    </label>
                  ))}
                </div>
              )}
              <div className="ai-result-actions">
                {tasks.items?.length > 0 && <button type="button" className="export-go" onClick={addTasks} disabled={!tasks.picked.size}>Add {tasks.picked.size} to note</button>}
                {!tasks.loading && <button type="button" className="btn-ghost" onClick={actionItems}><RotateCcw size={13} /> Try again</button>}
                {!tasks.loading && <button type="button" className="btn-ghost" onClick={() => setTasks(null)}>Back</button>}
              </div>
            </div>
          )}

          <div className="ai-input">
            <input ref={input} value={prompt} onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              placeholder={hasSelection ? 'Tell the AI what to do with the selected text…' : 'Ask the AI to write something… (e.g. “a packing list for a beach trip”)'} />
            <button type="button" className="chat-send" onClick={submit} disabled={!prompt.trim()} title="Send (Enter)"><Send size={15} /></button>
          </div>
        </>
      )}
    </div>
  );
}
