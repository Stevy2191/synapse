// Pick a template: make a new note from it, or insert it into the open note. Also: add the starter
// templates, open the Templates folder, and copy a template to another workspace or person.
import { useEffect, useMemo, useState } from 'react';
import { Search, Share2, ArrowLeft, FolderOpen, Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { Modal } from '../chat/ChatDialogs';
import { useStore } from '../../stores/useStore';
import { openNote, plainText, syncNow } from '../../offline/sync';
import {
  STARTERS, listTemplates, setupStarters, newNoteFromTemplate, copyTemplateToWorkspace, sendTemplateToPerson, templatesFolder,
} from '../../templates/templates';

const iconFor = title => STARTERS.find(s => s.title.toLowerCase() === title.toLowerCase())?.icon || '📄';
const builtIn = s => ({ id: `builtin:${s.title}`, title: s.title, rich_content: s.html, editor_mode: 'rich', tags: '[]', builtin: true, desc: s.desc });

/** mode: 'new' (onDone after creating) | 'insert' (onPick(templateNote)). */
export default function TemplatePicker({ mode = 'new', parentId = null, onPick, onClose }) {
  const ws = useStore(s => s.activeWorkspace);
  const tree = useStore(s => s.notes);
  const [mine, setMine] = useState(null);
  const [q, setQ] = useState('');
  const [sharing, setSharing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ws) listTemplates(ws.id).then(setMine); }, [ws?.id, tree]);
  const list = useMemo(() => {
    if (!mine) return [];
    const have = new Set(mine.map(t => t.title.toLowerCase()));
    const all = [...mine, ...STARTERS.filter(s => !have.has(s.title.toLowerCase())).map(builtIn)];
    const ql = q.trim().toLowerCase();
    return ql ? all.filter(t => t.title.toLowerCase().includes(ql)) : all;
  }, [mine, q]);

  const use = async t => {
    if (mode === 'insert') { onPick(t); onClose(); return; }
    setBusy(true);
    try { await newNoteFromTemplate(t, { parentId }); onClose(); } catch (err) { toast.error(err.message || 'Couldn’t create the note'); setBusy(false); }
  };
  const editTemplates = async () => {
    setBusy(true);
    try {
      const folder = (await templatesFolder(ws.id)) || await setupStarters(ws.id);
      await openNote(folder.id); useStore.getState().setView('editor'); onClose();
    } catch (err) { toast.error(err.message); setBusy(false); }
  };
  const addStarters = async () => {
    setBusy(true);
    try { await setupStarters(ws.id); toast.success('Starter templates added to the Templates folder'); } catch (err) { toast.error(err.message); }
    setBusy(false);
  };

  if (sharing) return <ShareTemplate tpl={sharing} onBack={() => setSharing(null)} onClose={onClose} />;
  const preview = t => (t.desc || plainText(t)).replace(/\{\{\s*\w+\s*\}\}/g, '…').replace(/\s+/g, ' ').trim().slice(0, 90);
  const builtins = list.filter(t => t.builtin).length;

  return (
    <Modal title={mode === 'insert' ? 'Insert a template' : 'New note from a template'} onClose={onClose} width={520}>
      <div className="cl-search"><Search size={14} /><input className="chat-field" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a template…" /></div>
      <div className="tp-list">
        {mine === null && <p className="chat-pop-note"><Loader2 size={14} className="spin" /> Loading…</p>}
        {list.map(t => (
          <div key={t.id} className="tp-row">
            <button type="button" className="tp-main" disabled={busy} onClick={() => use(t)}>
              <span className="tp-icon">{iconFor(t.title)}</span>
              <span className="tp-text"><span><b>{t.title}</b>{t.builtin && <span className="tp-badge">built-in</span>}</span><small>{preview(t)}</small></span>
            </button>
            {!t.builtin && <button type="button" className="btn-ghost tp-share" title="Copy to another workspace or send to someone" onClick={() => setSharing(t)}><Share2 size={14} /></button>}
          </div>
        ))}
        {mine && !list.length && <p className="chat-pop-note">No templates match.</p>}
      </div>
      <div className="tp-foot">
        {builtins > 0 && <button type="button" className="btn-ghost" disabled={busy} onClick={addStarters} title="Copy the built-in templates into your Templates folder so you can change them"><Sparkles size={14} /> Add built-ins to my templates</button>}
        <button type="button" className="btn-ghost" disabled={busy} onClick={editTemplates}><FolderOpen size={14} /> Edit templates</button>
      </div>
      <p className="chat-pop-note">Templates are notes in the <b>Templates</b> folder of this workspace. “Meeting” and “Daily note” are used for notes made from the calendar.</p>
    </Modal>
  );
}

function ShareTemplate({ tpl, onBack, onClose }) {
  const ws = useStore(s => s.activeWorkspace);
  const workspaces = useStore(s => s.workspaces).filter(w => w.id !== ws?.id);
  const me = useStore(s => s.user);
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/chats/users').then(r => setPeople(r.data.users.filter(u => u.id !== me?.id))).catch(() => setPeople([])); }, []);
  const name = u => u.nickname || u.display_name || u.username;

  const toWs = async w => {
    setBusy(true);
    try { await copyTemplateToWorkspace(tpl, w.id); toast.success(`Copied to ${w.name}’s templates`); onClose(); } catch (err) { toast.error(err.message); setBusy(false); }
  };
  const toPerson = async u => {
    setBusy(true);
    try {
      await syncNow();
      const r = await sendTemplateToPerson(tpl, u.id);
      toast.success(`Sent to ${r.to} — it’s in their Templates folder`); onClose();
    } catch (err) { toast.error(err?.response?.data?.error || (err?.response ? 'Couldn’t send it' : 'Sending to someone needs a connection')); setBusy(false); }
  };

  return (
    <Modal title={`Share “${tpl.title}”`} onClose={onClose} width={460}>
      <button type="button" className="btn-ghost" onClick={onBack} style={{ marginBottom: 8 }}><ArrowLeft size={14} /> Templates</button>
      <p className="chat-dialog-hint">Sends a <b>copy</b>. Changes you make later aren’t passed on.</p>
      <h4 className="tp-h">Copy to another of my workspaces</h4>
      {workspaces.length ? workspaces.map(w => (
        <button key={w.id} type="button" className="nav-item" disabled={busy} onClick={() => toWs(w)}>{w.icon || '📁'} {w.name}</button>
      )) : <p className="chat-pop-note">You have only one workspace.</p>}
      <h4 className="tp-h">Send to someone on this server</h4>
      {people === null ? <p className="chat-pop-note"><Loader2 size={14} className="spin" /> Loading…</p>
        : people.length ? people.map(u => (
          <button key={u.id} type="button" className="nav-item" disabled={busy} onClick={() => toPerson(u)}>👤 {name(u)}</button>
        )) : <p className="chat-pop-note">Nobody else is on this server yet{navigator.onLine ? '' : ' (or you’re offline)'}.</p>}
    </Modal>
  );
}
