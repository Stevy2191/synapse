import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api';
import { applyTheme } from '../themes';
import { refreshTree } from '../offline/sync';

export const useStore = create(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      token: null,
      
      // Workspace
      workspaces: [],
      activeWorkspace: null,
      
      // Notes
      notes: [],         // tree (id, parent_id, title, tags)
      activeNote: null,  // full note with content
      
      // UI
      view: 'editor',    // 'editor' | 'graph' | 'split'
      sidebarOpen: true,
      sidebarWidth: 264,
      rightRailOpen: true,
      rightRailTab: 'calendar',   // 'calendar' | 'links'
      calendarDay: null,          // the day selected in the calendar panel (kept while switching notes)
      searchOpen: false,
      settingsOpen: false,
      settingsPage: 'profile',
      activeChatId: null,         // the chat open on the Chats page
      tabs: {},
      richToolbar: false,
      filesOpen: false,           // the Files window (sidebar → Files); lives outside the sidebar so it stays open on phones         // formatting bar fixed at the top of Write-mode notes (this device)                   // open tabs per workspace: { [wsId]: { items: [{ id, title, shared }], active } } (tabs/tabs.js)

      // Offline sync status (see offline/sync.js)
      sync: { online: true, pending: 0, syncing: false, lastSyncAt: null },

      // Auth actions
      setAuth: (user, token) => {
        set({ user, token });
        if (user?.theme) applyTheme(user.theme);
      },
      setToken: (token) => set({ token }),
      logout: () => {
        set({ user: null, token: null, workspaces: [], activeWorkspace: null, notes: [], activeNote: null, tabs: {} });
      },

      // Workspace actions
      setWorkspaces: (workspaces) => set({ workspaces }),
      setActiveWorkspace: async (ws) => {
        set({ activeWorkspace: ws, activeNote: null, notes: [] });
        if (ws) await refreshTree();
      },

      // Note actions
      setNotes: (notes) => set({ notes }),
      setActiveNote: (note) => set({ activeNote: note }),
      updateNoteInTree: (id, updates) => set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, ...updates } : n)
      })),
      addNoteToTree: (note) => set(s => ({ notes: [...s.notes, note] })),
      // Accepts one id or a list (a deleted note plus its children).
      removeNoteFromTree: (ids) => set(s => {
        const gone = new Set(Array.isArray(ids) ? ids : [ids]);
        return {
          notes: s.notes.filter(n => !gone.has(n.id)),
          activeNote: s.activeNote && gone.has(s.activeNote.note?.id) ? null : s.activeNote,
        };
      }),

      // UI actions
      setView: (view) => set({ view }),
      setActiveChat: (id) => set({ activeChatId: id, view: 'chat' }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (w) => set({ sidebarWidth: w }),
      setRightRailOpen: (open) => set({ rightRailOpen: open }),
      setRightRailTab: (tab) => set({ rightRailTab: tab }),
      setCalendarDay: (day) => set({ calendarDay: day }),
      setSearchOpen: (open) => set({ searchOpen: open }),
      // setSettingsOpen(false) closes; true opens on Profile; a page name opens that page.
      setSettingsOpen: (open) => set(typeof open === 'string'
        ? { settingsOpen: true, settingsPage: open }
        : { settingsOpen: !!open, ...(open ? { settingsPage: 'profile' } : {}) }),

      setTheme: async (theme) => {
        applyTheme(theme);
        set(s => ({ user: { ...s.user, theme } }));
        try { await api.patch('/auth/theme', { theme }); } catch {}
      },
    }),
    {
      name: 'synapse-store',
      partialize: (s) => ({ token: s.token, user: s.user, activeWorkspace: s.activeWorkspace, sidebarWidth: s.sidebarWidth, sidebarOpen: s.sidebarOpen, rightRailOpen: s.rightRailOpen, rightRailTab: s.rightRailTab, activeChatId: s.activeChatId, tabs: s.tabs, richToolbar: s.richToolbar, view: ['graph', 'tasks', 'trash', 'ask'].includes(s.view) ? 'editor' : s.view })
    }
  )
);
