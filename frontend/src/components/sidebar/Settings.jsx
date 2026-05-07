import { useState } from 'react';
import { X, User, Palette, Shield, LogOut } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { THEMES } from '../../themes';
import api from '../../api';
import toast from 'react-hot-toast';

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
        width: 640, height: 480, background: 'var(--bg-surface)', borderRadius: 16,
        border: '1px solid var(--border)', display: 'flex', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)'
      }} onClick={e => e.stopPropagation()} className="fade-in">
        {/* Sidebar */}
        <div style={{ width: 160, background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)', padding: '20px 12px', display: 'flex', flexDirection: 'column' }}>
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
          <button onClick={() => { logout(); setSettingsOpen(false); }} style={{
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {Object.entries(THEMES).map(([key, theme]) => (
                  <div key={key} onClick={() => setTheme(key)} style={{
                    padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                    border: `2px solid ${user?.theme === key ? 'var(--accent)' : 'var(--border)'}`,
                    background: theme.vars['--bg-surface'], transition: 'all 0.2s',
                    transform: user?.theme === key ? 'scale(1.03)' : 'scale(1)'
                  }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{theme.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: theme.vars['--text-primary'] }}>{theme.label}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      {[theme.vars['--accent'], theme.vars['--success'], theme.vars['--warning']].map((c, i) => (
                        <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: c }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
            </div>
          )}

          {tab === 'admin' && (
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>User Management</h3>
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
                      <button onClick={async () => {
                        if (!confirm(`Delete user ${u.username}?`)) return;
                        try { await api.delete(`/admin/users/${u.id}`); loadUsers(); toast.success('User deleted'); } catch { toast.error('Failed'); }
                      }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11, fontWeight: 600 }}>Remove</button>
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
