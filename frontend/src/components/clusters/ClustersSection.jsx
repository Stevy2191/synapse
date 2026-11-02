// Sidebar: the workspace's clusters, with how many notes are in each.
import { useEffect, useState } from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import ClusterEditor from './ClusterEditor';
import { clustersOf, clusterCounts } from '../../clusters/clusters';

export default function ClustersSection({ onNavigate }) {
  const ws = useStore(s => s.activeWorkspace);
  const tree = useStore(s => s.notes);
  const view = useStore(s => s.view);
  const activeId = useStore(s => s.activeClusterId);
  const clusters = clustersOf(ws);
  const [counts, setCounts] = useState({});
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('synapse-clusters-open') !== '0'; } catch { return true; } });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ws || !clusters.length) return undefined;
    const t = setTimeout(() => clusterCounts(ws.id, clusters).then(setCounts).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [ws?.id, ws?.settings, tree]);

  const toggle = () => { setOpen(o => { try { localStorage.setItem('synapse-clusters-open', o ? '0' : '1'); } catch { /* ignore */ } return !o; }); };
  const go = c => { useStore.setState({ activeClusterId: c.id, view: 'cluster' }); onNavigate?.(); };

  if (!ws) return null;
  return (
    <div className="clusters-section">
      <div className="clusters-head">
        <button type="button" className="clusters-toggle" onClick={toggle} title={open ? 'Hide clusters' : 'Show clusters'}>
          <ChevronRight size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          <span className="section-label">Clusters</span>
        </button>
        <button type="button" className="btn-ghost" style={{ width: 24, height: 24, padding: 0, justifyContent: 'center' }} onClick={() => setCreating(true)} title="New cluster — a smart group of notes"><Plus size={14} /></button>
      </div>
      {open && (
        <div className="clusters-list">
          {!clusters.length && (
            <button type="button" className="clusters-empty" onClick={() => setCreating(true)}>Group notes from anywhere by tag, words, kind or date — <b>New cluster</b></button>
          )}
          {clusters.map(c => (
            <button key={c.id} type="button" className={`nav-item${view === 'cluster' && activeId === c.id ? ' on' : ''}`} onClick={() => go(c)}>
              <span className="cluster-icon">{c.icon || '✨'}</span>
              <span className="cluster-name">{c.name}</span>
              {counts[c.id] !== undefined && <span className="nav-count">{counts[c.id]}</span>}
            </button>
          ))}
        </div>
      )}
      {creating && <ClusterEditor onClose={() => setCreating(false)} onSaved={c => c && go(c)} />}
    </div>
  );
}
