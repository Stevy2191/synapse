// Settings → Server → Email (admin): the mail account Synapse sends from (daily emails, tests).
import { useEffect, useState } from 'react';
import { Send, Check, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { Row, Group } from '../meetings/MeetingSettings';

const errText = err => err?.response?.data?.error || (err?.response ? 'Something went wrong' : 'This needs a connection to the server');

export default function EmailSettings({ styles }) {
  const { heading, lead, field } = styles;
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/admin/email').then(r => { setS(r.data); setForm({ ...r.data, pass: '', app_url: r.data.app_url || window.location.origin }); }).catch(err => toast.error(errText(err)));
  useEffect(() => { load(); }, []);
  if (!s || !form) return <div><h3 style={heading}>Email</h3><p style={lead}>Loading…</p></div>;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSecurity = v => setForm(f => ({ ...f, security: v, port: v === 'tls' ? 465 : v === 'starttls' ? 587 : f.port === 465 || f.port === 587 ? 25 : f.port }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { host: form.host, port: Number(form.port), security: form.security, user: form.user, from: form.from, app_url: form.app_url };
      if (form.pass) body.pass = form.pass;
      const { data } = await api.patch('/admin/email', body);
      setS(data); setForm(f => ({ ...f, pass: '' }));
      toast.success('Saved');
      return true;
    } catch (err) { toast.error(errText(err)); return false; } finally { setBusy(false); }
  };
  const test = async () => {
    if (!(await save())) return;
    setBusy(true);
    try { const { data } = await api.post('/admin/email/test', { to: testTo }); toast.success(`Test email sent to ${data.to}`); } catch (err) { toast.error(errText(err), { duration: 9000 }); } finally { setBusy(false); }
  };
  const input = (k, props = {}) => <input value={form[k] ?? ''} onChange={e => set(k, e.target.value)} style={{ ...field, width: 240, flex: '0 0 auto' }} {...props} />;

  return (
    <div className="spage">
      <h3 style={heading}>Email {s.configured && <span className="sbadge ok"><Check size={11} /> Set up</span>}</h3>
      <p style={lead}>The mail account Synapse sends email from — used for the daily email with each person’s meetings and to-dos (Settings → Reminders). Any provider that offers SMTP works.</p>

      <Group title="Mail server (SMTP)">
        <Row title="Server" desc="e.g. smtp.gmail.com, smtp.mail.me.com (iCloud), smtp.protonmail.ch (Proton, paid plans), or your own">{input('host', { placeholder: 'smtp.example.com', autoComplete: 'off' })}</Row>
        <Row title="Security" desc="Most providers: STARTTLS on port 587, or SSL/TLS on port 465.">
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={form.security} onChange={e => setSecurity(e.target.value)} style={{ ...field, flex: '0 0 auto' }}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">SSL/TLS</option>
              <option value="none">None (local relay only)</option>
            </select>
            <input type="number" value={form.port} onChange={e => set('port', e.target.value)} style={{ ...field, width: 80, flex: '0 0 auto' }} aria-label="Port" />
          </div>
        </Row>
        <Row title="Username" desc="Usually the full email address. Leave empty if your server doesn’t need a sign-in.">{input('user', { placeholder: 'you@example.com', autoComplete: 'off' })}</Row>
        <Row title="Password" desc={s.pass_set ? 'Saved (hidden). Type a new one to change it.' : 'Gmail, iCloud and Outlook need an “app password” from your account’s security settings, not your normal password.'}>
          {input('pass', { type: 'password', placeholder: s.pass_set ? '••••••••' : 'App password', autoComplete: 'new-password' })}
        </Row>
        <Row title="From" desc="Who the email says it’s from. Most providers require your own address here.">{input('from', { placeholder: 'Synapse <you@example.com>' })}</Row>
        <Row title="Synapse address" desc="The address people open Synapse at — used for the links in emails.">{input('app_url', { placeholder: 'https://notes.example.com' })}</Row>
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
          <button type="button" className="export-go" disabled={busy} onClick={save}>Save</button>
        </div>
      </Group>

      <Group title="Check it works">
        <Row title="Send a test email" desc="Saves the settings above, then sends a short test. Leave the address empty to send it to your own account’s email.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Your account’s email" style={{ ...field, width: 200, flex: '0 0 auto' }} />
            <button type="button" className="btn-ghost" disabled={busy || !form.host || !form.from} onClick={test}><Send size={13} /> Send</button>
          </div>
        </Row>
        <p className="srow-note"><Info size={13} /> The password is stored encrypted on this server. If a test fails, the message says what the mail server answered.</p>
      </Group>
    </div>
  );
}
