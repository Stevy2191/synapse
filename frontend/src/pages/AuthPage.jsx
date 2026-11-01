import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api';
import { useStore } from '../stores/useStore';
import Logo from '../components/Logo';
import { KeyRound, ShieldCheck, ArrowLeft } from 'lucide-react';
import { passkeySupport, signInWithPasskey } from '../passkeys';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '', setup_code: '' });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useStore(s => s.setAuth);
  const [status, setStatus] = useState({ setupRequired: false, setupCodeRequired: false, registrationOpen: false });

  useEffect(() => {
    api.get('/auth/status').then(({ data }) => {
      setStatus(data);
      if (data.setupRequired) setMode('register');
    }).catch(() => {});
  }, []);

  // Second step of sign-in, when the account has two-step verification
  const [mfa, setMfa] = useState(null);           // { token, methods }
  const [mfaMode, setMfaMode] = useState('totp');  // 'totp' | 'recovery'
  const [code, setCode] = useState('');
  const passkeys = passkeySupport();

  const finish = (data) => {
    setAuth(data.user, data.token);
    if (typeof data.recovery_codes_left === 'number') {
      toast(data.recovery_codes_left > 0
        ? `Recovery code used. ${data.recovery_codes_left} left. Make new ones in Settings → Security.`
        : 'That was your last recovery code. Make new ones in Settings → Security.', { icon: '🔑', duration: 8000 });
    }
    navigate('/');
  };

  const usePasskey = async (mfaToken) => {
    setLoading(true);
    try { finish(await signInWithPasskey(mfaToken)); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const submitCode = async (value = code) => {
    if (!value.trim() || loading) return;
    setLoading(true);
    try {
      const path = mfaMode === 'totp' ? '/auth/mfa/totp' : '/auth/mfa/recovery';
      const { data } = await api.post(path, { mfa_token: mfa.token, code: value });
      finish(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong');
      if (err.response?.status === 401 && /again/.test(err.response?.data?.error || '')) setMfa(null);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handle = async () => {
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const { data } = await api.post(endpoint, form);
      if (data.mfa_required) {
        setMfa({ token: data.mfa_token, methods: data.methods });
        setMfaMode(data.methods.includes('totp') ? 'totp' : 'recovery');
        setCode('');
        // Only a passkey set up (no authenticator app)? Ask for it straight away.
        if (!data.methods.includes('totp') && data.methods.includes('passkey') && passkeys.ok) {
          setLoading(false);
          usePasskey(data.mfa_token);
        }
        return;
      }
      finish(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: 'radial-gradient(circle at 50% 35%, var(--accent-subtle), transparent 60%), var(--bg-base)', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(400px, 100%)', padding: 40, background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }} className="fade-in">

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Logo size={72} style={{ filter: 'drop-shadow(var(--glow))' }} />
          </div>
          <h1 className="heading-text" style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>Synapse</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Your connected knowledge base</p>
        </div>

        {mfa ? (
          <div className="fade-in">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
              <h2 style={{ font: '600 18px var(--font-display)', color: 'var(--text-primary)' }}>Two-step verification</h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5 }}>
              {mfaMode === 'totp'
                ? 'Enter the 6-digit code from your authenticator app.'
                : 'Enter one of the recovery codes you saved when you set up two-step verification.'}
            </p>
            {(mfa.methods.includes('totp') || mfaMode === 'recovery') && (
              // A real form with a field marked as a one-time code, so password managers
              // (Bitwarden, 1Password, the browser's own) recognise it and offer to fill it.
              <form id="mfa-form" name="mfa" method="post" action="#" autoComplete="on"
                onSubmit={e => { e.preventDefault(); submitCode(); }}>
                <input type="text" name="username" autoComplete="username" value={form.username} readOnly hidden />
                {mfaMode === 'totp' ? (
                  <input
                    key="totp"
                    id="totp"
                    name="totp"
                    type="text"
                    aria-label="Authenticator code"
                    value={code}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setCode(digits);
                      // Six digits typed, pasted or filled in by a password manager: sign in straight away.
                      if (digits.length === 6) submitCode(digits);
                    }}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    autoFocus
                    style={codeStyle}
                  />
                ) : (
                  <input
                    key="recovery"
                    id="recovery-code"
                    name="recovery_code"
                    type="text"
                    aria-label="Recovery code"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="abcde-12345"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    style={codeStyle}
                  />
                )}
                <button type="submit" disabled={loading || !code.trim()} style={{ ...primaryBtn, opacity: loading || !code.trim() ? 0.6 : 1 }}>
                  {loading ? '…' : 'Verify'}
                </button>
              </form>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {mfa.methods.includes('passkey') && (
                passkeys.ok
                  ? <button onClick={() => usePasskey(mfa.token)} disabled={loading} style={secondaryBtn}><KeyRound size={15} /> Use a passkey</button>
                  : <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{passkeys.reason}</p>
              )}
              {mfaMode === 'totp' && mfa.methods.includes('recovery') && (
                <button onClick={() => { setMfaMode('recovery'); setCode(''); }} style={linkBtn}>Lost your phone? Use a recovery code</button>
              )}
              {mfaMode === 'recovery' && mfa.methods.includes('totp') && (
                <button onClick={() => { setMfaMode('totp'); setCode(''); }} style={linkBtn}>Use the authenticator app instead</button>
              )}
              <button onClick={() => { setMfa(null); setCode(''); }} style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <ArrowLeft size={13} /> Back to sign in
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 18, lineHeight: 1.5, textAlign: 'center' }}>
              No phone and no recovery codes? An admin can turn off two-step verification for you.
            </p>
          </div>
        ) : (<>
        {status.setupRequired && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
            Welcome! Create the admin account to get started.
          </p>
        )}

        {/* Tabs */}
        {status.registrationOpen && !status.setupRequired && <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
          {['login', 'register'].map(m => (
            <button key={m} type="button" onClick={() => setMode(m)} style={{
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

        {/* Fields: a real form with named fields, so password managers can fill them */}
        <form id="login-form" name={mode === 'login' ? 'login' : 'register'} method="post" action="#" autoComplete="on"
          onSubmit={e => { e.preventDefault(); handle(); }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && status.setupCodeRequired && (
            <div>
              <input
                placeholder="Setup code (e.g. K7QF-M2XP)"
                value={form.setup_code}
                onChange={e => setForm(f => ({ ...f, setup_code: e.target.value.toUpperCase() }))}
                name="setup_code"
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textAlign: 'center' }}
                autoComplete="one-time-code"
                autoFocus
              />
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                The installer showed this code. Lost it? Run <code style={{ fontFamily: 'var(--font-mono)' }}>synapse setup-code</code> on the server.
              </p>
            </div>
          )}
          <input
            placeholder={mode === 'register' ? 'Username' : 'Username or email'}
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            id="username"
            name="username"
            type="text"
            autoCapitalize="none"
            style={inputStyle}
            autoComplete="username"
          />
          {mode === 'register' && (
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              id="email"
              name="email"
              style={inputStyle}
              autoComplete="email"
            />
          )}
          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            id="password"
            name="password"
            style={inputStyle}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </div>

        <button
          type="submit"
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
        </form>

        {mode === 'login' && !status.setupRequired && passkeys.ok && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} /> or <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <button onClick={() => usePasskey()} disabled={loading} style={{ ...secondaryBtn, marginTop: 14 }}>
              <KeyRound size={15} /> Sign in with a passkey
            </button>
          </>
        )}

        {mode === 'login' && !status.registrationOpen && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, marginTop: 16 }}>
            Need an account? Ask your Synapse admin.
          </p>
        )}
        </>)}
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

const primaryBtn = {
  width: '100%', marginTop: 14, padding: '12px 0', borderRadius: 10, border: 'none',
  background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700,
  fontFamily: 'var(--font-display)', cursor: 'pointer', boxShadow: 'var(--glow)',
};
const secondaryBtn = {
  width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', font: '600 14px var(--font-sans)', cursor: 'pointer',
};
const linkBtn = {
  background: 'none', border: 'none', color: 'var(--accent-hover)', font: '500 13px var(--font-sans)', cursor: 'pointer', padding: 4,
};
const codeStyle = {
  ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 22, letterSpacing: '0.25em', textAlign: 'center', padding: '12px 14px',
};
