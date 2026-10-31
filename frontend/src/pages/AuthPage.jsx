import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import Logo from '../components/Logo';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useStore(s => s.setAuth);
  const [status, setStatus] = useState({ setupRequired: false, registrationOpen: false });

  useEffect(() => {
    api.get('/auth/status').then(({ data }) => {
      setStatus(data);
      if (data.setupRequired) setMode('register');
    }).catch(() => {});
  }, []);

  const handle = async () => {
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const { data } = await api.post(endpoint, form);
      setAuth(data.user, data.token);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: 'radial-gradient(circle at 50% 35%, var(--accent-subtle), transparent 60%), var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(400px, 100%)', padding: 40, background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }} className="fade-in">

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Logo size={72} style={{ filter: 'drop-shadow(var(--glow))' }} />
          </div>
          <h1 className="heading-text" style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>Synapse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Your connected knowledge base</p>
        </div>

        {status.setupRequired && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
            Welcome! Create the admin account to get started.
          </p>
        )}

        {/* Tabs */}
        {status.registrationOpen && !status.setupRequired && <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
          {['login', 'register'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              background: mode === m ? 'var(--accent)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>}

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            placeholder={mode === 'register' ? 'Username' : 'Username or email'}
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handle()}
            style={inputStyle}
            autoComplete="username"
          />
          {mode === 'register' && (
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handle()}
              style={inputStyle}
              autoComplete="email"
            />
          )}
          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handle()}
            style={inputStyle}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        <button
          onClick={handle}
          disabled={loading}
          style={{
            width: '100%', marginTop: 20, padding: '12px 0', borderRadius: 10, border: 'none',
            background: loading ? 'var(--text-muted)' : 'var(--accent)', color: '#fff',
            fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', cursor: loading ? 'not-allowed' : 'pointer',
            letterSpacing: '0.02em', transition: 'all 0.2s'
          }}
        >
          {loading ? '...' : mode === 'login' ? 'Sign In' : status.setupRequired ? 'Create Admin Account' : 'Create Account'}
        </button>

        {mode === 'login' && !status.registrationOpen && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>
            Need an account? Ask your Synapse admin.
          </p>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14,
  fontFamily: 'var(--font-sans)', outline: 'none', width: '100%',
  transition: 'border-color 0.2s'
};
