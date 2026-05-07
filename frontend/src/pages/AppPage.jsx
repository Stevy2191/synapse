import { useEffect, useCallback } from 'react';
import { useStore } from '../stores/useStore';
import Sidebar from '../components/sidebar/Sidebar';
import Navbar from '../components/sidebar/Navbar';
import Editor from '../components/editor/Editor';
import GraphView from '../components/graph/GraphView';
import SearchModal from '../components/editor/SearchModal';
import Settings from '../components/sidebar/Settings';
import api from '../api';
import toast from 'react-hot-toast';

export default function AppPage() {
  const { sidebarOpen, sidebarWidth, setSidebarWidth, view, workspaces, setWorkspaces, activeWorkspace, setActiveWorkspace, user } = useStore(s => ({
    sidebarOpen: s.sidebarOpen, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth,
    view: s.view, workspaces: s.workspaces, setWorkspaces: s.setWorkspaces,
    activeWorkspace: s.activeWorkspace, setActiveWorkspace: s.setActiveWorkspace, user: s.user
  }));

  const setSearchOpen = useStore(s => s.setSearchOpen);

  // Load workspaces on mount
  useEffect(() => {
    api.get('/workspaces').then(({ data }) => {
      setWorkspaces(data.workspaces);
      if (data.workspaces.length > 0) {
        const saved = activeWorkspace ? data.workspaces.find(w => w.id === activeWorkspace.id) : null;
        setActiveWorkspace(saved || data.workspaces[0]);
      }
    }).catch(() => toast.error('Failed to load workspaces'));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sidebar resize
  const startResize = useCallback((e) => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (e) => {
      const newW = Math.max(180, Math.min(400, startW + e.clientX - startX));
      setSidebarWidth(newW);
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Navbar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {sidebarOpen && (
          <>
            <Sidebar width={sidebarWidth} />
            <div className="resize-handle" onMouseDown={startResize} style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'transparent', transition: 'background 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            />
          </>
        )}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {view === 'graph' ? <GraphView /> : <Editor />}
        </div>
      </div>
      <SearchModal />
      <Settings />
    </div>
  );
}
