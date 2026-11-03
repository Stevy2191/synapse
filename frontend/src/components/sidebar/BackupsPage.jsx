// Settings → Server → Backups: automatic backups (schedule, how many to keep, optional password),
// the list of backups with Download / Restore / Delete, "Back up now" and restoring from a file.
import { useEffect, useRef, useState } from 'react';
import {
  HardDriveDownload, Download, RotateCcw, Trash2, Lock, Upload, CheckCircle2, AlertTriangle, Loader2, FolderOpen, KeyRound, Cloud, CloudUpload, CloudDownload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';

const errorText = err => err?.response?.data?.error || (err?.response ? err.message : 'You’re offline — backups need a connection to the server');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND = { automatic: 'Automatic', manual: 'Made by hand', 'before-restore': 'Before a restore', command: 'Made with the synapse command', other: 'Added' };

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
const when = s => new Date(s * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export default function BackupsPage({ styles, onGo }) {
  const { heading, lead, section, labelStyle, hint, field, primary, secondary } = styles;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(null); // backup being restored (dialog)
  const [restarting, setRestarting] = useState(null); // { name, failed }
  const [uploadPct, setUploadPct] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.get('/backups').then(({ data }) => setStatus(data)).catch(err => toast.error(errorText(err)));
  useEffect(() => { load(); }, []);
  // While a copy is uploading to the cloud (or waiting), refresh so progress shows.
  const cloudBusy = !!(status?.cloud?.uploading || status?.cloud?.waiting?.length);
  useEffect(() => {
    if (!cloudBusy) return undefined;
    const t = setInterval(() => api.get('/backups').then(({ data }) => setStatus(data)).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [cloudBusy]);
  const copyToCloud = async b => {
    try { const { data } = await api.post(`/backups/cloud/copy/${encodeURIComponent(b.name)}`); setStatus(data); toast.success(`Copying to ${data.cloud.target.label}…`); } catch (err) { toast.error(errorText(err)); }
  };

  const save = async fields => {
    try { const { data } = await api.patch('/backups/settings', fields); setStatus(data); return true; } catch (err) { toast.error(errorText(err)); return false; }
  };

  const backUpNow = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/backups/run', {}, { timeout: 30 * 60_000 });
      setStatus(data);
      toast.success(`Backup saved (${bytes(data.result.size)})`);
      if (data.cloud?.target) { setTimeout(load, 1500); setTimeout(load, 5000); } // the cloud copy runs on its own
    } catch (err) { toast.error(errorText(err)); load(); } finally { setBusy(false); }
  };

  const download = async b => {
    try {
      const { data } = await api.post(`/backups/${encodeURIComponent(b.name)}/link`);
      const a = document.createElement('a');
      a.href = data.url; a.download = b.name; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { toast.error(errorText(err)); }
  };

  const remove = async b => {
    if (!confirm(`Delete the backup from ${when(b.created_at)}? This can’t be undone.`)) return;
    try { const { data } = await api.delete(`/backups/${encodeURIComponent(b.name)}`); setStatus(data); toast.success('Backup deleted'); } catch (err) { toast.error(errorText(err)); }
  };

  const uploadFile = async file => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setUploadPct(0);
    try {
      const { data } = await api.post('/backups/upload', form, {
        timeout: 0,
        onUploadProgress: e => e.total && setUploadPct(Math.round((e.loaded / e.total) * 100)),
      });
      setStatus(data);
      toast.success('Backup added — choose Restore on it to bring it back');
    } catch (err) { toast.error(errorText(err)); } finally { setUploadPct(null); if (fileRef.current) fileRef.current.value = ''; }
  };

  // After a restore Synapse restarts; wait for it to come back, then reload the app.
  useEffect(() => {
    if (!restarting || restarting.failed) return undefined;
    let stop = false;
    const started = Date.now();
    (async () => {
      await new Promise(r => setTimeout(r, 2500));
      while (!stop) {
        try {
          const res = await fetch('/api/config', { cache: 'no-store' });
          if (res.ok) { location.reload(); return; }
        } catch { /* still restarting */ }
        if (Date.now() - started > 120_000) { setRestarting(r => ({ ...r, failed: true })); return; }
        await new Promise(r => setTimeout(r, 2000));
      }
    })();
    return () => { stop = true; };
  }, [restarting]);

  if (!status) return <div><h3 style={heading}>Backups</h3><p style={lead}>Loading…</p></div>;
  const s = status.settings;
  const last = status.last;
  const customFolder = status.folder_mounted && status.folder_host && status.folder_host !== './backups';
  const recentRestore = status.restored && Date.now() / 1000 - status.restored.at < 3 * 86400 ? status.restored : null;

  return (
    <div className="backup-page">
      <h3 style={heading}>Backups</h3>
      <p style={lead}>Synapse saves a copy of everything — every person’s notes, drawings, pictures, chats and accounts — on a schedule. If something goes wrong, restore a backup to put it all back the way it was.</p>

      {recentRestore && (
        <section style={{ ...section, borderColor: 'var(--accent)' }}>
          <p style={{ ...hint, marginTop: 0, color: 'var(--text-primary)' }}><CheckCircle2 size={14} style={{ verticalAlign: -2, color: 'var(--success, #22c55e)' }} /> Restored from <b>{recentRestore.name}</b> on {when(recentRestore.at)}. A copy of what was there before is in the list as “Before a restore”.</p>
        </section>
      )}

      {/* Status */}
      <section style={{ ...section, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle}>Latest backup</label>
          {!last && <p style={{ ...hint, marginTop: 0 }}>None yet.</p>}
          {last?.ok && <p style={{ ...hint, marginTop: 0 }}><CheckCircle2 size={13} style={{ verticalAlign: -2, color: 'var(--success, #22c55e)' }} /> {when(last.at)} · {bytes(last.size)}</p>}
          {last && !last.ok && <p style={{ ...hint, marginTop: 0, color: 'var(--danger)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Failed {when(last.at)}: {last.error}</p>}
          <p style={{ ...hint, marginTop: 4 }}>{s.schedule === 'off' ? 'Automatic backups are off.' : status.next_run ? `Next automatic backup: ${when(status.next_run)}` : ''}</p>
        </div>
        <button style={primary} onClick={backUpNow} disabled={busy || status.running}>
          {busy ? <Loader2 size={14} className="spin" /> : <HardDriveDownload size={14} />} {busy ? 'Backing up…' : 'Back up now'}
        </button>
      </section>

      <Schedule s={s} save={save} styles={styles} />

      {/* Where */}
      <section style={section}>
        <label style={labelStyle}><FolderOpen size={14} style={{ verticalAlign: -2 }} /> Where backups are saved</label>
        <p style={{ ...hint, marginTop: 0 }}>
          {customFolder
            ? <>In <b>{status.folder_host}</b> on the server.</>
            : status.folder_mounted
              ? <>In the <b>backups</b> folder next to your notes, inside Synapse’s folder on the server.</>
              : <>Inside the data folder on the server (<code>{status.inside_data ? 'data/backups' : status.folder}</code>).</>}
        </p>
        <p style={hint}>
          {customFolder
            ? 'To save them somewhere else, run this on the server with the new folder (or “default” to go back to the backups folder next to your notes):'
            : 'Backups on the same disk as Synapse won’t help if that disk fails. To save them on a NAS (an NFS or SMB share mounted on the server) or another drive instead, run this once on the server, with the path to your share:'}
        </p>
        <pre className="backup-cmd">synapse backups-to "/path/to/NFS-or-SMB-share"</pre>
        <p style={hint}>You can also copy a backup file into that folder yourself — it shows up in the list below.</p>
      </section>

      <CloudCopies status={status} setStatus={setStatus} styles={styles} onGo={onGo} />

      <Password s={s} save={save} styles={styles} />

      {/* List */}
      <section style={section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>Your backups ({status.backups.length})</label>
          <input ref={fileRef} type="file" accept=".gz,.enc,application/gzip" style={{ display: 'none' }} onChange={e => uploadFile(e.target.files[0])} />
          <button style={secondary} onClick={() => fileRef.current?.click()} disabled={uploadPct !== null} title="Add a backup file from your computer (for example from an old server)">
            <Upload size={14} /> {uploadPct !== null ? `Uploading ${uploadPct}%` : 'Add a backup file'}
          </button>
        </div>
        {!status.backups.length && <p style={{ ...hint, marginTop: 0 }}>No backups yet. Choose “Back up now”, or wait for the first automatic one.</p>}
        <div className="backup-list">
          {status.backups.map(b => (
            <div key={b.name} className="backup-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="backup-when">
                  {b.encrypted && <Lock size={12} aria-label="Protected with a password" />} {when(b.created_at)}
                </div>
                <div className="backup-meta">
                  {bytes(b.size)} · {KIND[b.kind]}{b.encrypted && b.current_password === false ? ' · needs an older password' : ''}
                  {status.cloud?.uploading?.name === b.name
                    ? <span className="backup-cloud-tag"> · <CloudUpload size={11} /> copying to {status.cloud.target?.label} {Math.floor((status.cloud.uploading.done / Math.max(1, status.cloud.uploading.total)) * 100)}%</span>
                    : status.cloud?.waiting?.includes(b.name) ? <span className="backup-cloud-tag"> · <CloudUpload size={11} /> waiting to copy to {status.cloud.target?.label}</span> : null}
                </div>
              </div>
              {status.cloud?.target && <button className="btn-ghost" onClick={() => copyToCloud(b)} title={`Copy this backup to ${status.cloud.target.label}`}><CloudUpload size={14} /></button>}
              <button className="btn-ghost" onClick={() => download(b)} title="Download this backup"><Download size={14} /></button>
              <button className="btn-ghost" onClick={() => setRestoring(b)} title="Put everything back the way it was in this backup"><RotateCcw size={14} /> Restore</button>
              <button className="btn-ghost danger-hover" onClick={() => remove(b)} title="Delete this backup"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <p style={hint}>Keeps the newest {s.keep} automatic backup{s.keep === 1 ? '' : 's'}; ones you make by hand stay until you delete them.</p>
      </section>

      {restoring && <RestoreDialog backup={restoring} styles={styles} onClose={() => setRestoring(null)} onStarted={() => { setRestarting({ name: restoring.name }); setRestoring(null); }} />}
      {restarting && (
        <div className="backup-overlay">
          <div className="backup-overlay-box">
            {restarting.failed ? (
              <>
                <AlertTriangle size={26} style={{ color: 'var(--danger)' }} />
                <h3>Synapse hasn’t come back yet</h3>
                <p>The backup is ready and will be put in place when Synapse starts. If it doesn’t start by itself, run <code>synapse start</code> on the server, then reload this page.</p>
                <button style={primary} onClick={() => location.reload()}>Reload</button>
              </>
            ) : (
              <>
                <Loader2 size={26} className="spin" style={{ color: 'var(--accent)' }} />
                <h3>Restoring…</h3>
                <p>Synapse is restarting with the backup. This page reloads by itself when it’s back — usually within a minute.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CloudCopies({ status, setStatus, styles, onGo }) {
  const { section, labelStyle, hint, field, primary, secondary } = styles;
  const c = status.cloud || {};
  const t = c.target;
  const [keep, setKeep] = useState(t?.keep ?? 7);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState(null); // backups in the cloud folder (loaded on request)
  const [fetching, setFetching] = useState(null);
  useEffect(() => { setKeep(t?.keep ?? 7); }, [t?.keep]);

  const patch = async (body, done) => {
    setBusy(true);
    try { const { data } = await api.patch('/backups/cloud', body, { timeout: 60_000 }); setStatus(data); if (done) toast.success(done); return true; } catch (err) { toast.error(errorText(err)); return false; } finally { setBusy(false); }
  };
  const loadFiles = async () => {
    setFiles('loading');
    try { const { data } = await api.get('/backups/cloud/files', { timeout: 60_000 }); setFiles(data.files); } catch (err) { toast.error(errorText(err)); setFiles(null); }
  };
  const fetchOne = async f => {
    setFetching(f.id);
    try {
      const { data } = await api.post(`/backups/cloud/files/${encodeURIComponent(f.id)}/fetch`, {}, { timeout: 0 });
      setStatus(data);
      setFiles(fs => (Array.isArray(fs) ? fs.map(x => (x.id === f.id ? { ...x, on_server: true } : x)) : fs));
      toast.success('Copied to this server — it’s in “Your backups” below, ready to restore');
    } catch (err) { toast.error(errorText(err)); } finally { setFetching(null); }
  };

  const last = c.last;
  const noPassword = !status.settings.password_set;
  return (
    <section style={section}>
      <label style={labelStyle}><Cloud size={14} style={{ verticalAlign: -2 }} /> Copies in OneDrive or Google Drive</label>
      {!c.configured?.length ? (
        <p style={{ ...hint, marginTop: 0 }}>Keep a copy of every backup in the cloud, so it survives even if this server is lost. First set up OneDrive or Google Drive in <b>Settings → Server → Files</b>, then connect your account in <b>Connected drives</b>.</p>
      ) : !t ? (
        <>
          <p style={{ ...hint, marginTop: 0 }}>Also copy every backup to a <b>Synapse Backups</b> folder in your cloud drive, so a copy survives even if this server — or the building it’s in — is lost.</p>
          {noPassword && <CloudWarning />}
          {c.my_drives?.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {c.my_drives.map(d => (
                <button key={d.provider} style={primary} disabled={busy} onClick={() => patch({ provider: d.provider, keep: 7 }, `Backups will also be copied to ${d.label}`)}>
                  {busy ? <Loader2 size={14} className="spin" /> : <CloudUpload size={14} />} Copy to {d.label}{d.account ? ` (${d.account})` : ''}
                </button>
              ))}
            </div>
          ) : (
            <p style={hint}>Connect your {c.configured.map(d => d.label).join(' or ')} first: <button className="btn-ghost" style={{ padding: '2px 6px', color: 'var(--accent)' }} onClick={() => onGo?.('drives')}>Connected drives →</button></p>
          )}
        </>
      ) : (
        <>
          <p style={{ ...hint, marginTop: 0 }}>
            <CheckCircle2 size={13} style={{ verticalAlign: -2, color: 'var(--success, #22c55e)' }} /> On — every automatic backup and every “Back up now” is also copied to the <b>{t.folder}</b> folder in {t.by_me ? 'your' : `${t.by?.display_name || t.by?.username || 'another admin'}’s`} <b>{t.label}</b>{t.account ? ` (${t.account})` : ''}.
          </p>
          {noPassword && <CloudWarning />}
          {last && (last.ok
            ? <p style={hint}>Last copy: {when(last.at)} · {bytes(last.size || 0)}{last.removed ? ` · removed ${last.removed} older` : ''}</p>
            : <p style={{ ...hint, color: 'var(--danger)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Copying failed {when(last.at)}: {last.error}{last.retrying ? ' — it will try again in 15 minutes.' : ''}</p>)}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Keep the newest</span>
            <input type="number" min={1} max={365} value={keep} onChange={e => setKeep(e.target.value)} style={{ ...field, flex: '0 0 72px' }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>automatic backups in {t.label}</span>
            <div style={{ flex: 1 }} />
            <button style={primary} disabled={busy || Number(keep) === t.keep} onClick={() => patch({ keep: Number(keep) }, 'Saved')}>Save</button>
          </div>
          <p style={hint}>Older automatic copies are deleted from {t.label} so it doesn’t fill up. Backups you made by hand stay there until you delete them.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button style={secondary} onClick={files ? () => setFiles(null) : loadFiles}>{files ? 'Hide' : `Show backups in ${t.label}`}</button>
            <button style={secondary} disabled={busy} onClick={() => confirm(`Stop copying backups to ${t.label}? Copies already there stay.`) && patch({ off: true }, 'Cloud copies turned off')}>Turn off</button>
          </div>
          {files === 'loading' && <p style={hint}><Loader2 size={13} className="spin" style={{ verticalAlign: -2 }} /> Looking in {t.label}…</p>}
          {Array.isArray(files) && (
            <div className="backup-list" style={{ marginTop: 10 }}>
              {!files.length && <p style={{ ...hint, marginTop: 0 }}>No backups in the {t.folder} folder yet.</p>}
              {files.map(f => (
                <div key={f.id} className="backup-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="backup-when">{f.name.endsWith('.enc') && <Lock size={12} />} {f.name.replace(/^synapse-backup-/, '').replace(/\.tar\.gz(\.enc)?$/, '')}</div>
                    <div className="backup-meta">{bytes(f.size || 0)} · {f.automatic ? 'Automatic' : 'Made by hand'}{f.on_server ? ' · also on this server' : ''}</div>
                  </div>
                  {!f.on_server && (
                    <button className="btn-ghost" disabled={!!fetching} onClick={() => fetchOne(f)} title="Copy it back to this server, to restore it">
                      {fetching === f.id ? <Loader2 size={14} className="spin" /> : <CloudDownload size={14} />} Bring back
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(files) && <p style={hint}>Setting up a new server? Connect the same drive there, turn this on, then “Bring back” a backup and Restore it.</p>}
        </>
      )}
    </section>
  );
}

function CloudWarning() {
  return (
    <p className="backup-warning"><AlertTriangle size={13} /> <span><b>No backup password is set</b>, so the copies in the cloud aren’t encrypted — anyone who can open that drive (including Microsoft or Google) could read every note in them. Add a backup password below to encrypt them first.</span></p>
  );
}

function Schedule({ s, save, styles }) {
  const { section, labelStyle, hint, field, primary } = styles;
  const [form, setForm] = useState({ schedule: s.schedule, day: s.day, time: s.time, keep: s.keep });
  const tz = browserTz();
  const dirty = form.schedule !== s.schedule || form.day !== s.day || form.time !== s.time || Number(form.keep) !== s.keep || (form.schedule !== 'off' && s.timezone !== tz);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <section style={section}>
      <label style={labelStyle}>Schedule</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={form.schedule} onChange={e => set('schedule', e.target.value)} style={{ ...field, flex: '0 0 auto' }}>
          <option value="daily">Every day</option>
          <option value="weekly">Once a week</option>
          <option value="off">Off (only when I click “Back up now”)</option>
        </select>
        {form.schedule === 'weekly' && (
          <select value={form.day} onChange={e => set('day', Number(e.target.value))} style={{ ...field, flex: '0 0 auto' }}>
            {DAYS.map((d, i) => <option key={d} value={i}>on {d}</option>)}
          </select>
        )}
        {form.schedule !== 'off' && (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>at</span>
            <input type="time" value={form.time} onChange={e => set('time', e.target.value)} style={{ ...field, flex: '0 0 auto' }} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Keep the newest</span>
        <input type="number" min={1} max={365} value={form.keep} onChange={e => set('keep', e.target.value)} style={{ ...field, flex: '0 0 72px' }} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>automatic backups</span>
        <div style={{ flex: 1 }} />
        <button style={primary} disabled={!dirty} onClick={async () => {
          if (await save({ ...form, keep: Number(form.keep), timezone: tz })) toast.success('Schedule saved');
        }}>Save</button>
      </div>
      {form.schedule !== 'off' && <p style={hint}>Times are in your time zone ({tz}). Backups run while Synapse keeps working — nobody gets signed out.</p>}
    </section>
  );
}

function Password({ s, save, styles }) {
  const { section, labelStyle, hint, field, primary, secondary } = styles;
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const submit = async () => {
    if (pw.length < 8) { toast.error('Use at least 8 characters'); return; }
    if (pw !== pw2) { toast.error('The two passwords don’t match'); return; }
    if (await save({ password: pw })) { toast.success('Backup password set — new backups are encrypted'); setOpen(false); setPw(''); setPw2(''); }
  };
  return (
    <section style={section}>
      <label style={labelStyle}><KeyRound size={14} style={{ verticalAlign: -2 }} /> Backup password</label>
      {s.password_unreadable && <p style={{ ...hint, marginTop: 0, color: 'var(--danger)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> The saved backup password can’t be read on this server any more, so new backups aren’t encrypted. Set it again.</p>}
      <p style={{ ...hint, marginTop: 0 }}>
        {s.password_set
          ? 'On — new backups are encrypted. Nobody can open them without the password, even if they get the file.'
          : 'Off — backup files can be opened by anyone who gets hold of them. Add a password to encrypt them (recommended if backups go to a NAS or cloud folder).'}
      </p>
      {open ? (
        <>
          <p className="backup-warning"><AlertTriangle size={13} /> <span>Write this password down somewhere safe (like Bitwarden). If it’s lost, encrypted backups <b>can’t be opened by anyone</b> — there’s no way to recover it.</span></p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New backup password" style={field} />
            <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Type it again" style={field} onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button style={secondary} onClick={() => { setOpen(false); setPw(''); setPw2(''); }}>Cancel</button>
            <button style={primary} onClick={submit} disabled={!pw || !pw2}>Set password</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={secondary} onClick={() => setOpen(true)}>{s.password_set ? 'Change password' : 'Add a password'}</button>
          {s.password_set && <button style={secondary} onClick={async () => {
            if (confirm('Stop encrypting new backups? Backups already made keep needing their password.') && await save({ password: '' })) toast.success('New backups won’t be encrypted');
          }}>Turn off</button>}
        </div>
      )}
      {s.password_set && <p style={hint}>Changing the password only affects new backups — older ones still need the password they were made with.</p>}
    </section>
  );
}

function RestoreDialog({ backup, styles, onClose, onStarted }) {
  const { field, primary, secondary } = styles;
  const needsPw = backup.encrypted && backup.current_password !== true;
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api.post(`/backups/${encodeURIComponent(backup.name)}/restore`, needsPw ? { password: pw } : {}, { timeout: 30 * 60_000 });
      onStarted();
    } catch (err) { toast.error(errorText(err)); setBusy(false); }
  };
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div className="backup-overlay" onClick={() => !busy && onClose()}>
      <div className="backup-overlay-box" style={{ textAlign: 'left', maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><RotateCcw size={18} /> Restore this backup?</h3>
        <p>Everything on this server goes back to how it was on <b>{when(backup.created_at)}</b> — for <b>everyone</b>: notes, files, chats, people and settings. Anything added or changed since then is replaced.</p>
        <p>A backup of how things are right now is made first, so you can undo this. Synapse restarts (about a minute) and everyone may need to sign in again.</p>
        {needsPw && (
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="The password this backup was made with" style={{ ...field, width: '100%', marginBottom: 10 }} />
        )}
        <p style={{ marginBottom: 6 }}>Type <b>RESTORE</b> to confirm:</p>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="RESTORE" style={{ ...field, width: '100%' }} onKeyDown={e => e.key === 'Enter' && typed.trim().toUpperCase() === 'RESTORE' && (!needsPw || pw) && go()} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button style={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={{ ...primary, background: 'var(--danger)' }} onClick={go} disabled={busy || typed.trim().toUpperCase() !== 'RESTORE' || (needsPw && !pw)}>
            {busy ? <><Loader2 size={14} className="spin" /> Checking the backup…</> : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
}
