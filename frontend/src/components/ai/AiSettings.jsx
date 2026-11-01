// Settings → AI assistant: connect your own AI (Claude, ChatGPT, Grok, Gemini, Ollama, LM Studio,
// or any OpenAI-compatible service). Only you use your key; it's stored encrypted on the server.
import { useEffect, useState } from 'react';
import { Sparkles, ExternalLink, RefreshCw, Check, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAiSettings, saveAiSettings, removeAiAccount, listAiModels, testAi, errorText } from '../../ai/client';

const ORDER = ['anthropic', 'openai', 'xai', 'gemini', 'ollama', 'lmstudio', 'custom'];

export default function AiSettings({ styles }) {
  const { heading, lead, section, labelStyle, hint, field, primary, secondary } = styles;
  const [data, setData] = useState(null);
  const [provider, setProvider] = useState('anthropic');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState(null);
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(null);

  const load = async () => {
    try {
      const d = await getAiSettings();
      setData(d);
      const p = d.active || 'anthropic';
      pick(p, d);
    } catch (err) { toast.error(errorText(err)); }
  };
  useEffect(() => { load(); }, []);

  function pick(p, d = data) {
    setProvider(p);
    const acct = d?.accounts?.[p];
    const def = d?.providers?.[p];
    setKey('');
    setBaseUrl(acct?.base_url || def?.baseUrl || '');
    setModel(acct?.model || def?.defaultModel || '');
    setModels(null);
    setTest(null);
  }

  if (!data) return <div><h3 style={heading}>AI assistant</h3><p style={lead}>Loading…</p></div>;
  const def = data.providers[provider];
  const acct = data.accounts[provider];
  const isActive = data.active === provider;

  const unsaved = { provider, ...(key.trim() ? { api_key: key.trim() } : {}), ...(def.editableUrl ? { base_url: baseUrl } : {}) };

  const loadModels = async () => {
    setBusy('models');
    try {
      const list = await listAiModels(unsaved);
      setModels(list);
      if (!list.length) toast('No models found', { icon: 'ℹ️' });
      else if (!model || !list.includes(model)) setModel(list.includes(def.defaultModel) ? def.defaultModel : list[0]);
    } catch (err) { toast.error(errorText(err), { duration: 7000 }); }
    setBusy('');
  };

  const save = async () => {
    if (def.needsKey && !key.trim() && !acct?.has_key) { toast.error('Paste your API key first'); return; }
    if (!model.trim()) { toast.error('Choose a model (press “Load models”)'); return; }
    setBusy('save');
    try {
      const d = await saveAiSettings({ ...unsaved, model: model.trim() });
      setData(d);
      setKey('');
      toast.success(`AI assistant is set up with ${def.label}`);
    } catch (err) { toast.error(errorText(err)); }
    setBusy('');
  };

  const runTest = async () => {
    setBusy('test'); setTest(null);
    try {
      const r = await testAi({ ...unsaved, model: model.trim() || undefined });
      setTest({ ok: true, text: r.reply, model: r.model });
    } catch (err) { setTest({ ok: false, text: errorText(err) }); }
    setBusy('');
  };

  const remove = async () => {
    if (!confirm(`Remove your ${def.label} connection${acct?.has_key ? ' and its key' : ''}?`)) return;
    try { const d = await removeAiAccount(provider); setData(d); pick(provider, d); toast.success('Removed'); } catch (err) { toast.error(errorText(err)); }
  };

  return (
    <div>
      <h3 style={heading}>AI assistant</h3>
      <p style={lead}>Connect your own AI to get writing help in notes, find action items, and ask questions about your notes. Only you use this connection.</p>

      {data.active && (
        <section style={{ ...section, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={18} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            <b>In use:</b> {data.providers[data.active]?.label} · <code>{data.accounts[data.active]?.model}</code>
            <div style={{ ...hint, marginTop: 2 }}>Last 30 days: {data.usage_30d.requests} requests</div>
          </div>
        </section>
      )}

      <section style={section}>
        <label style={labelStyle}>AI service</label>
        <div className="ai-provider-grid">
          {ORDER.map(p => (
            <button key={p} type="button" className={`ai-provider${provider === p ? ' on' : ''}`} onClick={() => pick(p)}>
              <span>{data.providers[p].label}</span>
              {data.active === p && <span className="ai-provider-tag">In use</span>}
              {data.active !== p && data.accounts[p] && <span className="ai-provider-tag muted">Saved</span>}
            </button>
          ))}
        </div>
      </section>

      <section style={section}>
        <label style={labelStyle}>{def.label}</label>

        {(def.needsKey || ['custom', 'ollama', 'lmstudio'].includes(provider)) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
              API key {!def.needsKey && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(only if your service needs one)</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} style={field}
                placeholder={acct?.has_key ? `Saved (${acct.key_hint}) — paste a new key to replace it` : def.keyHint ? `Paste your key (${def.keyHint})` : 'Paste your key'} />
            </div>
            {acct?.key_unreadable && <p style={{ ...hint, color: 'var(--danger)' }}>The saved key can’t be read any more (the server’s secret changed). Paste it again.</p>}
            {def.keyUrl && (
              <p style={hint}>Get a key at <a href={def.keyUrl} target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>{def.keyUrl.replace(/^https:\/\//, '')} <ExternalLink size={10} /></a>. You pay that service for what you use.</p>
            )}
          </div>
        )}

        {def.editableUrl && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>Address</div>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={def.urlHint} style={{ ...field, width: '100%' }} />
            <p style={hint}>
              {provider === 'custom' ? 'The service’s OpenAI-compatible address (ends in /v1).'
                : <>Synapse runs in Docker, so <code>localhost</code> means the Synapse container itself. Use the IP of the computer running {provider === 'ollama' ? 'Ollama' : 'LM Studio'}, e.g. <code>{def.urlHint}</code>.</>}
            </p>
          </div>
        )}

        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>Model</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {models?.length ? (
            <select value={model} onChange={e => setModel(e.target.value)} style={{ ...field, flex: 1 }}>
              {!models.includes(model) && model && <option value={model}>{model}</option>}
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="Press “Load models”, or type a model name" style={field} />
          )}
          <button type="button" style={secondary} onClick={loadModels} disabled={!!busy}>
            {busy === 'models' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Load models
          </button>
        </div>
        {provider === 'anthropic' && <p style={hint}><code>claude-opus-5-5</code> is Anthropic’s recommended model. <code>claude-haiku-5-5</code> is much cheaper and fast, and fine for writing help.</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={primary} onClick={save} disabled={!!busy}>
            {busy === 'save' ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {isActive ? 'Save' : 'Save and use this'}
          </button>
          <button type="button" style={secondary} onClick={runTest} disabled={!!busy}>
            {busy === 'test' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Test
          </button>
          {acct && <button type="button" style={{ ...secondary, color: 'var(--danger)' }} onClick={remove} disabled={!!busy}><Trash2 size={14} /> Remove</button>}
        </div>
        {test && (
          <div className={`ai-test ${test.ok ? 'ok' : 'bad'}`}>
            {test.ok ? <>✅ It works{test.model ? <> ({test.model})</> : null}: “{test.text}”</> : <>⚠️ {test.text}</>}
          </div>
        )}
      </section>

      <section style={section}>
        <label style={labelStyle}>Privacy</label>
        <p style={{ ...hint, marginTop: 0 }}>
          When you use the AI, the text you’re working on (and for “Ask AI”, the notes that match your question) is sent to the service above.
          Nothing is sent otherwise. Your key is stored encrypted on your Synapse server and never shown again.
          To keep a workspace away from AI completely, turn it off in <b>Workspace → Preferences</b>.
        </p>
      </section>
    </div>
  );
}
