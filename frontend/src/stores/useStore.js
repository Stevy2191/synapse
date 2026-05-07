import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api';
import { applyTheme } from '../themes';

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
      sidebarWidth: 260,
      searchOpen: false,
      settingsOpen: false,

      // Auth actions
      setAuth: (user, token) => {
        set({ user, token });
        if (user?.theme) applyTheme(user.theme);
      },
      logout: () => {
        set({ user: null, token: null, workspaces: [], activeWorkspace: null, notes: [], activeNote: null });
      },

      // Workspace actions
      setWorkspaces: (workspaces) => set({ workspaces }),
      setActiveWorkspace: async (ws) => {
        set({ activeWorkspace: ws, activeNote: null });
        if (ws) {
          try {
            const { data } = await api.get(`/notes/workspace/${ws.id}`);
            set({ notes: data.notes });
          } catch {}
        }
      },

      // Note actions
      setNotes: (notes) => set({ notes }),
      setActiveNote: (note) => set({ activeNote: note }),
      updateNoteInTree: (id, updates) => set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, ...updates } : n)
      })),
      addNoteToTree: (note) => set(s => ({ notes: [...s.notes, note] })),
      removeNoteFromTree: (id) => set(s => ({ notes: s.notes.filter(n => n.id !== id) })),

      // UI actions
      setView: (view) => set({ view }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (w) => set({ sidebarWidth: w }),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setTheme: async (theme) => {
        applyTheme(theme);
        set(s => ({ user: { ...s.user, theme } }));
        try { await api.patch('/auth/theme', { theme }); } catch {}
      },
    }),
    {
      name: 'synapse-store',
      partialize: (s) => ({ token: s.token, user: s.user, activeWorkspace: s.activeWorkspace, sidebarWidth: s.sidebarWidth })
    }
  )
);
