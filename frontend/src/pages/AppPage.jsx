import { useEffect, useCallback, useState, lazy, Suspense } from 'react';
import { useStore } from '../stores/useStore';
import Sidebar from '../components/sidebar/Sidebar';
import Editor from '../components/editor/Editor';
import TabBar from '../tabs/TabBar';
import ClusterView from '../components/clusters/ClusterView';
import TemplatePicker from '../components/templates/TemplatePicker';
import { startTeam } from '../team/team';
import InboxView, { refreshInboxCount } from '../components/team/InboxView';
import ActivityView from '../components/team/ActivityView';
import HomeView from '../components/home/HomeView';
import { useHome } from '../home/home';
import { RecorderBar } from '../components/meetings/Recorder';
import FilePicker from '../components/files/FilePicker';
import { retryUnsent } from '../meetings/client';
import GraphView from '../components/graph/GraphView';
import TasksView from '../components/tasks/TasksView';
import TrashView from '../components/trash/TrashView';
import ChatView from '../components/chat/ChatView';
import AskView from '../components/ai/AskView';
import { startChat, stopChat, useChat, totalUnread } from '../chat/client';
import SearchModal from '../components/editor/SearchModal';
import Settings from '../components/sidebar/Settings';
import api from '../api';
import { reportTimeZone, openFromReminderUrl, showReminder } from '../reminders/client';
import { startOffline, getWorkspaces, syncNow } from '../offline/sync';

// The Import window is only downloaded when someone opens it.
const ImportDialog = lazy(() => import('../components/import/ImportDialog'));

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
  const filesOpen = useStore(s => s.filesOpen);
  const importOpen = useStore(s => s.importOpen);

  // Meeting recordings that didn't upload (offline / closed tab): try again now and when back online.
  useEffect(() => {
    // PDFs added offline (or whose note wasn't on the server yet) are uploaded later.
    const sendPdfs = () => import('../pdf/files').then(m => m.hasPending().then(p => p && m.uploadPending())).catch(() => {});
    const retry = () => { retryUnsent(); sendPdfs(); };
    const t = setTimeout(retry, 4000);
    const iv = setInterval(sendPdfs, 60000);
    window.addEventListener('online', retry);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('online', retry); };
  }, []);

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

  // Chat: live connection while signed in; a notification click opens /?chat=<id>.
  useEffect(() => {
    if (!user?.id) return undefined;
    startChat();
    const openFromUrl = () => {
      const id = new URLSearchParams(window.location.search).get('chat');
      if (id) {
        useStore.getState().setActiveChat(id);
        window.history.replaceState(null, '', window.location.pathname);
      }
    };
    openFromUrl();
    openFromReminderUrl(window.location.search);
    startTeam();
    refreshInboxCount();
    // Open Home when Synapse starts (unless turned off in Home → Customize, or a link asked for a note).
    if (!/[?&](note|open)=/.test(window.location.search)) {
      if (useHome.getState().prefs.start_home) useStore.getState().setView('home');
      useHome.getState().load().then(p => { if (!p.start_home && useStore.getState().view === 'home') useStore.getState().setView('editor'); });
    }
    reportTimeZone(user.id);
    const onSwMessage = e => {
      if (e.data?.type === 'open-chat') useStore.getState().setActiveChat(e.data.chatId);
      if (e.data?.type === 'open-url') openFromReminderUrl(new URL(e.data.url, window.location.origin).search);
    };
    const onReminder = e => showReminder(e.detail);
    window.addEventListener('synapse:reminder', onReminder);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => { stopChat(); navigator.serviceWorker?.removeEventListener('message', onSwMessage); window.removeEventListener('synapse:reminder', onReminder); };
  }, [user?.id]);
  const templatePicker = useStore(s => s.templatePicker);
  const unread = useChat(totalUnread);
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Synapse` : 'Synapse';
    try { if (navigator.setAppBadge) (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()); } catch { /* not supported */ }
  }, [unread]);

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
        {view === 'graph' ? <GraphView /> : view === 'tasks' ? <TasksView /> : view === 'trash' ? <TrashView /> : view === 'chat' ? <ChatView /> : view === 'ask' ? <AskView /> : view === 'cluster' ? <ClusterView /> : view === 'inbox' ? <InboxView /> : view === 'activity' ? <ActivityView /> : view === 'home' ? <HomeView /> : <><TabBar /><Editor /></>}
      </main>
      <RecorderBar />
      {templatePicker && <TemplatePicker mode="new" parentId={templatePicker.parentId ?? null} onClose={() => useStore.setState({ templatePicker: null })} />}
      {importOpen && <Suspense fallback={null}><ImportDialog onClose={() => useStore.setState({ importOpen: false })} /></Suspense>}
      {filesOpen && <FilePicker mode="browse" onClose={() => useStore.setState({ filesOpen: false })} />}
      <SearchModal />
      <Settings />
    </div>
  );
}
