// Settings, in three groups:
//   Account    — about you, the same in every workspace (profile, appearance, security)
//   Workspace  — the current workspace (name, picture, colour, preferences)
//   Server     — admins only (users, sign-ups, about)
import { useEffect, useRef, useState } from 'react';
import {
  X, User, Palette, Lock, LogOut, Settings2, SlidersHorizontal, Users, Server, Upload, Trash2, Camera, ChevronLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import SecuritySettings from './SecuritySettings';
import { UserAvatar, WorkspaceIcon, displayName, workspaceSettings } from '../Avatar';
import { useStore } from '../../stores/useStore';
import { THEMES } from '../../themes';
import api from '../../api';
import { signOut, syncNow } from '../../offline/sync';
import { squareImage } from '../../utils/image';

const errorText = err => err?.response?.data?.error || err?.message || 'Something went wrong';

export default function Settings() {
  const { user, activeWorkspace, settingsOpen, settingsPage, setSettingsOpen } = useStore(s => ({
    user: s.user, activeWorkspace: s.activeWorkspace,
    settingsOpen: s.settingsOpen, settingsPage: s.settingsPage, setSettingsOpen: s.setSettingsOpen,
  }));
  const [narrowMenu, setNarrowMenu] = useState(true); // phones: show the menu first

  useEffect(() => { if (settingsOpen) setNarrowMenu(true); }, [settingsOpen]);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = e => { if (e.key === 'Escape') setSettingsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  if (!settingsOpen) return null;
  const page = settingsPage || 'profile';
  const go = p => { setSettingsOpen(p); setNarrowMenu(false); };
  const isAdmin = user?.role === 'admin';

  const groups = [
    { label: 'Account', items: [
      ['profile', <User size={15} />, 'Profile'],
      ['appearance', <Palette size={15} />, 'Appearance'],
      ['security', <Lock size={15} />, 'Security'],
    ] },
    { label: activeWorkspace ? `Workspace · ${activeWorkspace.name}` : 'Workspace', workspace: true, items: [
      ['ws-general', <Settings2 size={15} />, 'General'],
      ['ws-preferences', <SlidersHorizontal size={15} />, 'Preferences'],
    ] },
    ...(isAdmin ? [{ label: 'Server', items: [
      ['server-users', <Users size={15} />, 'Users'],
      ['server-general', <Server size={15} />, 'Sign-ups & about'],
    ] }] : []),
  ];

  return (
    <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
      <div className={`settings-window fade-in ${narrowMenu ? 'show-menu' : 'show-page'}`} onClick={e => e.stopPropagation()}>
        {/* Menu */}
        <nav className="settings-menu">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 16px' }}>
            <UserAvatar user={user} size={40} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(user)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
            </div>
          </div>
          {groups.map(g => (
            <div key={g.label} style={{ marginBottom: 10 }}>
              <div className="section-label" style={{ padding: '8px 10px 6px', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {g.workspace && <WorkspaceIcon workspace={activeWorkspace} size={14} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</span>
              </div>
              {g.items.map(([id, icon, label]) => (
                <button key={id} className={`nav-item${page === id ? ' on' : ''}`} onClick={() => go(id)}>{icon}{label}</button>
              ))}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button className="nav-item" style={{ color: 'var(--danger)' }} onClick={async () => { if (await signOut()) setSettingsOpen(false); }}>
            <LogOut size={15} /> Sign out
          </button>
        </nav>

        {/* Page */}
        <div className="settings-page">
          <div className="settings-page-top">
            <button className="btn-ghost settings-back" onClick={() => setNarrowMenu(true)}><ChevronLeft size={16} /> Settings</button>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" onClick={() => setSettingsOpen(false)} title="Close (Esc)"><X size={17} /></button>
          </div>
          <div className="settings-page-body">
            {page === 'profile' && <ProfilePage />}
            {page === 'appearance' && <AppearancePage />}
            {page === 'security' && <SecuritySettings />}
            {page === 'ws-general' && <WorkspaceGeneralPage />}
            {page === 'ws-preferences' && <WorkspacePreferencesPage />}
            {page === 'server-users' && isAdmin && <ServerUsersPage />}
            {page === 'server-general' && isAdmin && <ServerGeneralPage />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Account ───────────────────────────

function PictureChooser({ value, onPick, onRemove, round, preview }) {
  const input = useRef(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <button onClick={() => input.current?.click()} title="Choose a picture" style={{
        position: 'relative', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: round ? '50%' : 16,
      }}>
        {preview}
        <span style={{
          position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--accent)', color: '#fff', border: '2px solid var(--bg-surface)',
        }}><Camera size={13} /></span>
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={secondary} onClick={() => input.current?.click()}><Upload size={13} /> Upload picture</button>
        {value && <button style={dangerLink} onClick={onRemove}>Remove picture</button>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" hidden
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try { onPick(await squareImage(file)); } catch (err) { toast.error(err.message); }
        }} />
    </div>
  );
}

function ProfilePage() {
  const { user, token, setAuth } = useStore(s => ({ user: s.user, token: s.token, setAuth: s.setAuth }));
  const [name, setName] = useState(user?.display_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');

  const save = async (body, message) => {
    try {
      const { data } = await api.patch('/auth/profile', body);
      setAuth({ ...user, ...data.user }, token);
      if (message) toast.success(message);
      return true;
    } catch (err) { toast.error(errorText(err)); return false; }
  };

  return (
    <div>
      <h3 style={heading}>Profile</h3>
      <p style={lead}>How you appear in Synapse. This is the same in every workspace.</p>

      <section style={section}>
        <PictureChooser round value={user?.avatar}
          preview={<UserAvatar user={user} size={72} />}
          onPick={avatar => save({ avatar }, 'Picture updated')}
          onRemove={() => save({ avatar: null }, 'Picture removed')} />
      </section>

      <section style={section}>
        <label style={labelStyle}>Display name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={user?.username} maxLength={60} style={field}
            onKeyDown={e => e.key === 'Enter' && save({ display_name: name }, 'Name saved')} />
          <button style={primary} disabled={name === (user?.display_name || '')} onClick={() => save({ display_name: name }, 'Name saved')}>Save</button>
        </div>
        <p style={hint}>Sign in with <b>{user?.username}</b> (your username can't be changed).</p>
      </section>

      <section style={section}>
        <label style={labelStyle}>Email</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" style={{ ...field, flex: 2, minWidth: 180 }} />
          {email.trim().toLowerCase() !== user?.email && (
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password"
              placeholder="Current password" style={{ ...field, flex: 1, minWidth: 140 }} />
          )}
          <button style={primary} disabled={email.trim().toLowerCase() === user?.email}
            onClick={async () => { if (await save({ email, current_password: password }, 'Email updated')) setPassword(''); }}>Save</button>
        </div>
      </section>

      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const setToken = useStore(s => s.setToken);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try {
      const { data } = await api.patch('/auth/password', { current_password: form.current, new_password: form.next });
      setToken(data.token);
      setForm({ current: '', next: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) { toast.error(errorText(err)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ ...section, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={labelStyle}>Change password</label>
      <input type="password" placeholder="Current password" autoComplete="current-password" value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} style={field} />
      <input type="password" placeholder="New password (min 8 characters)" autoComplete="new-password" value={form.next} onChange={e => setForm(f => ({ ...f, next: e.target.value }))} style={field} />
      <input type="password" placeholder="Confirm new password" autoComplete="new-password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} style={field} />
      <button type="submit" disabled={busy || !form.current || !form.next} style={{ ...primary, alignSelf: 'flex-start' }}>Update password</button>
    </form>
  );
}

function AppearancePage() {
  const { user, setTheme } = useStore(s => ({ user: s.user, setTheme: s.setTheme }));
  return (
    <div>
      <h3 style={heading}>Appearance</h3>
      <p style={lead}>Your theme follows you to every workspace and device.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {Object.entries(THEMES).map(([key, theme]) => {
          const selected = (user?.theme || 'auto') === key;
          const v = key === 'auto' ? THEMES.neural.vars : theme.vars;
          const v2 = key === 'auto' ? THEMES['neural-light'].vars : null;
          return (
            <button key={key} onClick={() => setTheme(key)} style={{
              padding: 0, borderRadius: 10, cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
              border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              background: 'var(--bg-surface)', boxShadow: selected ? 'var(--glow)' : 'none', transition: 'all .15s',
            }}>
              <div style={{ height: 46, display: 'flex' }}>
                {[v, v2].filter(Boolean).map((vars, i) => (
                  <div key={i} style={{ flex: 1, background: vars['--bg-base'], display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px' }}>
                    {[vars['--accent'], vars['--text-primary'], vars['--success']].map((c, j) => (
                      <span key={j} style={{ width: j === 0 ? 14 : 8, height: j === 0 ? 14 : 8, borderRadius: '50%', background: c }} />
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-primary)', flex: 1 }}>{theme.label}</span>
                {key === 'auto' && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>default</span>}
              </div>
            </button>
          );
        })}
      </div>
      <p style={{ ...hint, marginTop: 14 }}>Auto uses Neural or Neural Light to match your device's light/dark setting.</p>
    </div>
  );
}

// ─────────────────────────── Workspace ───────────────────────────

const COLORS = ['#7c7bff', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

function useWorkspaceSaver() {
  const { activeWorkspace, workspaces, setWorkspaces } = useStore(s => ({
    activeWorkspace: s.activeWorkspace, workspaces: s.workspaces, setWorkspaces: s.setWorkspaces,
  }));
  return async (body, message) => {
    try {
      const { data } = await api.patch(`/workspaces/${activeWorkspace.id}`, body);
      setWorkspaces(workspaces.map(w => (w.id === data.workspace.id ? data.workspace : w)));
      useStore.setState({ activeWorkspace: data.workspace });
      syncNow();
      if (message) toast.success(message);
      return true;
    } catch (err) {
      toast.error(err.response ? errorText(err) : 'Changing workspace settings needs a connection');
      return false;
    }
  };
}

function WorkspaceGeneralPage() {
  const { activeWorkspace: ws, workspaces, setActiveWorkspace } = useStore(s => ({
    activeWorkspace: s.activeWorkspace, workspaces: s.workspaces, setActiveWorkspace: s.setActiveWorkspace,
  }));
  const save = useWorkspaceSaver();
  const [name, setName] = useState(ws?.name || '');
  const [emoji, setEmoji] = useState(ws?.icon || '📁');
  const [confirmName, setConfirmName] = useState('');
  useEffect(() => { setName(ws?.name || ''); setEmoji(ws?.icon || '📁'); setConfirmName(''); }, [ws?.id]);
  if (!ws) return null;

  const remove = async () => {
    try {
      await api.delete(`/workspaces/${ws.id}`);
      const rest = workspaces.filter(w => w.id !== ws.id);
      useStore.setState({ workspaces: rest });
      if (rest[0]) await setActiveWorkspace(rest[0]);
      syncNow();
      toast.success(`Deleted "${ws.name}"`);
    } catch (err) { toast.error(err.response ? errorText(err) : 'Deleting a workspace needs a connection'); }
  };

  return (
    <div>
      <h3 style={heading}>Workspace</h3>
      <p style={lead}>These settings apply to <b>{ws.name}</b> only.</p>

      <section style={section}>
        <label style={labelStyle}>Picture</label>
        <PictureChooser value={ws.icon_image}
          preview={<WorkspaceIcon workspace={ws} size={72} />}
          onPick={icon_image => save({ icon_image }, 'Picture updated')}
          onRemove={() => save({ icon_image: null }, 'Picture removed')} />
        {!ws.icon_image && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Or use an emoji:</span>
            <input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={8} style={{ ...field, width: 56, textAlign: 'center', fontSize: 18, padding: '4px 6px' }} />
            <button style={secondary} disabled={!emoji.trim() || emoji === ws.icon} onClick={() => save({ icon: emoji }, 'Icon updated')}>Use</button>
          </div>
        )}
      </section>

      <section style={section}>
        <label style={labelStyle}>Name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={60} style={field}
            onKeyDown={e => e.key === 'Enter' && name.trim() && save({ name }, 'Name saved')} />
          <button style={primary} disabled={!name.trim() || name === ws.name} onClick={() => save({ name }, 'Name saved')}>Save</button>
        </div>
      </section>

      <section style={section}>
        <label style={labelStyle}>Colour</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => save({ color: c })} title={c} style={{
              width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
              border: ws.color === c ? '3px solid var(--text-primary)' : '3px solid transparent',
              boxShadow: ws.color === c ? `0 0 10px ${c}` : 'none',
            }} />
          ))}
        </div>
      </section>

      <section style={{ ...section, borderColor: 'color-mix(in srgb, var(--danger) 45%, var(--border))' }}>
        <label style={{ ...labelStyle, color: 'var(--danger)' }}>Delete workspace</label>
        {workspaces.length <= 1 ? (
          <p style={hint}>This is your only workspace, so it can't be deleted.</p>
        ) : (
          <>
            <p style={hint}>Deletes <b>{ws.name}</b> and every note, drawing and file in it, on all your devices. This can't be undone.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={`Type "${ws.name}" to confirm`} style={field} />
              <button style={{ ...primary, background: 'var(--danger)' }} disabled={confirmName !== ws.name} onClick={remove}><Trash2 size={13} /> Delete</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function WorkspacePreferencesPage() {
  const ws = useStore(s => s.activeWorkspace);
  const save = useWorkspaceSaver();
  if (!ws) return null;
  const prefs = workspaceSettings(ws);
  const editor = prefs.default_editor || 'rich';
  return (
    <div>
      <h3 style={heading}>Preferences</h3>
      <p style={lead}>How <b>{ws.name}</b> works for you.</p>
      <section style={section}>
        <label style={labelStyle}>New notes open in</label>
        <div className="seg" style={{ display: 'inline-flex', marginTop: 4 }}>
          {[['rich', 'Write'], ['markdown', 'Markdown']].map(([value, label]) => (
            <button key={value} className={editor === value ? 'on' : ''} onClick={() => save({ settings: { default_editor: value } }, `New notes will open in ${label}`)}>{label}</button>
          ))}
        </div>
        <p style={{ ...hint, marginTop: 8 }}>
          <b>Write</b> shows formatted text and understands Markdown as you type. <b>Markdown</b> shows the plain text with its symbols.
          You can switch any note at any time.
        </p>
      </section>
    </div>
  );
}

// ─────────────────────────── Server (admins) ───────────────────────────

function ServerUsersPage() {
  const user = useStore(s => s.user);
  const [users, setUsers] = useState([]);
  const load = () => api.get('/admin/users').then(({ data }) => setUsers(data.users)).catch(() => {});
  useEffect(() => { load(); }, []);

  const act = async (fn, message) => {
    try { await fn(); load(); if (message) toast.success(message); }
    catch (err) { toast.error(errorText(err)); }
  };

  return (
    <div>
      <h3 style={heading}>Users</h3>
      <p style={lead}>Everyone with an account on this Synapse server.</p>
      <AddUser onAdded={load} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {users.map(u => (
          <div key={u.id} style={{ ...section, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap' }}>
            <UserAvatar user={u} size={34} />
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{displayName(u)}{u.display_name && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {u.username}</span>}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{u.email}</div>
            </div>
            {u.mfa?.length > 0 && <span title={`Two-step: ${u.mfa.join(', ')}`} style={{ ...pill, color: 'var(--success)' }}>2-step</span>}
            <span style={{ ...pill, background: u.role === 'admin' ? 'var(--accent-subtle)' : 'var(--bg-hover)', color: u.role === 'admin' ? 'var(--accent-hover)' : 'var(--text-muted)' }}>{u.role}</span>
            {u.id !== user.id && (
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                <button style={linkBtn} onClick={() => act(() => api.patch(`/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }),
                  `${u.username} is now ${u.role === 'admin' ? 'a user' : 'an admin'}`)}>{u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
                <button style={linkBtn} onClick={() => {
                  const password = prompt(`New password for ${u.username} (min 8 characters):`);
                  if (password) act(() => api.patch(`/admin/users/${u.id}/password`, { password }), 'Password reset');
                }}>Reset password</button>
                {u.mfa?.length > 0 && (
                  <button style={linkBtn} onClick={() => {
                    if (confirm(`Turn off two-step verification for ${u.username}? Use this if they lost their phone.`)) {
                      act(() => api.post(`/admin/users/${u.id}/reset-mfa`), `Two-step verification turned off for ${u.username}`);
                    }
                  }}>Reset 2-step</button>
                )}
                <button style={{ ...linkBtn, color: 'var(--danger)' }} onClick={() => {
                  if (confirm(`Delete ${u.username} and all of their notes? This cannot be undone.`)) act(() => api.delete(`/admin/users/${u.id}`), 'User deleted');
                }}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddUser({ onAdded }) {
  const empty = { username: '', email: '', password: '', role: 'user' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/users', form);
      toast.success(`Created ${form.username}`);
      setForm(empty);
      onAdded();
    } catch (err) { toast.error(errorText(err)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ ...section, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={labelStyle}>Add a user</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={{ ...field, flex: 1, minWidth: 120 }} />
        <input placeholder="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ ...field, flex: 1, minWidth: 160 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ ...field, flex: 1, minWidth: 160 }} />
        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...field, width: 110, flex: 'none' }}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button type="submit" disabled={busy} style={{ ...primary, alignSelf: 'flex-start' }}>Create user</button>
    </form>
  );
}

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function ServerGeneralPage() {
  const [settings, setSettings] = useState(null);
  const [about, setAbout] = useState(null);
  useEffect(() => {
    api.get('/admin/settings').then(({ data }) => setSettings(data)).catch(() => {});
    api.get('/admin/about').then(({ data }) => setAbout(data)).catch(() => {});
  }, []);

  const toggleSignups = async () => {
    try {
      const { data } = await api.patch('/admin/settings', { allow_registration: !settings.allow_registration });
      setSettings(data);
      toast.success(data.allow_registration ? 'Anyone can now create an account' : 'Sign-ups are closed');
    } catch (err) { toast.error(errorText(err)); }
  };

  return (
    <div>
      <h3 style={heading}>Server</h3>
      <p style={lead}>Settings for everyone on this Synapse server.</p>
      {settings && (
        <section style={{ ...section, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Let people create their own accounts</label>
            <p style={hint}>{settings.allow_registration
              ? 'Anyone who can open Synapse can sign up. Turn this off for a private server.'
              : 'Only admins can add people (in Users). The sign-in page doesn’t offer sign-up.'}</p>
          </div>
          <button role="switch" aria-checked={settings.allow_registration} onClick={toggleSignups} className={`toggle${settings.allow_registration ? ' on' : ''}`}><span /></button>
        </section>
      )}
      {about && (
        <section style={section}>
          <label style={labelStyle}>About this server</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 6 }}>
            {[
              ['Version', about.version], ['People', about.users], ['Workspaces', about.workspaces],
              ['Notes', about.notes], ['Files', about.attachments], ['Data stored', bytes(about.data_bytes)],
              ['Storage', about.network_storage ? 'Network share' : 'This server'], ['Running for', uptime(about.uptime_seconds)],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{v}</div>
              </div>
            ))}
          </div>
          <p style={{ ...hint, marginTop: 10 }}>Update with <code>synapse update</code> on the server; back up with <code>synapse backup</code>.</p>
        </section>
      )}
    </div>
  );
}

function uptime(s) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

// ─────────────────────────── styles ───────────────────────────
const heading = { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' };
const lead = { fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 };
const section = { background: 'var(--bg-elevated)', borderRadius: 12, padding: 16, border: '1px solid var(--border)', marginBottom: 12 };
const labelStyle = { display: 'block', fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 };
const hint = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 };
const field = { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none', minWidth: 0 };
const primary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' };
const secondary = { ...primary, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' };
const dangerLink = { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)', textAlign: 'left' };
const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)', padding: '2px 5px' };
const pill = { fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'var(--bg-hover)', fontWeight: 600 };
