// Settings → Workspace → Members: who's in this workspace and what they can do. The owner adds people
// on this server (Can edit / Can view), changes or removes them; members can leave.
import { useEffect, useState } from 'react';
import { UserPlus, Info, LogOut, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { useStore } from '../../stores/useStore';
import { Row, Group } from '../meetings/MeetingSettings';
import { getMembers, addMember, setMemberRole, removeMember, personLabel } from '../../team/team';
import { syncNow } from '../../offline/sync';

const errText = err => err?.response?.data?.error || (err?.response ? 'Something went wrong' : 'This needs a connection to the server');
const ROLE = { owner: 'Owner', edit: 'Can edit', view: 'Can view' };

export default function MembersSettings({ styles }) {
  const { heading, lead, field } = styles;
  const ws = useStore(s => s.activeWorkspace);
  const me = useStore(s => s.user);
  const [members, setMembers] = useState(null);
  const [everyone, setEveryone] = useState([]);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState('edit');
  const [busy, setBusy] = useState(false);
  const owner = ws?.role === 'owner' || !ws?.role;

  useEffect(() => {
    if (!ws) return undefined;
    getMembers(ws.id, { fresh: true }).then(setMembers);
    api.get('/chats/users').then(r => setEveryone(r.data.users)).catch(() => {});
    const on = e => { if (e.detail.workspace_id === ws.id) getMembers(ws.id).then(setMembers); };
    window.addEventListener('synapse:members', on);
    return () => window.removeEventListener('synapse:members', on);
  }, [ws?.id]);
  if (!ws) return null;

  const act = async fn => { setBusy(true); try { setMembers(await fn()); } catch (err) { toast.error(errText(err)); } setBusy(false); };
  const inIt = new Set((members || []).map(m => m.id));
  const addable = everyone.filter(u => !inIt.has(u.id));

  return (
    <div className="spage">
      <h3 style={heading}>Members <span className="sbadge">New</span></h3>
      <p style={lead}>
        {owner
          ? <>Share <b>{ws.name}</b> with people on this server. Everyone you add sees all its notes, the task board and templates; people who <b>can edit</b> work on the same notes at the same time, like Google Docs.</>
          : <>You’re a member of <b>{ws.name}</b>, which belongs to <b>{ws.owner_name}</b>. You {ws.role === 'edit' ? 'can edit its notes' : 'can view its notes'}.</>}
      </p>

      <Group title={`People${members ? ` · ${members.length}` : ''}`}>
        {members === null && <p className="srow-note">Loading…</p>}
        {(members || []).map(m => (
          <Row key={m.id} title={<>{personLabel(m)}{m.id === me?.id ? ' (you)' : ''}</>} desc={`@${m.username}`}>
            {owner && m.role !== 'owner' ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={m.role} disabled={busy} onChange={e => act(() => setMemberRole(ws.id, m.id, e.target.value))} style={{ ...field, flex: '0 0 auto' }}>
                  <option value="edit">Can edit</option><option value="view">Can view</option>
                </select>
                <button type="button" className="btn-ghost danger-hover" title="Remove from this workspace" disabled={busy}
                  onClick={() => confirm(`Remove ${personLabel(m)} from “${ws.name}”? They lose access to its notes.`) && act(() => removeMember(ws.id, m.id))}><Trash2 size={13} /></button>
              </div>
            ) : <span className="sbadge">{ROLE[m.role]}</span>}
          </Row>
        ))}
      </Group>

      {owner && (
        <Group title="Add someone">
          {addable.length ? (
            <Row title="Person" desc="Anyone with an account on this server. An admin can add accounts in Settings → Server → Users.">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select value={pick} onChange={e => setPick(e.target.value)} style={{ ...field, width: 170, flex: '0 0 auto' }}>
                  <option value="">Choose…</option>
                  {addable.map(u => <option key={u.id} value={u.id}>{u.nickname || u.display_name || u.username}</option>)}
                </select>
                <select value={role} onChange={e => setRole(e.target.value)} style={{ ...field, flex: '0 0 auto' }}>
                  <option value="edit">Can edit</option><option value="view">Can view</option>
                </select>
                <button type="button" className="export-go" disabled={!pick || busy} onClick={() => act(async () => { const r = await addMember(ws.id, pick, role); setPick(''); toast.success('Added — they’ll see it in their workspace menu'); return r; })}><UserPlus size={14} /> Add</button>
              </div>
            </Row>
          ) : <p className="srow-note"><Info size={13} /> Everyone on this server is already here. An admin can add accounts in Settings → Server → Users.</p>}
        </Group>
      )}

      {!owner && (
        <Group title="Leave">
          <Row title="Leave this workspace" desc="It disappears from your workspace menu. The owner can add you again.">
            <button type="button" className="btn-ghost danger-hover" disabled={busy} onClick={async () => {
              if (!confirm(`Leave “${ws.name}”?`)) return;
              try { await removeMember(ws.id, me.id); useStore.getState().setSettingsOpen(false); toast.success(`You left “${ws.name}”`); syncNow(); } catch (err) { toast.error(errText(err)); }
            }}><LogOut size={13} /> Leave</button>
          </Row>
        </Group>
      )}
    </div>
  );
}
