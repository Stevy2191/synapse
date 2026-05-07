import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useStore(s => s.setAuth);

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
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, padding: 40, background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)' }} className="fade-in">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🧠</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Synapse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Your connected knowledge base</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
          {['login', 'register'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              background: mode === m ? 'var(--accent)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            placeholder="Username or email"
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handle()}
            style={inputStyle}
          />
          {mode === 'register' && (
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              style={inputStyle}
            />
          )}
          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handle()}
            style={inputStyle}
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
          {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        {mode === 'register' && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>
            First registered user becomes admin
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
