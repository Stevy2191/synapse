import { Search, GitGraph, PanelLeft, Settings, Network } from 'lucide-react';
import { useStore } from '../../stores/useStore';

export default function Navbar() {
  const { sidebarOpen, setSidebarOpen, view, setView, setSearchOpen, setSettingsOpen, user, activeWorkspace } = useStore(s => ({
    sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen,
    view: s.view, setView: s.setView,
    setSearchOpen: s.setSearchOpen, setSettingsOpen: s.setSettingsOpen,
    user: s.user, activeWorkspace: s.activeWorkspace
  }));

  return (
    <div style={{
      height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
      background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      flexShrink: 0, userSelect: 'none'
    }}>
      {/* Logo */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)} style={iconBtn} title="Toggle sidebar">
        <PanelLeft size={16} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
        <span style={{ fontSize: 18 }}>🧠</span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Synapse</span>
      </div>

      {activeWorkspace && (
        <>
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
          <span style={{ fontSize: 16 }}>{activeWorkspace.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{activeWorkspace.name}</span>
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* View switcher - only in editor */}
      <button
        onClick={() => setView(view === 'graph' ? 'editor' : 'graph')}
        title={view === 'graph' ? 'Editor view' : 'Graph view'}
        style={{ ...iconBtn, background: view === 'graph' ? 'var(--accent-subtle)' : 'transparent', color: view === 'graph' ? 'var(--accent-hover)' : 'var(--text-muted)' }}
      >
        <Network size={16} />
      </button>

      <button onClick={() => setSearchOpen(true)} style={iconBtn} title="Search (Ctrl+K)">
        <Search size={16} />
      </button>

      <button onClick={() => setSettingsOpen(true)} style={iconBtn} title="Settings">
        <Settings size={16} />
      </button>

      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        onClick={() => setSettingsOpen(true)}
        title={user?.username}>
        {user?.username?.[0]?.toUpperCase()}
      </div>
    </div>
  );
}

const iconBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'transparent', color: 'var(--text-muted)', transition: 'all 0.15s'
};
