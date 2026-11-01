import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../stores/useStore';
import Sidebar from '../components/sidebar/Sidebar';
import Editor from '../components/editor/Editor';
import GraphView from '../components/graph/GraphView';
import TasksView from '../components/tasks/TasksView';
import TrashView from '../components/trash/TrashView';
import SearchModal from '../components/editor/SearchModal';
import Settings from '../components/sidebar/Settings';
import api from '../api';
import { startOffline, getWorkspaces, syncNow } from '../offline/sync';

function useIsNarrow() {
  const query = '(max-width: 820px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function AppPage() {
  const { sidebarOpen, setSidebarOpen, sidebarWidth, setSidebarWidth, view, setWorkspaces, activeWorkspace, setActiveWorkspace, user, setAuth, token } = useStore(s => ({
    sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen,
    sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth,
    view: s.view, setWorkspaces: s.setWorkspaces,
    activeWorkspace: s.activeWorkspace, setActiveWorkspace: s.setActiveWorkspace,
    user: s.user, setAuth: s.setAuth, token: s.token,
  }));
  const setSearchOpen = useStore(s => s.setSearchOpen);
  const narrow = useIsNarrow();

  // Start closed on phones; the menu button opens it.
  useEffect(() => { if (narrow) setSidebarOpen(false); }, [narrow]);

  // Show the local copy immediately (works offline), then sync with the server.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      await startOffline(user);
      const local = await getWorkspaces();
      if (cancelled) return;
      if (local.length > 0) {
        setWorkspaces(local);
        const saved = activeWorkspace ? local.find(w => w.id === activeWorkspace.id) : null;
        await setActiveWorkspace(saved || local[0]);
      }
      syncNow();
    })();
    // Pick up account changes made elsewhere (theme, role, name).
    api.get('/auth/me').then(({ data }) => { if (!cancelled && data.user) setAuth({ ...user, ...data.user }, token); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); setSidebarOpen(!useStore.getState().sidebarOpen); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const startResize = useCallback((e) => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => setSidebarWidth(Math.max(200, Math.min(420, startW + ev.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const closeOnPhone = useCallback(() => { if (narrow) setSidebarOpen(false); }, [narrow]);

  return (
    <div className="app-shell" style={{ display: 'flex', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {sidebarOpen && (narrow ? (
        <>
          <div onClick={() => setSidebarOpen(false)} className="fade-in"
            style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,20,0.55)', backdropFilter: 'blur(2px)', zIndex: 90 }} />
          <div className="fade-in" style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 91, boxShadow: 'var(--shadow)' }}>
            <Sidebar width={Math.min(300, window.innerWidth - 48)} onNavigate={closeOnPhone} />
          </div>
        </>
      ) : (
        <>
          <Sidebar width={sidebarWidth} />
          <div className="resize-handle" onMouseDown={startResize} style={{ marginLeft: -2, zIndex: 5, flexShrink: 0 }} />
        </>
      ))}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'graph' ? <GraphView /> : view === 'tasks' ? <TasksView /> : view === 'trash' ? <TrashView /> : <Editor />}
      </main>
      <SearchModal />
      <Settings />
    </div>
  );
}
