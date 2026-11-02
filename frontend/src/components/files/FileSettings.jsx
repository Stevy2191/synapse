// Settings → Server → Files (admin): network folders + who can use them, OneDrive / Google Drive setup.
// Settings → Connected drives (everyone): connect / disconnect your own OneDrive and Google Drive.
import { useEffect, useState } from 'react';
import { HardDrive, Cloud, Check, Copy, Users, Trash2, Plus, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api';
import { listSources, connectCloud, disconnectCloud, errorText } from '../../files/client';

const PROVIDERS = {
  onedrive: {
    label: 'OneDrive',
    portal: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    steps: [
      'In the Azure portal open App registrations → New registration. Give it a name (e.g. “Synapse”).',
      'Supported account types: choose “Accounts in any organizational directory and personal Microsoft accounts” (or only your organisation).',
      'Redirect URI: platform “Web”, and paste the address shown below.',
      'After creating it, copy the Application (client) ID. Then Certificates & secrets → New client secret, and copy its Value.',
      'API permissions → Add → Microsoft Graph → Delegated: Files.ReadWrite.All, User.Read, offline_access.',
    ],
    tenantHint: 'Leave as “common” for personal and work accounts, or put your organisation’s tenant ID to allow only it.',
  },
  google: {
    label: 'Google Drive',
    portal: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'In Google Cloud Console create (or pick) a project, and enable the Google Drive API for it.',
      'OAuth consent screen: set it up (External is fine), and add the people who will connect as test users — or publish the app.',
      'Credentials → Create credentials → OAuth client ID → type “Web application”.',
      'Authorised redirect URI: paste the address shown below. Google only allows https addresses (or localhost).',
      'Copy the Client ID and Client secret it shows.',
    ],
  },
};

const redirectFor = provider => `${location.origin}/api/files/oauth/${provider}/callback`;

export function ServerFilesPage({ styles }) {
  const { heading, lead, section, labelStyle, hint } = styles;
  const [data, setData] = useState(null);
  const load = () => api.get('/files/admin').then(r => setData(r.data)).catch(err => toast.error(errorText(err)));
  useEffect(() => { load(); }, []);
  if (!data) return <div><h3 style={heading}>Files</h3><p style={lead}>Loading…</p></div>;

  return (
    <div className="files-settings">
      <h3 style={heading}>Files</h3>
      <p style={lead}>Let people browse, open and save files in network folders on this server, and in their own OneDrive or Google Drive. Files can be attached to notes as a copy or a link, and exports can be saved there.</p>

      <section style={section}>
        <label style={labelStyle}><HardDrive size={14} /> Network folders</label>
        <p style={{ ...hint, marginTop: 0 }}>
          Folders on the server (for example a NAS share mounted on it). Add one by running this on the server — use the folder’s real path and the name people should see:
        </p>
        <pre className="backup-cmd">synapse files-add "/path/to/folder" "Name people see"</pre>
        <p style={hint}>Synapse restarts and the folder appears below. Nobody can use it until you choose who can. <code>synapse files-remove "Name"</code> takes one away.</p>
        {!data.folders.length && <p style={{ ...hint, fontStyle: 'italic' }}>No folders yet.</p>}
        {data.folders.map(f => <FolderRow key={f.slug} folder={f} users={data.users} styles={styles} onSaved={setData} />)}
      </section>

      {Object.entries(PROVIDERS).map(([id, p]) => <CloudSetup key={id} id={id} p={p} cfg={data.cloud[id]} styles={styles} onSaved={setData} />)}
      <p style={hint}>Each person then connects their own account in Settings → Connected drives. Synapse never sees their password; it keeps a sign-in token, encrypted, on this server.</p>
    </div>
  );
}

function FolderRow({ folder, users, styles, onSaved }) {
  const { field, primary, secondary, hint } = styles;
  const [name, setName] = useState(folder.name);
  const [everyone, setEveryone] = useState(folder.access.everyone);
  const [people, setPeople] = useState(folder.access.people);
  const [adding, setAdding] = useState('');
  const dirty = name !== folder.name || everyone !== folder.access.everyone || JSON.stringify(people) !== JSON.stringify(folder.access.people);
  const save = async () => {
    try { const { data } = await api.patch('/files/admin', { folder: { slug: folder.slug, name, access: { everyone, people } } }); onSaved(data); toast.success('Saved'); } catch (err) { toast.error(errorText(err)); }
  };
  const userName = id => { const u = users.find(x => x.id === id); return u ? (u.display_name || u.username) : 'Someone'; };
  const others = users.filter(u => !people[u.id]);
  return (
    <div className="files-folder">
      <div className="files-folder-top">
        <HardDrive size={15} className="files-folder-icon" />
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...field, flex: '1 1 160px' }} aria-label="Name people see" />
        <code className="files-slug" title="Folder name on the server">{folder.slug}</code>
      </div>
      <div className="files-access">
        <span className="files-access-label"><Users size={13} /> Everyone</span>
        <select value={everyone} onChange={e => setEveryone(e.target.value)} style={{ ...field, flex: '0 0 auto' }}>
          <option value="none">No access</option>
          <option value="read">Can read</option>
          <option value="write">Can read & write</option>
        </select>
      </div>
      {Object.entries(people).map(([uid, mode]) => (
        <div key={uid} className="files-access">
          <span className="files-access-label">{userName(uid)}</span>
          <select value={mode} onChange={e => setPeople(p => ({ ...p, [uid]: e.target.value }))} style={{ ...field, flex: '0 0 auto' }}>
            <option value="read">Can read</option>
            <option value="write">Can read & write</option>
          </select>
          <button type="button" className="btn-ghost danger-hover" title="Remove" onClick={() => setPeople(p => { const n = { ...p }; delete n[uid]; return n; })}><Trash2 size={13} /></button>
        </div>
      ))}
      {others.length > 0 && (
        <div className="files-access">
          <select value={adding} onChange={e => setAdding(e.target.value)} style={{ ...field, flex: '0 1 220px' }}>
            <option value="">Add a person…</option>
            {others.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
          </select>
          <button type="button" style={secondary} disabled={!adding} onClick={() => { setPeople(p => ({ ...p, [adding]: 'read' })); setAdding(''); }}><Plus size={13} /> Add</button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ ...hint, marginTop: 0 }}>{everyone === 'none' && !Object.keys(people).length ? 'Nobody can use this folder yet.' : ''}</span>
        <button type="button" style={primary} disabled={!dirty} onClick={save}>Save</button>
      </div>
    </div>
  );
}

function CloudSetup({ id, p, cfg, styles, onSaved }) {
  const { section, labelStyle, hint, field, primary, secondary } = styles;
  const [clientId, setClientId] = useState(cfg.client_id);
  const [secret, setSecret] = useState('');
  const [tenant, setTenant] = useState(cfg.tenant || 'common');
  const [open, setOpen] = useState(false);
  const on = !!(cfg.client_id && cfg.secret_set);
  const redirect = redirectFor(id);
  const insecure = location.protocol !== 'https:' && !/^(localhost|127\.)/.test(location.hostname);
  const save = async (fields) => {
    try { const { data } = await api.patch('/files/admin', { cloud: { provider: id, ...fields } }); onSaved(data); setSecret(''); toast.success(fields.secret === '' ? `${p.label} turned off` : 'Saved'); } catch (err) { toast.error(errorText(err)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(redirect); toast.success('Copied'); } catch { prompt('Copy this address:', redirect); } };
  return (
    <section style={section}>
      <label style={labelStyle}><Cloud size={14} /> {p.label}</label>
      <p style={{ ...hint, marginTop: 0 }}>
        {on ? <><Check size={13} style={{ color: 'var(--success)' }} /> On — {cfg.connected_people} {cfg.connected_people === 1 ? 'person has' : 'people have'} connected an account.</>
          : `Off. To turn it on, register Synapse as an app with ${id === 'google' ? 'Google' : 'Microsoft'} (free, once) and paste its details here.`}
      </p>
      <button type="button" className="btn-ghost" onClick={() => setOpen(o => !o)} style={{ marginBottom: 8 }}>{open ? 'Hide' : on ? 'Change setup' : 'How to set it up'}</button>
      {open && (
        <>
          <ol className="files-steps">{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <a className="btn-ghost" href={p.portal} target="_blank" rel="noreferrer" style={{ marginBottom: 8 }}><ExternalLink size={13} /> Open the {id === 'google' ? 'Google Cloud Console' : 'Azure portal'}</a>
          <div className="files-redirect"><span>Redirect address:</span><code>{redirect}</code><button type="button" className="btn-ghost" onClick={copy} title="Copy"><Copy size={13} /></button></div>
          {insecure && <p className="backup-warning">This address isn’t https. {id === 'google' ? 'Google won’t accept it — ' : 'Microsoft only accepts http for localhost — '}open Synapse at your https address and set this up from there.</p>}
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder={id === 'google' ? 'Client ID' : 'Application (client) ID'} style={field} autoComplete="off" />
            <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={cfg.secret_set ? 'Client secret (saved — paste a new one to replace it)' : 'Client secret'} style={field} autoComplete="new-password" />
            {id === 'onedrive' && <><input value={tenant} onChange={e => setTenant(e.target.value)} placeholder="common" style={field} /><span style={{ ...hint, marginTop: 0 }}>{p.tenantHint}</span></>}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            {on && <button type="button" style={secondary} onClick={() => confirm(`Turn off ${p.label}? People’s connections stop working until it’s set up again.`) && save({ secret: '' })}>Turn off</button>}
            <button type="button" style={primary} disabled={!clientId.trim() || (!secret.trim() && !cfg.secret_set)}
              onClick={() => save({ client_id: clientId, ...(secret.trim() ? { secret } : {}), ...(id === 'onedrive' ? { tenant } : {}) })}>Save</button>
          </div>
        </>
      )}
    </section>
  );
}

export function ConnectedDrivesPage({ styles }) {
  const { heading, lead, section, labelStyle, hint, primary, secondary } = styles;
  const [sources, setSources] = useState(null);
  const load = () => listSources().then(setSources).catch(err => { setSources([]); toast.error(errorText(err)); });
  useEffect(() => { load(); }, []);
  const clouds = (sources || []).filter(s => s.kind !== 'folder');
  const folders = (sources || []).filter(s => s.kind === 'folder');
  return (
    <div>
      <h3 style={heading}>Connected drives</h3>
      <p style={lead}>Connect your own OneDrive or Google Drive to attach files to notes and save exports there. Only you see your drive.</p>
      {sources === null ? <p style={hint}>Loading…</p> : !clouds.length && !folders.length ? (
        <section style={section}><p style={{ ...hint, marginTop: 0 }}>Your admin hasn’t set up any file locations yet (Settings → Server → Files).</p></section>
      ) : null}
      {clouds.map(s => (
        <section key={s.id} style={{ ...section, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Cloud size={18} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ ...labelStyle, marginBottom: 2 }}>{s.name}</label>
            <p style={{ ...hint, marginTop: 0 }}>{s.connected ? `Connected${s.account ? ` as ${s.account}` : ''}` : 'Not connected'}</p>
          </div>
          {s.connected
            ? <button type="button" style={secondary} onClick={async () => { if (!confirm(`Disconnect ${s.name}? Links to its files stay in your notes; copies already attached stay too.`)) return; try { setSources(await disconnectCloud(s.id)); toast.success('Disconnected'); } catch (err) { toast.error(errorText(err)); } }}>Disconnect</button>
            : <button type="button" style={primary} onClick={async () => { try { const ok = await connectCloud(s.id); if (ok) toast.success(`${s.name} connected`); else if (ok === false) toast.error('Couldn’t connect — the sign-in window says why'); load(); } catch (err) { toast.error(errorText(err)); } }}>Connect</button>}
        </section>
      ))}
      {folders.length > 0 && (
        <section style={section}>
          <label style={labelStyle}><HardDrive size={14} /> Network folders you can use</label>
          {folders.map(f => <p key={f.id} style={{ ...hint, marginTop: 4 }}>{f.name} — {f.can_write ? 'read & write' : 'read only'}</p>)}
        </section>
      )}
    </div>
  );
}
