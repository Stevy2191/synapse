// The strip of open notes above the editor. Click to switch, × (or middle-click) to close, drag to
// reorder, "+" for a new tab, right-click for "Close other tabs".
import { useEffect, useRef, useState } from 'react';
import { X, Plus, Users } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { kindInfo } from '../components/noteKinds';
import {
  tabsFor, isBlank, switchTab, closeTab, closeOtherTabs, newBlankTab, pruneTabs, moveTab, openTabNote, startTabs,
} from './tabs';

startTabs();

export default function TabBar() {
  const ws = useStore(s => s.activeWorkspace?.id);
  const tabs = useStore(s => tabsFor(s, s.activeWorkspace?.id));
  const notes = useStore(s => s.notes);
  const [menu, setMenu] = useState(null); // { id, x, y }
  const [dragId, setDragId] = useState(null);
  const restored = useRef(null);
  const stripRef = useRef(null);

  // Notes deleted elsewhere: drop their tabs.
  useEffect(() => { pruneTabs(new Set(notes.map(n => n.id))); }, [notes]);

  // After a refresh (or switching workspace), reopen the tab you were on.
  useEffect(() => {
    if (!ws || restored.current === ws || !notes.length) return;
    restored.current = ws;
    const cur = tabsFor(useStore.getState(), ws);
    const tab = cur.items.find(t => t.id === cur.active);
    if (!useStore.getState().activeNote && tab && !isBlank(tab)) openTabNote(tab).catch(() => {});
  }, [ws, notes.length]);

  // Keep the current tab in view.
  useEffect(() => {
    stripRef.current?.querySelector('.tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tabs.active]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); };
  }, [menu]);

  if (!ws || !tabs.items.length) return null;
  const byId = new Map(notes.map(n => [n.id, n]));

  return (
    <div className="tab-bar" role="tablist" aria-label="Open notes">
      <div className="tab-strip" ref={stripRef}>
        {tabs.items.map((t, i) => {
          const entry = byId.get(t.id);
          const blank = isBlank(t);
          const kind = entry ? kindInfo(entry) : null;
          const Icon = kind?.icon;
          const title = blank ? 'New tab' : entry?.title || t.title || 'Untitled';
          const on = t.id === tabs.active;
          return (
            <div key={t.id} role="tab" aria-selected={on} title={title}
              className={`tab${on ? ' on' : ''}${dragId === t.id ? ' dragging' : ''}`}
              onClick={() => switchTab(t)}
              onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
              onContextMenu={e => { e.preventDefault(); setMenu({ id: t.id, x: e.clientX, y: e.clientY }); }}
              draggable
              onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-synapse-tab', t.id); }}
              onDragEnd={() => setDragId(null)}
              onDragOver={e => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop={e => { e.preventDefault(); if (dragId && dragId !== t.id) moveTab(dragId, i); setDragId(null); }}>
              {Icon ? <Icon size={13} className="tab-icon" style={kind.color ? { color: kind.color } : undefined} />
                : t.shared ? <Users size={13} className="tab-icon" /> : null}
              <span className="tab-title">{title}</span>
              <button type="button" className="tab-close" title="Close tab"
                onClick={e => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></button>
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-new" title="New tab — then pick a note (or Ctrl/⌘-click a note to open it in a new tab)" onClick={newBlankTab}><Plus size={15} /></button>
      {menu && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
          <button type="button" onClick={() => { closeTab(menu.id); setMenu(null); }}>Close tab</button>
          <button type="button" onClick={() => { closeOtherTabs(menu.id); setMenu(null); }} disabled={tabs.items.length < 2}>Close other tabs</button>
        </div>
      )}
    </div>
  );
}
