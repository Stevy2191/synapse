// On a template note: a "Template" chip that shows the fill-in fields (click one to copy it).
import { useEffect, useRef, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import { FIELDS } from '../../templates/templates';

export default function TemplateHint() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const copy = f => { navigator.clipboard?.writeText(f).then(() => toast.success(`Copied ${f} — paste it into the template`)).catch(() => {}); };
  return (
    <span ref={box} className="tpl-hint">
      <button type="button" className="tpl-chip" onClick={() => setOpen(o => !o)} title="This note is a template — see the fill-in fields">
        <ClipboardList size={12} /> Template · fill-in fields
      </button>
      {open && (
        <div className="tpl-pop fade-in">
          <p>When a note is made from this template, these are replaced. Click one to copy it.</p>
          <div className="tpl-fields">
            {FIELDS.map(([f, d]) => <button key={f} type="button" onClick={() => copy(f)}><code>{f}</code><span>{d}</span></button>)}
          </div>
          <p>A line whose fields are all empty (e.g. “Where: {'{{location}}'}” for a call) is left out.</p>
        </div>
      )}
    </span>
  );
}
