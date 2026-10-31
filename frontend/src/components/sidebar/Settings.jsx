import { useState } from 'react';
import { X, User, Palette, Shield, LogOut } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { THEMES } from '../../themes';
import api from '../../api';
import toast from 'react-hot-toast';
import { signOut } from '../../offline/sync';

export default function Settings() {
  const { user, setTheme, logout, settingsOpen, setSettingsOpen } = useStore(s => ({
    user: s.user, setTheme: s.setTheme, logout: s.logout,
    settingsOpen: s.settingsOpen, setSettingsOpen: s.setSettingsOpen
  }));
  const [tab, setTab] = useState('appearance');
  const [adminUsers, setAdminUsers] = useState([]);

  const loadUsers = async () => {
    try {
      const { data } = await api.get('/admin/users');
      setAdminUsers(data.users);
    } catch {}
  };

  if (!settingsOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
    }} onClick={() => setSettingsOpen(false)}>
      <div style={{
        width: 'min(680px, calc(100vw - 24px))', height: 'min(520px, calc(100vh - 24px))', background: 'var(--bg-surface)', borderRadius: 16,
        border: '1px solid var(--border)', display: 'flex', overflow: 'hidden', position: 'relative',
        boxShadow: 'var(--shadow)'
      }} onClick={e => e.stopPropagation()} className="fade-in">
        {/* Sidebar */}
        <div style={{ width: 160, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', padding: '20px 12px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, padding: '0 8px', marginBottom: 16, color: 'var(--text-primary)' }}>Settings</h2>
          {[
            ['appearance', <Palette size={14}/>, 'Appearance'],
            ['account', <User size={14}/>, 'Account'],
            ...(user?.role === 'admin' ? [['admin', <Shield size={14}/>, 'Admin']] : [])
          ].map(([id, icon, label]) => (
            <button key={id} onClick={() => { setTab(id); if (id === 'admin') loadUsers(); }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-sans)', marginBottom: 2, textAlign: 'left',
              background: tab === id ? 'var(--accent-subtle)' : 'transparent',
              color: tab === id ? 'var(--accent-hover)' : 'var(--text-secondary)', transition: 'all 0.15s'
            }}>
              {icon}{label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={async () => { if (await signOut()) setSettingsOpen(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, background: 'transparent', color: 'var(--danger)', fontFamily: 'var(--font-sans)'
          }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
          <button onClick={() => setSettingsOpen(false)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>

          {tab === 'appearance' && (
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>Theme</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
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
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>
                Auto uses Neural or Neural Light to match your device's light/dark setting.
              </p>
            </div>
          )}

          {tab === 'account' && (
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>Account</h3>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 20, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff' }}>
                    {user?.username?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{user?.username}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.email}</div>
                  </div>
                  {user?.role === 'admin' && (
                    <span style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 12, background: 'var(--accent-subtle)', color: 'var(--accent-hover)', fontSize: 11, fontWeight: 700, border: '1px solid var(--accent)33' }}>ADMIN</span>
                  )}
                </div>
              </div>
              <ChangePassword />
            </div>
          )}

          {tab === 'admin' && (
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>User Management</h3>
              <AddUser onAdded={loadUsers} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {adminUsers.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: u.role === 'admin' ? 'var(--accent-subtle)' : 'var(--bg-hover)', color: u.role === 'admin' ? 'var(--accent-hover)' : 'var(--text-muted)', fontWeight: 600 }}>{u.role}</span>
                    {u.id !== user.id && (
                      <>
                        <button onClick={async () => {
                          const role = u.role === 'admin' ? 'user' : 'admin';
                          try { await api.patch(`/admin/users/${u.id}/role`, { role }); loadUsers(); toast.success(`${u.username} is now ${role === 'admin' ? 'an admin' : 'a user'}`); }
                          catch (err) { toast.error(errorMessage(err)); }
                        }} style={linkBtn}>{u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
                        <button onClick={async () => {
                          const password = prompt(`New password for ${u.username} (min 8 characters):`);
                          if (!password) return;
                          try { await api.patch(`/admin/users/${u.id}/password`, { password }); toast.success('Password reset'); }
                          catch (err) { toast.error(errorMessage(err)); }
                        }} style={linkBtn}>Reset password</button>
                        <button onClick={async () => {
                          if (!confirm(`Delete user ${u.username} and all of their notes? This cannot be undone.`)) return;
                          try { await api.delete(`/admin/users/${u.id}`); loadUsers(); toast.success('User deleted'); }
                          catch (err) { toast.error(errorMessage(err)); }
                        }} style={{ ...linkBtn, color: 'var(--danger)' }}>Remove</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-sans)', padding: '2px 4px' };

const fieldStyle = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)',
  color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none', width: '100%'
};

const primaryBtn = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', alignSelf: 'flex-start'
};

const sectionStyle = { background: 'var(--bg-elevated)', borderRadius: 10, padding: 16, border: '1px solid var(--border)', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 };
const sectionTitle = { fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 };

function errorMessage(err) {
  return err?.response?.data?.error || 'Something went wrong';
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
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={sectionStyle}>
      <div style={sectionTitle}>Change password</div>
      <input type="password" placeholder="Current password" autoComplete="current-password" value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} style={fieldStyle} />
      <input type="password" placeholder="New password (min 8 characters)" autoComplete="new-password" value={form.next} onChange={e => setForm(f => ({ ...f, next: e.target.value }))} style={fieldStyle} />
      <input type="password" placeholder="Confirm new password" autoComplete="new-password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} style={fieldStyle} />
      <button type="submit" disabled={busy || !form.current || !form.next} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>Update password</button>
    </form>
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
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ ...sectionStyle, marginTop: 0, marginBottom: 16 }}>
      <div style={sectionTitle}>Add a user</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={fieldStyle} />
        <input placeholder="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={fieldStyle} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={fieldStyle} />
        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...fieldStyle, width: 110 }}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>Create user</button>
    </form>
  );
}
