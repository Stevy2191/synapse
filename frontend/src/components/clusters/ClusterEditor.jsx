// Create / change a cluster: name + icon, rules ("notes that match all/any of"), live preview count.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../chat/ChatDialogs';
import { useStore } from '../../stores/useStore';
import { getWorkspaceNotes } from '../../offline/sync';
import { FIELDS, KINDS, HAS, DAYS, ICONS, clusterNotes, clustersOf, saveClusters, newClusterId } from '../../clusters/clusters';

const blankRule = () => ({ field: 'tag', op: 'is', value: '' });
const defaultValue = field => ({ kind: 'note', has: 'open_tasks', date: '7' }[FIELDS[field].input] ?? '');

export default function ClusterEditor({ cluster, onClose, onSaved }) {
  const ws = useStore(s => s.activeWorkspace);
  const tree = useStore(s => s.notes);
  const [name, setName] = useState(cluster?.name || '');
  const [icon, setIcon] = useState(cluster?.icon || '✨');
  const [match, setMatch] = useState(cluster?.match || 'all');
  const [rules, setRules] = useState(cluster?.rules?.length ? cluster.rules : [blankRule()]);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState([]);

  // Tags used in this workspace, for the tag picker.
  useEffect(() => {
    if (!ws) return;
    getWorkspaceNotes(ws.id).then(all => {
      const set = new Set();
      for (const n of all) { try { (JSON.parse(n.tags || '[]') || []).forEach(t => set.add(String(t))); } catch { /* none */ } }
      setTags([...set].sort((a, b) => a.localeCompare(b)));
    });
  }, [ws?.id]);

  // Live preview: how many notes match right now.
  const draft = useMemo(() => ({ ...(cluster || {}), name, icon, match, rules }), [cluster, name, icon, match, rules]);
  useEffect(() => {
    if (!ws) return undefined;
    let stop = false;
    const t = setTimeout(() => clusterNotes(ws.id, draft).then(list => { if (!stop) setCount(list.length); }), 200);
    return () => { stop = true; clearTimeout(t); };
  }, [draft, ws?.id]);

  const setRule = (i, patch) => setRules(rs => rs.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, ...patch };
    if (patch.field && patch.field !== r.field) { next.op = Object.keys(FIELDS[patch.field].ops)[0]; next.value = defaultValue(patch.field); }
    if (patch.op && FIELDS[next.field].input === 'date' && (patch.op === 'within') !== (r.op === 'within')) next.value = patch.op === 'within' ? '7' : new Date().toISOString().slice(0, 10);
    return next;
  }));

  const save = async () => {
    if (!name.trim()) { toast.error('Give the cluster a name'); return; }
    const clean = rules.filter(r => (['tag', 'title', 'text'].includes(r.field) ? String(r.value).trim() : r.value !== ''));
    // No rules is fine: an empty cluster you fill by hand from its page.
    setBusy(true);
    try {
      const list = clustersOf(ws);
      const item = { ...(cluster || { id: newClusterId(), pinned: [], hidden: [], created_at: Math.floor(Date.now() / 1000) }), name: name.trim().slice(0, 80), icon, match, rules: clean };
      const saved = await saveClusters(cluster ? list.map(c => (c.id === cluster.id ? item : c)) : [...list, item]);
      toast.success(cluster ? 'Cluster saved' : 'Cluster created');
      onSaved?.(saved.find(c => c.id === item.id));
      onClose();
    } catch (err) {
      toast.error(err?.response ? (err.response.data?.error || 'Couldn’t save') : 'Changing clusters needs a connection');
      setBusy(false);
    }
  };

  const valueInput = (r, i) => {
    const f = FIELDS[r.field];
    const common = { className: 'chat-field cl-value', value: r.value, onChange: e => setRule(i, { value: e.target.value }) };
    if (f.input === 'kind') return <select {...common}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
    if (f.input === 'has') return <select {...common}>{Object.entries(HAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
    if (f.input === 'note') return (
      <select {...common}>
        <option value="">Choose a note…</option>
        {tree.slice().sort((a, b) => a.title.localeCompare(b.title)).map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select>
    );
    if (f.input === 'date') return r.op === 'within'
      ? <select {...common}>{Object.entries(DAYS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      : <input type="date" {...common} />;
    if (f.input === 'tag') return (
      <>
        <input {...common} list="cl-tags" placeholder="tag" />
        <datalist id="cl-tags">{tags.map(t => <option key={t} value={t} />)}</datalist>
      </>
    );
    return <input {...common} placeholder="words" />;
  };

  return (
    <Modal title={cluster ? 'Change cluster' : 'New cluster'} onClose={() => !busy && onClose()} width={620}>
      <p className="chat-dialog-hint">A cluster gathers notes from anywhere in this workspace that match its rules — it doesn’t move them, and a note can be in many clusters. You can also add or remove notes by hand on the cluster’s page.</p>
      <div className="cl-name">
        <select className="chat-field cl-icon" value={icon} onChange={e => setIcon(e.target.value)} aria-label="Icon">
          {ICONS.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <input className="chat-field" value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Recipes, Trip 2027, This week" autoFocus={!cluster} style={{ flex: 1 }} />
      </div>
      <div className="cl-match">
        Notes that match
        <select className="chat-field" value={match} onChange={e => setMatch(e.target.value)}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        of these rules:
      </div>
      <div className="cl-rules">
        {rules.map((r, i) => (
          <div key={i} className="cl-rule">
            <select className="chat-field" value={r.field} onChange={e => setRule(i, { field: e.target.value })}>
              {Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </select>
            <select className="chat-field" value={r.op} onChange={e => setRule(i, { op: e.target.value })}>
              {Object.entries(FIELDS[r.field].ops).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {valueInput(r, i)}
            <button type="button" className="btn-ghost danger-hover" title="Remove rule" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
        ))}
        <button type="button" className="btn-ghost cl-add" onClick={() => setRules(rs => [...rs, blankRule()])}><Plus size={14} /> Add a rule</button>
      </div>
      <div className="cl-foot">
        <span className="cl-count">{count === null ? '' : `${count} note${count === 1 ? '' : 's'} match${count === 1 ? 'es' : ''} right now`}</span>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="export-go" onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : null} {cluster ? 'Save' : 'Create cluster'}</button>
      </div>
    </Modal>
  );
}
