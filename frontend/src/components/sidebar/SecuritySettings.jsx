// Settings → Security: authenticator app (TOTP), passkeys and recovery codes.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Smartphone, KeyRound, LifeBuoy, Check, Copy, Download, Pencil, Trash2, Plus } from 'lucide-react';
import api from '../../api';
import { passkeySupport, registerPasskey, deviceName } from '../../passkeys';

const errorText = err => err?.response?.data?.error || err?.message || 'Something went wrong';
const date = s => (s ? new Date(s * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function SecuritySettings() {
  const [info, setInfo] = useState(null);
  const [totpSetup, setTotpSetup] = useState(null);   // { secret, uri, qr }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);            // freshly made recovery codes to show once
  const [confirm, setConfirm] = useState(null);        // { title, button, run(password) }
  const [busy, setBusy] = useState(false);
  const passkeys = passkeySupport();

  const load = () => api.get('/auth/security').then(({ data }) => setInfo(data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const startTotp = async () => {
    try {
      const { data } = await api.post('/auth/totp/setup');
      const qr = await QRCode.toDataURL(data.uri, { margin: 1, width: 200 });
      setTotpSetup({ ...data, qr });
      setCode('');
    } catch (err) { toast.error(errorText(err)); }
  };

  const enableTotp = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/auth/totp/enable', { code });
      setTotpSetup(null);
      toast.success('Two-step verification is on');
      if (data.recovery_codes) setCodes(data.recovery_codes);
      load();
    } catch (err) { toast.error(errorText(err)); }
    finally { setBusy(false); }
  };

  const addPasskey = async () => {
    setBusy(true);
    try {
      const data = await registerPasskey(deviceName());
      toast.success('Passkey added');
      if (data.recovery_codes) setCodes(data.recovery_codes);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const renamePasskey = async (p) => {
    const name = window.prompt('Name for this passkey:', p.name);
    if (!name) return;
    try { await api.patch(`/auth/passkeys/${encodeURIComponent(p.id)}`, { name }); load(); }
    catch (err) { toast.error(errorText(err)); }
  };

  const ask = (title, button, run) => setConfirm({ title, button, run });

  if (!info) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>;
  const on = info.totp_enabled || info.passkeys.length > 0;

  return (
    <div>
      <h3 style={heading}>Security</h3>
      <div style={{ ...banner, borderColor: on ? 'var(--success)' : 'var(--border)' }}>
        <Check size={16} style={{ color: on ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }} />
        <span>
          {on
            ? <>Two-step verification is <b>on</b>. Signing in needs your password plus your phone or a passkey.</>
            : <>Add a second step to signing in, so a stolen password isn't enough to get into your notes.</>}
        </span>
      </div>

      {/* Authenticator app */}
      <section style={section}>
        <div style={sectionHead}>
          <Smartphone size={16} style={{ color: 'var(--accent)' }} />
          <span style={sectionTitle}>Authenticator app</span>
          {info.totp_enabled && <span style={pill}>On</span>}
        </div>
        <p style={help}>Get a 6-digit code from an app like Google Authenticator, Microsoft Authenticator, 1Password or Authy.</p>

        {info.totp_enabled ? (
          <button style={dangerLink} onClick={() => ask('Turn off the authenticator app', 'Turn off', async (password) => {
            await api.post('/auth/totp/disable', { password });
            toast.success('Authenticator app turned off'); load();
          })}>Turn off</button>
        ) : totpSetup ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 4 }}>
            <img src={totpSetup.qr} alt="QR code for your authenticator app" width={150} height={150} style={{ borderRadius: 8, background: '#fff', padding: 4 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <ol style={{ paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                <li>In your authenticator app, add an account and scan this QR code.</li>
                <li>Can't scan? Enter this key instead:<br />
                  <code style={keyStyle}>{totpSetup.secret.match(/.{1,4}/g).join(' ')}</code></li>
                <li>Type the 6-digit code the app shows:</li>
              </ol>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && code.length === 6 && enableTotp()}
                  placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus
                  style={{ ...field, width: 120, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em', textAlign: 'center' }} />
                <button style={primary} disabled={busy || code.length !== 6} onClick={enableTotp}>Turn on</button>
                <button style={secondary} onClick={() => setTotpSetup(null)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <button style={primary} onClick={startTotp}>Set up</button>
        )}
      </section>

      {/* Passkeys */}
      <section style={section}>
        <div style={sectionHead}>
          <KeyRound size={16} style={{ color: 'var(--accent)' }} />
          <span style={sectionTitle}>Passkeys</span>
          {info.passkeys.length > 0 && <span style={pill}>{info.passkeys.length}</span>}
        </div>
        <p style={help}>Sign in with Face ID, Touch ID, Windows Hello, your phone or a security key. A passkey also works on its own, with no password.</p>
        {info.passkeys.map(p => (
          <div key={p.id} style={row}>
            <KeyRound size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}{p.synced && <span style={{ ...pill, marginLeft: 6 }}>synced</span>}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Added {date(p.created_at)} · Last used {date(p.last_used_at)}</div>
            </div>
            <button style={iconBtn} title="Rename" onClick={() => renamePasskey(p)}><Pencil size={13} /></button>
            <button style={{ ...iconBtn, color: 'var(--danger)' }} title="Remove" onClick={() => ask(`Remove the passkey "${p.name}"`, 'Remove', async (password) => {
              await api.delete(`/auth/passkeys/${encodeURIComponent(p.id)}`, { data: { password } });
              toast.success('Passkey removed'); load();
            })}><Trash2 size={13} /></button>
          </div>
        ))}
        {passkeys.ok
          ? <button style={{ ...primary, marginTop: 6 }} disabled={busy} onClick={addPasskey}><Plus size={14} /> Add a passkey</button>
          : <p style={{ ...help, color: 'var(--warning)', marginBottom: 0 }}>{passkeys.reason}</p>}
      </section>

      {/* Recovery codes */}
      {info.methods.length > 0 && (
        <section style={section}>
          <div style={sectionHead}>
            <LifeBuoy size={16} style={{ color: 'var(--accent)' }} />
            <span style={sectionTitle}>Recovery codes</span>
            <span style={{ ...pill, background: info.recovery_codes_left <= 2 ? 'var(--warning)' : undefined, color: info.recovery_codes_left <= 2 ? '#000' : undefined }}>
              {info.recovery_codes_left} left
            </span>
          </div>
          <p style={help}>One-time codes for signing in if you lose your phone. Each code works once.</p>
          <button style={secondary} onClick={() => ask('Make new recovery codes (the old ones stop working)', 'Make new codes', async (password) => {
            const { data } = await api.post('/auth/recovery-codes', { password });
            setCodes(data.recovery_codes); load();
          })}>Make new codes</button>
        </section>
      )}

      {/* New recovery codes: shown once */}
      {codes && (
        <div style={overlay} onClick={e => e.stopPropagation()}>
          <div style={dialog}>
            <h4 style={{ ...sectionTitle, fontSize: 16, marginBottom: 6 }}>Save your recovery codes</h4>
            <p style={help}>If you lose your phone, each of these lets you sign in once. Keep them somewhere safe, like a password manager. <b>They won't be shown again.</b></p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', padding: 14, borderRadius: 8, background: 'var(--bg-base)', fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>
              {codes.map(c => <span key={c}>{c}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button style={secondary} onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); toast.success('Copied'); }}><Copy size={13} /> Copy</button>
              <button style={secondary} onClick={() => {
                const blob = new Blob([`Synapse recovery codes (${location.host})\nEach code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'synapse-recovery-codes.txt'; a.click();
              }}><Download size={13} /> Download</button>
              <div style={{ flex: 1 }} />
              <button style={primary} onClick={() => setCodes(null)}>I've saved them</button>
            </div>
          </div>
        </div>
      )}

      {/* Password confirmation */}
      {confirm && <ConfirmPassword {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function ConfirmPassword({ title, button, run, onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await run(password); onClose(); }
    catch (err) { toast.error(errorText(err)); setBusy(false); }
  };
  return (
    <div style={overlay}>
      <div style={{ ...dialog, maxWidth: 360 }}>
        <h4 style={{ ...sectionTitle, fontSize: 15, marginBottom: 6 }}>{title}</h4>
        <p style={help}>Enter your password to confirm.</p>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="current-password"
          onKeyDown={e => e.key === 'Enter' && password && submit()} placeholder="Password" style={{ ...field, width: '100%' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button style={secondary} onClick={onClose}>Cancel</button>
          <button style={{ ...primary, background: 'var(--danger)' }} disabled={busy || !password} onClick={submit}>{button}</button>
        </div>
      </div>
    </div>
  );
}

const heading = { fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 14, color: 'var(--text-primary)' };
const banner = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '1px solid', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 };
const section = { background: 'var(--bg-elevated)', borderRadius: 10, padding: 16, border: '1px solid var(--border)', marginBottom: 12 };
const sectionHead = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 };
const sectionTitle = { fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' };
const help = { fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 };
const pill = { fontSize: 10.5, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: 'var(--accent-subtle)', color: 'var(--accent-hover)' };
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', marginBottom: 6 };
const field = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none' };
const primary = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' };
const secondary = { ...primary, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' };
const dangerLink = { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'var(--font-sans)' };
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' };
const keyStyle = { fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-primary)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: 4, userSelect: 'all', wordBreak: 'break-all' };
const overlay = { position: 'fixed', inset: 0, background: 'rgba(5,6,20,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 };
const dialog = { width: '100%', maxWidth: 440, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow)' };
