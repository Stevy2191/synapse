// "Show sidebar" button for pages that fill the screen (Tasks, Trash…) — on phones the sidebar is
// closed after you pick something, and this is the way back to it.
import { PanelLeft } from 'lucide-react';
import { useStore } from '../../stores/useStore';

export default function SidebarButton({ style }) {
  const open = useStore(s => s.sidebarOpen);
  const setOpen = useStore(s => s.setSidebarOpen);
  if (open) return null;
  return (
    <button type="button" className="btn-ghost sidebar-show" onClick={() => setOpen(true)} title="Show sidebar (Ctrl \)" aria-label="Show sidebar" style={style}>
      <PanelLeft size={17} />
    </button>
  );
}
