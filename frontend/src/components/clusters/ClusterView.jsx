// A cluster's page: its notes (newest edits first), the rules in words, and add / remove by hand.
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X, Search, Pin } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStore } from '../../stores/useStore';
import { getWorkspaceNotes, openNote, plainText } from '../../offline/sync';
import { openInNewTab } from '../../tabs/tabs';
import { kindInfo, noteKind } from '../noteKinds';
import SidebarButton from '../sidebar/SidebarButton';
import { Modal } from '../chat/ChatDialogs';
import ClusterEditor from './ClusterEditor';
import { clusterNotes, clustersOf, saveClusters, describeRule } from '../../clusters/clusters';

const when = s => (s ? new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function ClusterView() {
  const ws = useStore(s => s.activeWorkspace);
  const tree = useStore(s => s.notes);
  const id = useStore(s => s.activeClusterId);
  const cluster = clustersOf(ws).find(c => c.id === id);
  const [notes, setNotes] = useState(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const byId = useMemo(() => new Map(tree.map(n => [n.id, n])), [tree]);

  useEffect(() => {
    if (!ws || !cluster) return;
    let stop = false;
    clusterNotes(ws.id, cluster).then(list => { if (!stop) setNotes(list); });
    return () => { stop = true; };
  }, [ws?.id, ws?.settings, tree, id]);

  if (!cluster) {
    return <div className="tasks-view"><div className="tasks-inner"><div className="tasks-head"><SidebarButton /><h1>Cluster</h1></div><p className="tasks-lead">This cluster doesn’t exist any more.</p></div></div>;
  }

  const update = async patch => {
    try { await saveClusters(clustersOf(ws).map(c => (c.id === cluster.id ? { ...c, ...patch } : c))); } catch (err) {
      toast.error(err?.response ? (err.response.data?.error || 'Couldn’t save') : 'Changing clusters needs a connection');
    }
  };
  const remove = n => {
    const pinned = (cluster.pinned || []).filter(x => x !== n.id);
    const wasPinned = pinned.length !== (cluster.pinned || []).length;
    // Matched by its rules: hide it from this cluster (it stays everywhere else).
    update(wasPinned ? { pinned } : { hidden: [...new Set([...(cluster.hidden || []), n.id])] });
  };
  const del = async () => {
    if (!confirm(`Delete the cluster “${cluster.name}”? Its notes aren’t touched.`)) return;
    try { await saveClusters(clustersOf(ws).filter(c => c.id !== cluster.id)); useStore.getState().setView('editor'); toast.success('Cluster deleted'); } catch (err) {
      toast.error(err?.response ? 'Couldn’t delete it' : 'Changing clusters needs a connection');
    }
  };
  const open = (n, e) => {
    if (e && (e.ctrlKey || e.metaKey || e.button === 1)) { openInNewTab(n.id); return; }
    openNote(n.id).then(() => useStore.getState().setView('editor'));
  };
  const pathOf = n => {
    const parts = [];
    let p = byId.get(n.id)?.parent_id;
    for (let i = 0; p && i < 20; i++) { const pn = byId.get(p); if (!pn) break; parts.unshift(pn.title); p = pn.parent_id; }
    return parts.join(' › ');
  };

  return (
    <div className="tasks-view">
      <div className="tasks-inner">
        <div className="tasks-head cl-head">
          <SidebarButton />
          <h1><span className="cl-head-icon">{cluster.icon || '✨'}</span>{cluster.name}</h1>
          <span className="tasks-count">{notes ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : ''}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={() => setAdding(true)} title="Add notes by hand"><Plus size={15} /><span className="lbl"> Add notes</span></button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)} title="Change name and rules"><Pencil size={14} /><span className="lbl"> Change</span></button>
          <button type="button" className="btn-ghost danger-hover" onClick={del} title="Delete this cluster"><Trash2 size={14} /></button>
        </div>
        <p className="tasks-lead">
          {cluster.rules?.length
            ? <>Notes that match {cluster.rules.length > 1 ? (cluster.match === 'any' ? 'any of' : 'all of') : ''} {cluster.rules.map((r, i) => <span key={i} className="cl-chip">{describeRule(r, byId)}</span>)}</>
            : 'Notes you add by hand.'}
          {cluster.pinned?.length ? <> · {cluster.pinned.length} added by hand</> : null}
          {cluster.hidden?.length ? <> · {cluster.hidden.length} removed <button type="button" className="cl-link" onClick={() => update({ hidden: [] })}>bring back</button></> : null}
        </p>
        {notes && !notes.length && <p className="tasks-empty">No notes match yet. Notes appear here by themselves as soon as they match — or add some by hand.</p>}
        <div className="cl-list">
          {(notes || []).map(n => {
            const kind = kindInfo({ ...n, kind: noteKind(n) });
            const Icon = kind.icon;
            const path = pathOf(n);
            let tags = [];
            try { tags = JSON.parse(n.tags || '[]') || []; } catch { /* none */ }
            const preview = plainText(n).replace(/[#>*_`|\-[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
            return (
              <div key={n.id} className="cl-row" role="button" tabIndex={0} onClick={e => open(n, e)} onAuxClick={e => e.button === 1 && open(n, e)} onKeyDown={e => e.key === 'Enter' && open(n, e)}>
                <Icon size={16} className="cl-row-icon" style={kind.color ? { color: kind.color } : undefined} />
                <div className="cl-row-main">
                  <div className="cl-row-title">{n.title || 'Untitled'}{cluster.pinned?.includes(n.id) && <Pin size={11} className="cl-pin" aria-label="Added by hand" />}</div>
                  {path && <div className="cl-row-path">{path}</div>}
                  {preview && <div className="cl-row-preview">{preview}</div>}
                  <div className="cl-row-meta">
                    <span>Edited {when(n.updated_at)}</span>
                    {tags.slice(0, 4).map(t => <span key={t} className="cl-tag">#{t}</span>)}
                  </div>
                </div>
                <button type="button" className="btn-ghost cl-remove" title="Remove from this cluster (the note isn’t deleted)" onClick={e => { e.stopPropagation(); remove(n); }}><X size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
      {editing && <ClusterEditor cluster={cluster} onClose={() => setEditing(false)} />}
      {adding && <AddNotes cluster={cluster} tree={tree} onAdd={ids => update({ pinned: [...new Set([...(cluster.pinned || []), ...ids])], hidden: (cluster.hidden || []).filter(x => !ids.includes(x)) })} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddNotes({ cluster, tree, onAdd, onClose }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const list = tree.filter(n => !cluster.pinned?.includes(n.id) && n.title.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <Modal title={`Add notes to “${cluster.name}”`} onClose={onClose} width={480}>
      <div className="cl-search"><Search size={14} /><input className="chat-field" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a note…" /></div>
      <div className="cl-pick">
        {list.map(n => (
          <label key={n.id} className="cl-pick-row">
            <input type="checkbox" checked={picked.includes(n.id)} onChange={e => setPicked(p => (e.target.checked ? [...p, n.id] : p.filter(x => x !== n.id)))} />
            <span>{n.title || 'Untitled'}</span>
          </label>
        ))}
        {!list.length && <p className="chat-pop-note">No notes found.</p>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="export-go" disabled={!picked.length} onClick={() => { onAdd(picked); onClose(); }}>Add {picked.length || ''}</button>
      </div>
    </Modal>
  );
}
