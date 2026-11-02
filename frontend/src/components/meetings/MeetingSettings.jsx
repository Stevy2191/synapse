// Settings → Meetings (everyone): which service transcribes, cloud keys, AI summary / to-dos.
// Settings → Server → Meetings (admin): speech models for transcribing on this server.
import { useEffect, useState } from 'react';
import { Check, Loader2, Download, Trash2, Info, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { getMeetingPrefs, saveMeetingPrefs, errorText } from '../../meetings/client';

export const Row = ({ title, desc, children }) => (
  <div className="srow">
    <div className="srow-text"><div className="srow-title">{title}</div>{desc && <div className="srow-desc">{desc}</div>}</div>
    <div className="srow-ctrl">{children}</div>
  </div>
);
export const Group = ({ title, children }) => (
  <section className="sgroup">{title && <h4 className="sgroup-title">{title}</h4>}{children}</section>
);
const Switch = ({ on, onChange, disabled }) => (
  <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}><span /></button>
);

export function MeetingPrefsPage({ styles }) {
  const { heading, lead, field } = styles;
  const [p, setP] = useState(null);
  const [keys, setKeys] = useState({ assemblyai: '', deepgram: '' });
  const load = () => getMeetingPrefs().then(setP).catch(err => toast.error(errorText(err)));
  useEffect(() => { load(); }, []);
  if (!p) return <div><h3 style={heading}>Meetings</h3><p style={lead}>Loading…</p></div>;
  const save = async body => { try { setP(await saveMeetingPrefs(body)); return true; } catch (err) { toast.error(errorText(err)); return false; } };

  return (
    <div className="spage">
      <h3 style={heading}>Meetings <span className="sbadge">New</span></h3>
      <p style={lead}>Record meetings in a note — in the room, or a Teams/Zoom/Meet call on your computer — and get a transcript that shows who said what. Type <code>/meeting</code> in a note, or use the microphone button in the formatting bar.</p>

      <Group title="Transcription">
        <Row title="Transcribe with" desc={p.engine === 'server'
          ? (p.server_ready ? 'This Synapse server — free and private. A 1-hour meeting takes a while on a home server; you get a notification when it’s done.' : 'This Synapse server — but an admin hasn’t downloaded the speech models yet (Settings → Server → Meetings).')
          : `${p.engines[p.engine].label} — your audio is sent to them to transcribe. Faster, and better at telling voices apart.`}>
          <select value={p.engine} onChange={e => save({ engine: e.target.value })} style={{ ...field, flex: '0 0 auto' }}>
            {Object.entries(p.engines).map(([id, e]) => <option key={id} value={id} disabled={id !== 'server' && !p.keys[id]}>{e.label}{id !== 'server' && !p.keys[id] ? ' (add a key below)' : ''}</option>)}
          </select>
        </Row>
        {['assemblyai', 'deepgram'].map(id => (
          <Row key={id} title={`${p.engines[id].label} key`} desc={<>
            {p.keys[id] ? <>Saved ({p.keys[id]}). </> : 'Optional. '}
            <a href={p.engines[id].keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={11} /></a> — they charge per hour of audio (both have free credit to start).
          </>}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="password" autoComplete="off" value={keys[id]} onChange={e => setKeys(k => ({ ...k, [id]: e.target.value }))} placeholder={p.keys[id] ? 'Paste a new key' : 'API key'} style={{ ...field, width: 180 }} />
              <button type="button" className="btn-ghost" disabled={!keys[id].trim()} onClick={async () => { if (await save({ [`${id}_key`]: keys[id] })) { setKeys(k => ({ ...k, [id]: '' })); toast.success('Key saved'); } }}>Save</button>
              {p.keys[id] && <button type="button" className="btn-ghost danger-hover" title="Remove" onClick={() => save({ [`${id}_key`]: '', ...(p.engine === id ? { engine: 'server' } : {}) })}><Trash2 size={13} /></button>}
            </div>
          </Row>
        ))}
      </Group>

      <Group title="After the meeting (AI)">
        {!p.ai_ready && <p className="srow-note"><Info size={13} /> These use your AI assistant, which isn’t set up yet — add one in Settings → AI assistant (Google Gemini has a free tier). The transcript works without it.</p>}
        <Row title="AI summary" desc="Adds a short summary of what was discussed and decided, below the transcript.">
          <Switch on={p.auto_summary} disabled={!p.ai_ready} onChange={v => save({ auto_summary: v })} />
        </Row>
        <Row title="AI to-do list" desc="Adds the action items as a checklist (with who and when), so they show up in Tasks.">
          <Switch on={p.auto_todos} disabled={!p.ai_ready} onChange={v => save({ auto_todos: v })} />
        </Row>
      </Group>

      <Group title="Recording online meetings">
        <p className="srow-note">On a Windows or Mac computer with Chrome or Edge, choose <b>Online meeting on this computer</b>. When the browser asks what to share, pick the <b>entire screen</b> and tick <b>Share system audio</b> (Windows), or pick the meeting’s <b>browser tab</b> and tick <b>Share tab audio</b>. Your microphone is recorded too. On a phone or tablet, use <b>In the room</b> with the call on speaker.</p>
      </Group>
    </div>
  );
}

export function MeetingAdminPage({ styles }) {
  const { heading, lead, field } = styles;
  const [s, setS] = useState(null);
  const load = () => api.get('/meetings/admin').then(r => setS(r.data)).catch(err => toast.error(errorText(err)));
  useEffect(() => { load(); }, []);
  // Follow a running download.
  useEffect(() => {
    if (!s?.download || s.download.finished) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [s?.download?.finished, s?.download?.model]);
  if (!s) return <div><h3 style={heading}>Meetings</h3><p style={lead}>Loading…</p></div>;

  const act = async (fn, msg) => { try { setS({ ...(await fn()).data, workers: s.workers }); if (msg) toast.success(msg); } catch (err) { toast.error(errorText(err)); } };
  const d = s.download;
  const downloading = d && !d.finished;
  const pct = d?.total ? Math.round((d.done / d.total) * 100) : 0;

  return (
    <div className="spage">
      <h3 style={heading}>Meetings</h3>
      <p style={lead}>To transcribe meetings on this server (free and private), download the speech models once. People can also use their own AssemblyAI or Deepgram key instead (Settings → Meetings).</p>

      <Group title="Speech-to-text model">
        {d?.error && <p className="srow-note error"><Info size={13} /> The download failed: {d.error}. The server needs internet access for this — try again.</p>}
        {downloading && (
          <div className="srow-progress">
            <div className="srow-desc"><Loader2 size={13} className="spin" /> {d.step} {d.total ? `— ${pct}% of ${Math.round(d.total / 1048576)} MB` : ''}</div>
            <div className="mtg-bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {Object.entries(s.models).map(([id, m]) => (
          <Row key={id} title={<>{m.label} {s.chosen === id && m.installed && s.extras_installed && <span className="sbadge ok"><Check size={11} /> In use</span>}</>}
            desc={`Whisper ${id} · about ${m.size + (s.extras_installed ? 0 : s.extras_size)} MB download · ${m.speed}`}>
            {m.installed ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {s.chosen !== id && <button type="button" className="btn-ghost" onClick={() => act(() => api.post('/meetings/admin/choose', { model: id }), 'Now using this model')}>Use</button>}
                <button type="button" className="btn-ghost danger-hover" title="Remove" disabled={s.chosen === id} onClick={() => confirm('Remove this model?') && act(() => api.delete(`/meetings/admin/models/${id}`))}><Trash2 size={13} /></button>
              </div>
            ) : (
              <button type="button" className="btn-ghost" disabled={downloading} onClick={() => act(() => api.post('/meetings/admin/download', { model: id }))}><Download size={13} /> Download</button>
            )}
          </Row>
        ))}
        <p className="srow-note">“English” models are more accurate for English; “many languages” models recognise other languages too. Speaker detection (who said what) is included with any of them.</p>
      </Group>

      <Group title="Speed">
        <Row title="Transcribe in parallel" desc="How many parts of a recording are transcribed at the same time. More is faster but uses more memory (about 400 MB each). Automatic uses up to 2.">
          <select value={s.workers || 0} onChange={e => act(() => api.patch('/meetings/admin', { workers: Number(e.target.value) }), 'Saved')} style={{ ...field, flex: '0 0 auto' }}>
            <option value={0}>Automatic</option>
            {[1, 2, 3, 4, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
      </Group>
      <p className="srow-note">Status: {s.ready ? <><Check size={12} style={{ color: 'var(--success)' }} /> ready to transcribe.</> : 'not ready — download a model above.'}</p>
    </div>
  );
}
