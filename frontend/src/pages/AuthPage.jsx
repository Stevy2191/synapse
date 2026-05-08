import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';

function SynapseLogo() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Glow filter */}
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="nodeGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#818cf8"/>
          <stop offset="100%" stopColor="#6366f1"/>
        </radialGradient>
        <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a5b4fc"/>
          <stop offset="100%" stopColor="#6366f1"/>
        </radialGradient>
      </defs>

      {/* Axon lines / connections */}
      <g filter="url(#glow)" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
        {/* Center to nodes */}
        <line x1="36" y1="36" x2="16" y2="16"/>
        <line x1="36" y1="36" x2="56" y2="14"/>
        <line x1="36" y1="36" x2="62" y2="38"/>
        <line x1="36" y1="36" x2="52" y2="58"/>
        <line x1="36" y1="36" x2="18" y2="56"/>
        <line x1="36" y1="36" x2="10" y2="38"/>
        {/* Cross connections */}
        <line x1="16" y1="16" x2="56" y2="14" strokeDasharray="3 3" opacity="0.4"/>
        <line x1="62" y1="38" x2="52" y2="58" strokeDasharray="3 3" opacity="0.4"/>
        <line x1="10" y1="38" x2="18" y2="56" strokeDasharray="3 3" opacity="0.4"/>
      </g>

      {/* Dendrite tips - small dots on lines */}
      <g fill="#818cf8" opacity="0.5">
        <circle cx="8" cy="12" r="1.5"/>
        <circle cx="20" cy="8" r="1.5"/>
        <circle cx="66" cy="10" r="1.5"/>
        <circle cx="68" cy="42" r="1.5"/>
        <circle cx="56" cy="64" r="1.5"/>
        <circle cx="14" cy="62" r="1.5"/>
        <circle cx="6" cy="34" r="1.5"/>
      </g>

      {/* Outer nodes */}
      <g filter="url(#glow)">
        <circle cx="16" cy="16" r="5" fill="url(#nodeGrad)" opacity="0.9"/>
        <circle cx="56" cy="14" r="4" fill="url(#nodeGrad)" opacity="0.85"/>
        <circle cx="62" cy="38" r="4.5" fill="url(#nodeGrad)" opacity="0.9"/>
        <circle cx="52" cy="58" r="4" fill="url(#nodeGrad)" opacity="0.85"/>
        <circle cx="18" cy="56" r="5" fill="url(#nodeGrad)" opacity="0.9"/>
        <circle cx="10" cy="38" r="3.5" fill="url(#nodeGrad)" opacity="0.8"/>
      </g>

      {/* Center node - synaptic terminal */}
      <circle cx="36" cy="36" r="9" fill="url(#centerGrad)" filter="url(#glow)"/>
      <circle cx="36" cy="36" r="5" fill="white" opacity="0.25"/>
      <circle cx="36" cy="36" r="2.5" fill="white" opacity="0.6"/>
    </svg>
  );
}

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
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <SynapseLogo />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Synapse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Your connected knowledge base</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
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
        </div>

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
