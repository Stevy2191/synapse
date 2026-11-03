// File integrations: browse, open and save files in
//   • network folders — folders on the server (NAS shares etc.) that the admin mounts into the
//     container under /files/<name> (`synapse files-add`) and then shares with everyone or chosen
//     people, read-only or read & write (Settings → Server → Files);
//   • OneDrive and Google Drive — each person connects their own account (Settings → Connected
//     drives) using the app registration the admin entered once (client id + secret).
//
// Nothing here is specific to one install: folder names, paths, keys and accounts all come from
// the admin's and users' settings. Cloud tokens and client secrets are stored encrypted with a key
// derived from the server secret.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { db, UPLOADS_DIR } from './db/index.js';
import { JWT_SECRET } from './config.js';
import { getSetting, setSetting } from './settings.js';

export class FileError extends Error { constructor(status, message) { super(message); this.status = status; } }

db.exec(`
  CREATE TABLE IF NOT EXISTS file_folders (
    slug TEXT PRIMARY KEY,               -- the folder's name under FILES_ROOT
    name TEXT NOT NULL,                  -- what people see
    access TEXT NOT NULL DEFAULT '{}'    -- {"everyone":"none|read|write","people":{"<userId>":"read|write"}}
  );
  CREATE TABLE IF NOT EXISTS file_accounts (
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,              -- onedrive | google
    account TEXT NOT NULL DEFAULT '',    -- email / name, for display
    tokens_enc TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ───────────────────────── encryption of secrets ─────────────────────────

const KEY = crypto.createHash('sha256').update(`synapse-file-secrets:${JWT_SECRET}`).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join(':');
}
function decrypt(blob) {
  if (!blob) return null;
  try {
    const [iv, tag, enc] = blob.split(':').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

// ───────────────────────── network folders ─────────────────────────

function pickFilesRoot() {
  if (process.env.FILES_DIR) return path.resolve(process.env.FILES_DIR);
  return '/files';
}
export const FILES_ROOT = pickFilesRoot();

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,80}$/;

/** Folders mounted under FILES_ROOT, with their settings. */
function mountedFolders() {
  let names = [];
  try { names = fs.readdirSync(FILES_ROOT, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name); } catch { /* none */ }
  const rows = new Map(db.prepare('SELECT * FROM file_folders').all().map(r => [r.slug, r]));
  return names.filter(n => SLUG_RE.test(n)).sort().map(slug => {
    const row = rows.get(slug);
    let access = {};
    try { access = JSON.parse(row?.access || '{}'); } catch { /* default */ }
    return { slug, name: row?.name || slug, access: { everyone: access.everyone || 'none', people: access.people || {} } };
  });
}

function folderMode(folder, user) {
  if (!folder) return null;
  const mine = folder.access.people[user.id];
  const all = folder.access.everyone;
  const rank = { none: 0, read: 1, write: 2 };
  const best = Math.max(rank[mine] || 0, rank[all] || 0);
  return best === 2 ? 'write' : best === 1 ? 'read' : null;
}

/** Resolve a path inside a folder, refusing anything that escapes it (../, symlinks out). */
function safePath(slug, rel) {
  const root = path.join(FILES_ROOT, slug);
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { throw new FileError(404, 'This folder isn’t available on the server right now'); }
  const clean = String(rel || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
  if (clean.some(p => p === '..')) throw new FileError(400, 'Bad path');
  const full = path.join(realRoot, ...clean);
  let real = full;
  try { real = fs.realpathSync(full); } catch { /* may not exist yet (uploads) — check parent below */ }
  let check;
  try { check = fs.existsSync(full) ? real : path.join(fs.realpathSync(path.dirname(full)), path.basename(full)); } catch {
    throw new FileError(404, 'Not found');
  }
  if (check !== realRoot && !check.startsWith(realRoot + path.sep)) throw new FileError(403, 'That path is outside the shared folder');
  return { full: check, rel: clean.join('/'), root: realRoot };
}

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel',
  '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.heic': 'image/heic',
};
const mimeOf = name => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

const folderSource = {
  async list(user, folder, rel) {
    const { full, rel: clean } = safePath(folder.slug, rel);
    let entries;
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch (err) {
      throw new FileError(err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Folder not found' : `Can’t read this folder (${err.code})`);
    }
    const items = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // hidden files (.DS_Store, .snapshots …)
      const p = path.join(full, e.name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      items.push({
        id: clean ? `${clean}/${e.name}` : e.name, name: e.name, type: st.isDirectory() ? 'folder' : 'file',
        size: st.isDirectory() ? null : st.size, modified: Math.floor(st.mtimeMs / 1000), mime: st.isDirectory() ? null : mimeOf(e.name),
      });
    }
    const parts = clean ? clean.split('/') : [];
    const crumbs = [{ id: '', name: folder.name }, ...parts.map((p, i) => ({ id: parts.slice(0, i + 1).join('/'), name: p }))];
    return { items, crumbs };
  },
  async download(user, folder, rel) {
    const { full } = safePath(folder.slug, rel);
    let st;
    try { st = fs.statSync(full); } catch { throw new FileError(404, 'File not found'); }
    if (!st.isFile()) throw new FileError(400, 'That’s a folder');
    return { stream: fs.createReadStream(full), name: path.basename(full), mime: mimeOf(full), size: st.size };
  },
  async upload(user, folder, parentRel, name, buffer) {
    const parent = safePath(folder.slug, parentRel);
    if (!fs.existsSync(parent.full) || !fs.statSync(parent.full).isDirectory()) throw new FileError(404, 'Folder not found');
    const base = safeFileName(name);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let final = base;
    for (let i = 2; fs.existsSync(path.join(parent.full, final)); i++) final = `${stem} (${i})${ext}`;
    try { fs.writeFileSync(path.join(parent.full, final), buffer, { flag: 'wx' }); } catch (err) {
      throw new FileError(err.code === 'EACCES' || err.code === 'EROFS' ? 403 : 500, err.code === 'EACCES' || err.code === 'EROFS'
        ? 'The server isn’t allowed to write in this folder' : `Couldn’t save the file (${err.code})`);
    }
    const id = parent.rel ? `${parent.rel}/${final}` : final;
    return { id, name: final, type: 'file', size: buffer.length, mime: mimeOf(final) };
  },
};

function safeFileName(name) {
  const n = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return n && !/^\.+$/.test(n) ? n : 'file';
}

// ───────────────────────── cloud: settings & OAuth ─────────────────────────

const env = (k, d) => process.env[k] || d;
const PROVIDERS = {
  onedrive: {
    label: 'OneDrive',
    authUrl: c => `${env('MS_LOGIN_BASE', 'https://login.microsoftonline.com')}/${encodeURIComponent(c.tenant || 'common')}/oauth2/v2.0/authorize`,
    tokenUrl: c => `${env('MS_LOGIN_BASE', 'https://login.microsoftonline.com')}/${encodeURIComponent(c.tenant || 'common')}/oauth2/v2.0/token`,
    scope: 'offline_access Files.ReadWrite.All User.Read',
    extraAuth: { response_mode: 'query', prompt: 'select_account' },
  },
  google: {
    label: 'Google Drive',
    authUrl: () => env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    tokenUrl: () => env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    scope: 'https://www.googleapis.com/auth/drive openid email',
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
};
const GRAPH = () => env('MS_GRAPH_BASE', 'https://graph.microsoft.com/v1.0');
const GDRIVE = () => env('GOOGLE_API_BASE', 'https://www.googleapis.com/drive/v3');
const GUPLOAD = () => env('GOOGLE_UPLOAD_BASE', 'https://www.googleapis.com/upload/drive/v3');

export function cloudConfig(provider) {
  const p = `files_${provider}_`;
  return {
    client_id: getSetting(`${p}client_id`) || '',
    secret: decrypt(getSetting(`${p}secret_enc`)) || '',
    tenant: getSetting(`${p}tenant`) || 'common',
  };
}
const configured = provider => { const c = cloudConfig(provider); return !!(c.client_id && c.secret); };

/** Admin settings, safe to show (no secrets). */
export function adminView() {
  const users = db.prepare('SELECT id, username, display_name FROM users ORDER BY username').all();
  const cloud = {};
  for (const id of Object.keys(PROVIDERS)) {
    const c = cloudConfig(id);
    cloud[id] = { client_id: c.client_id, secret_set: !!c.secret, tenant: c.tenant, connected_people: db.prepare('SELECT COUNT(*) AS n FROM file_accounts WHERE provider=?').get(id).n };
  }
  return { files_root: FILES_ROOT, folders: mountedFolders(), users, cloud };
}

export function updateAdmin(body) {
  if (body.folder) {
    const { slug, name, access } = body.folder;
    if (!mountedFolders().some(f => f.slug === slug)) throw new FileError(404, 'That folder isn’t mounted');
    const cleanAccess = {
      everyone: ['none', 'read', 'write'].includes(access?.everyone) ? access.everyone : 'none',
      people: Object.fromEntries(Object.entries(access?.people || {}).filter(([uid, m]) => ['read', 'write'].includes(m) && db.prepare('SELECT 1 FROM users WHERE id=?').get(uid))),
    };
    const nm = String(name || slug).trim().slice(0, 80) || slug;
    db.prepare(`INSERT INTO file_folders (slug, name, access) VALUES (?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET name=excluded.name, access=excluded.access`).run(slug, nm, JSON.stringify(cleanAccess));
  }
  if (body.cloud) {
    const { provider, client_id, secret, tenant } = body.cloud;
    if (!PROVIDERS[provider]) throw new FileError(400, 'Unknown provider');
    const p = `files_${provider}_`;
    if (client_id !== undefined) setSetting(`${p}client_id`, String(client_id).trim().slice(0, 300));
    if (secret !== undefined) {
      if (secret) setSetting(`${p}secret_enc`, encrypt(String(secret).trim()));
      else db.prepare('DELETE FROM settings WHERE key=?').run(`${p}secret_enc`);
    }
    if (tenant !== undefined) setSetting(`${p}tenant`, /^[\w.-]{1,100}$/.test(String(tenant).trim()) ? String(tenant).trim() : 'common');
  }
  return adminView();
}

// OAuth "state" → who started it (kept in memory for 10 minutes).
const pending = new Map();
const ONENOTE_SCOPE = 'Notes.Read';
export function startConnect(user, provider, origin, { onenote = false } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new FileError(400, 'Unknown provider');
  if (!configured(provider)) throw new FileError(400, `${p.label} isn’t set up on this server yet — an admin adds it in Settings → Server → Files`);
  let o;
  try { o = new URL(origin); } catch { throw new FileError(400, 'Bad address'); }
  const redirect = `${o.origin}/api/files/oauth/${provider}/callback`;
  const state = crypto.randomBytes(24).toString('base64url');
  // OneNote import asks for one more permission (reading notebooks) on top of the usual ones.
  const scope = provider === 'onedrive' && onenote ? `${p.scope} ${ONENOTE_SCOPE}` : p.scope;
  pending.set(state, { userId: user.id, provider, redirect, scope, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  const c = cloudConfig(provider);
  const q = new URLSearchParams({ client_id: c.client_id, response_type: 'code', redirect_uri: redirect, scope, state, ...p.extraAuth });
  return { url: `${p.authUrl(c)}?${q}`, redirect };
}

async function tokenRequest(provider, params) {
  const c = cloudConfig(provider);
  const res = await fetch(PROVIDERS[provider].tokenUrl(c), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.secret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new FileError(400, data.error_description || data.error || `Sign-in failed (${res.status})`);
  return data;
}

export async function finishConnect(provider, { code, state, error, error_description: desc }) {
  const p = pending.get(String(state || ''));
  if (p) pending.delete(state);
  if (error) throw new FileError(400, desc || error);
  if (!p || p.provider !== provider) throw new FileError(400, 'This sign-in link has expired — try connecting again');
  const t = await tokenRequest(provider, { grant_type: 'authorization_code', code: String(code || ''), redirect_uri: p.redirect });
  const tokens = { access: t.access_token, refresh: t.refresh_token || '', expires: Date.now() + (Number(t.expires_in) || 3600) * 1000, scope: p.scope };
  let account = '';
  try {
    if (provider === 'onedrive') {
      const me = await (await fetch(`${GRAPH()}/me`, { headers: { Authorization: `Bearer ${tokens.access}` } })).json();
      account = me.userPrincipalName || me.mail || me.displayName || '';
    } else {
      const me = await (await fetch(`${GDRIVE()}/about?fields=user`, { headers: { Authorization: `Bearer ${tokens.access}` } })).json();
      account = me.user?.emailAddress || me.user?.displayName || '';
    }
  } catch { /* name is only for display */ }
  db.prepare(`INSERT INTO file_accounts (user_id, provider, account, tokens_enc) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET account=excluded.account, tokens_enc=excluded.tokens_enc`)
    .run(p.userId, provider, String(account).slice(0, 200), encrypt(JSON.stringify(tokens)));
  return { provider, account };
}

export function disconnect(user, provider) {
  db.prepare('DELETE FROM file_accounts WHERE user_id=? AND provider=?').run(user.id, provider);
}

async function accessToken(user, provider) {
  const row = db.prepare('SELECT tokens_enc FROM file_accounts WHERE user_id=? AND provider=?').get(user.id, provider);
  if (!row) throw new FileError(400, `Connect your ${PROVIDERS[provider].label} first (Settings → Connected drives)`);
  let tokens;
  try { tokens = JSON.parse(decrypt(row.tokens_enc) || ''); } catch { tokens = null; }
  if (!tokens) throw new FileError(400, `Connect your ${PROVIDERS[provider].label} again (Settings → Connected drives)`);
  if (Date.now() < tokens.expires - 60_000) return tokens.access;
  if (!tokens.refresh) throw new FileError(401, `Your ${PROVIDERS[provider].label} sign-in expired — connect it again in Settings → Connected drives`);
  const params = { grant_type: 'refresh_token', refresh_token: tokens.refresh };
  if (provider === 'onedrive') params.scope = tokens.scope || PROVIDERS.onedrive.scope; // keep e.g. OneNote access
  let t;
  try { t = await tokenRequest(provider, params); } catch {
    throw new FileError(401, `Your ${PROVIDERS[provider].label} sign-in expired — connect it again in Settings → Connected drives`);
  }
  const next = { access: t.access_token, refresh: t.refresh_token || tokens.refresh, expires: Date.now() + (Number(t.expires_in) || 3600) * 1000, scope: tokens.scope };
  db.prepare('UPDATE file_accounts SET tokens_enc=? WHERE user_id=? AND provider=?').run(encrypt(JSON.stringify(next)), user.id, provider);
  return next.access;
}

async function api(user, provider, url, opts = {}) {
  const token = await accessToken(user, provider);
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || data.error_description || (typeof data.error === 'string' ? data.error : '') || res.statusText;
    throw new FileError(res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 403 : 502, `${PROVIDERS[provider].label}: ${msg}`);
  }
  return res;
}

// ───────────────────────── OneDrive (Microsoft Graph) ─────────────────────────

const graphItem = i => ({
  id: i.id, name: i.name, type: i.folder ? 'folder' : 'file', size: i.folder ? null : i.size,
  modified: i.lastModifiedDateTime ? Math.floor(Date.parse(i.lastModifiedDateTime) / 1000) : null,
  mime: i.file?.mimeType || (i.folder ? null : mimeOf(i.name)), web_url: i.webUrl || null,
});

const onedrive = {
  async list(user, id) {
    const base = id ? `${GRAPH()}/me/drive/items/${encodeURIComponent(id)}` : `${GRAPH()}/me/drive/root`;
    const items = [];
    let next = `${base}/children?$top=200&$select=id,name,size,folder,file,lastModifiedDateTime,webUrl`;
    for (let page = 0; next && page < 10; page++) {
      const data = await (await api(user, 'onedrive', next)).json();
      items.push(...(data.value || []).map(graphItem));
      next = data['@odata.nextLink'];
    }
    const crumbs = [{ id: '', name: 'OneDrive' }];
    if (id) {
      const me = await (await api(user, 'onedrive', `${base}?$select=id,name,parentReference`)).json();
      const parentPath = (me.parentReference?.path || '').replace(/^\/drive\/root:?/, '');
      if (parentPath) crumbs.push({ id: null, name: decodeURIComponent(parentPath.replace(/^\//, '')).split('/').join(' / ') });
      crumbs.push({ id: me.id, name: me.name });
    }
    return { items, crumbs };
  },
  async download(user, id) {
    const meta = await (await api(user, 'onedrive', `${GRAPH()}/me/drive/items/${encodeURIComponent(id)}?$select=id,name,size,file,webUrl`)).json();
    if (!meta.file) throw new FileError(400, 'That’s a folder');
    const res = await api(user, 'onedrive', `${GRAPH()}/me/drive/items/${encodeURIComponent(id)}/content`);
    return { stream: Readable.fromWeb(res.body), name: meta.name, mime: meta.file.mimeType || mimeOf(meta.name), size: meta.size, web_url: meta.webUrl };
  },
  async upload(user, parentId, name, buffer, mime) {
    const fname = safeFileName(name);
    const where = parentId ? `items/${encodeURIComponent(parentId)}:/${encodeURIComponent(fname)}:` : `root:/${encodeURIComponent(fname)}:`;
    if (buffer.length <= 4 * 1024 * 1024) {
      const res = await api(user, 'onedrive', `${GRAPH()}/me/drive/${where}/content?@microsoft.graph.conflictBehavior=rename`, {
        method: 'PUT', headers: { 'Content-Type': mime || 'application/octet-stream' }, body: buffer,
      });
      return graphItem(await res.json());
    }
    // Large file: an upload session, in chunks (multiples of 320 KiB).
    const session = await (await api(user, 'onedrive', `${GRAPH()}/me/drive/${where}/createUploadSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
    })).json();
    const CHUNK = 320 * 1024 * 16;
    let last;
    for (let start = 0; start < buffer.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, buffer.length);
      const res = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}` }, body: buffer.subarray(start, end) });
      if (!res.ok && res.status !== 202) throw new FileError(502, `OneDrive upload failed (${res.status})`);
      last = res;
    }
    return graphItem(await last.json());
  },
};

// ───────────────────────── Google Drive ─────────────────────────

const GOOGLE_EXPORT = {
  'application/vnd.google-apps.document': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  'application/vnd.google-apps.presentation': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  'application/vnd.google-apps.drawing': ['image/png', '.png'],
};
const gItem = f => ({
  id: f.id, name: f.name, type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
  size: f.size ? Number(f.size) : null, modified: f.modifiedTime ? Math.floor(Date.parse(f.modifiedTime) / 1000) : null,
  mime: f.mimeType === 'application/vnd.google-apps.folder' ? null : f.mimeType, web_url: f.webViewLink || null,
});
const G_FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,parents';

const google = {
  async list(user, id) {
    const parent = id || 'root';
    const items = [];
    let token = '';
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ q: `'${parent.replace(/['\\]/g, '')}' in parents and trashed=false`, fields: `nextPageToken,files(${G_FIELDS})`, pageSize: '200', orderBy: 'folder,name', ...(token ? { pageToken: token } : {}) });
      const data = await (await api(user, 'google', `${GDRIVE()}/files?${q}`)).json();
      items.push(...(data.files || []).map(gItem));
      token = data.nextPageToken;
      if (!token) break;
    }
    const crumbs = [{ id: '', name: 'Google Drive' }];
    if (id) {
      const me = await (await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}?fields=${G_FIELDS}`)).json();
      crumbs.push({ id: me.id, name: me.name });
    }
    return { items, crumbs };
  },
  async download(user, id) {
    const meta = await (await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}?fields=${G_FIELDS}`)).json();
    if (meta.mimeType === 'application/vnd.google-apps.folder') throw new FileError(400, 'That’s a folder');
    const exp = GOOGLE_EXPORT[meta.mimeType];
    if (meta.mimeType?.startsWith('application/vnd.google-apps.') && !exp) throw new FileError(400, 'This kind of Google file can’t be downloaded — open it in Google Drive instead');
    const res = exp
      ? await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exp[0])}`)
      : await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}?alt=media`);
    return { stream: Readable.fromWeb(res.body), name: exp ? `${meta.name}${exp[1]}` : meta.name, mime: exp ? exp[0] : meta.mimeType, size: meta.size ? Number(meta.size) : null, web_url: meta.webViewLink };
  },
  async upload(user, parentId, name, buffer, mime) {
    const boundary = `synapse${crypto.randomBytes(8).toString('hex')}`;
    const metaJson = JSON.stringify({ name: safeFileName(name), parents: [parentId || 'root'] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
      buffer, Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await api(user, 'google', `${GUPLOAD()}/files?uploadType=multipart&fields=${G_FIELDS}`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    return gItem(await res.json());
  },
};

// ───────────────────────── one interface for all sources ─────────────────────────

/** What this person can browse: folders shared with them + cloud drives (if the admin set them up). */
export function sourcesFor(user) {
  const out = [];
  for (const f of mountedFolders()) {
    const mode = folderMode(f, user);
    if (mode) out.push({ id: `folder:${f.slug}`, kind: 'folder', name: f.name, can_write: mode === 'write' });
  }
  const accounts = new Map(db.prepare('SELECT provider, account FROM file_accounts WHERE user_id=?').all(user.id).map(r => [r.provider, r.account]));
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (!configured(id)) continue;
    out.push({ id, kind: id, name: p.label, connected: accounts.has(id), account: accounts.get(id) || '', can_write: true });
  }
  return out;
}

function resolve(user, sourceId) {
  if (sourceId?.startsWith('folder:')) {
    const folder = mountedFolders().find(f => `folder:${f.slug}` === sourceId);
    const mode = folderMode(folder, user);
    if (!mode) throw new FileError(404, 'You don’t have access to that folder');
    return { type: 'folder', folder, canWrite: mode === 'write' };
  }
  if (PROVIDERS[sourceId]) {
    if (!configured(sourceId)) throw new FileError(400, `${PROVIDERS[sourceId].label} isn’t set up on this server`);
    return { type: sourceId, canWrite: true };
  }
  throw new FileError(404, 'Unknown file location');
}

export async function listFiles(user, sourceId, id) {
  const s = resolve(user, sourceId);
  const r = s.type === 'folder' ? await folderSource.list(user, s.folder, id) : await (s.type === 'onedrive' ? onedrive : google).list(user, id || '');
  r.items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'folder' ? -1 : 1));
  return { ...r, can_write: s.canWrite };
}

export async function downloadFile(user, sourceId, id) {
  const s = resolve(user, sourceId);
  return s.type === 'folder' ? folderSource.download(user, s.folder, id) : (s.type === 'onedrive' ? onedrive : google).download(user, id);
}

export async function uploadFile(user, sourceId, parentId, name, buffer, mime) {
  const s = resolve(user, sourceId);
  if (!s.canWrite) throw new FileError(403, 'You can only read this folder');
  return s.type === 'folder' ? folderSource.upload(user, s.folder, parentId, name, buffer) : (s.type === 'onedrive' ? onedrive : google).upload(user, parentId, name, buffer, mime);
}

/** Copy a file from a source into a note's attachments (so it works without the source). */
export async function attachCopy(user, sourceId, id, noteId) {
  const file = await downloadFile(user, sourceId, id);
  if (file.size && file.size > 50 * 1024 * 1024) { file.stream.destroy?.(); throw new FileError(413, 'That file is bigger than 50 MB — link to it instead'); }
  const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const stored = `${crypto.randomUUID()}${ext}`;
  const dest = path.join(UPLOADS_DIR, stored);
  let size = 0;
  await new Promise((resolveP, reject) => {
    const out = fs.createWriteStream(dest);
    file.stream.on('data', chunk => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) { file.stream.destroy(new FileError(413, 'That file is bigger than 50 MB — link to it instead')); }
    });
    file.stream.on('error', err => { out.destroy(); reject(err); });
    out.on('error', reject);
    out.on('finish', resolveP);
    file.stream.pipe(out);
  }).catch(err => { fs.rmSync(dest, { force: true }); throw err; });
  const attId = crypto.randomUUID();
  const original = file.name.replace(/[\r\n"\\/]/g, '_').slice(0, 255);
  db.prepare('INSERT INTO attachments (id,note_id,filename,original_name,mime_type,size) VALUES (?,?,?,?,?,?)').run(attId, noteId, stored, original, file.mime, size);
  return { id: attId, name: original, mime: file.mime, size };
}


// ───────────────────────── backups to a cloud drive (backups.js / cloudBackups.js) ─────────────────────────
//
// Backups can be gigabytes, so they're sent from the file in pieces (never read into memory whole).
// They go into one folder ("Synapse Backups" at the top of the drive) of the admin who set it up.

async function readChunk(fd, start, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fd.read(buf, 0, len, start);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
}

const odBackups = {
  async ensureFolder(user, name) {
    const res = await fetch(`${GRAPH()}/me/drive/root:/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${await accessToken(user, 'onedrive')}` } });
    if (res.ok) { const f = await res.json(); if (f.folder) return { id: f.id, name: f.name }; }
    const made = await (await api(user, 'onedrive', `${GRAPH()}/me/drive/root/children`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    })).json();
    return { id: made.id, name: made.name };
  },
  async list(user, folderId) {
    const out = [];
    let next = `${GRAPH()}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200&$select=id,name,size,file,lastModifiedDateTime`;
    for (let page = 0; next && page < 20; page++) {
      const data = await (await api(user, 'onedrive', next)).json();
      for (const i of data.value || []) if (i.file) out.push({ id: i.id, name: i.name, size: i.size, modified: Math.floor(Date.parse(i.lastModifiedDateTime) / 1000) || null });
      next = data['@odata.nextLink'];
    }
    return out;
  },
  async upload(user, folderId, filePath, name, onProgress) {
    const size = (await fs.promises.stat(filePath)).size;
    const session = await (await api(user, 'onedrive', `${GRAPH()}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    })).json();
    const CHUNK = 320 * 1024 * 32; // 10 MiB (must be a multiple of 320 KiB)
    const fd = await fs.promises.open(filePath, 'r');
    try {
      let last = null;
      for (let start = 0; start < size || (size === 0 && !last); start += CHUNK) {
        const body = await readChunk(fd, start, Math.min(CHUNK, size - start));
        const end = start + body.length;
        let res;
        for (let attempt = 0; ; attempt++) { // the upload address needs no sign-in header
          res = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${size}` }, body }).catch(e => ({ ok: false, status: 0, e }));
          if (res.ok || res.status === 202 || attempt >= 3 || (res.status >= 400 && res.status < 500)) break;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
        if (!res.ok && res.status !== 202) throw new FileError(502, `OneDrive upload failed (${res.status || 'no connection'})`);
        last = res;
        onProgress?.(end, size);
        if (size === 0) break;
      }
      const item = await last.json();
      return { id: item.id, name: item.name, size: item.size };
    } finally { await fd.close(); }
  },
  async remove(user, id) {
    await api(user, 'onedrive', `${GRAPH()}/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async download(user, id) {
    const res = await api(user, 'onedrive', `${GRAPH()}/me/drive/items/${encodeURIComponent(id)}/content`);
    return Readable.fromWeb(res.body);
  },
};

const gBackups = {
  async ensureFolder(user, name) {
    const q = new URLSearchParams({ q: `name='${name.replace(/['\\]/g, '')}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`, fields: 'files(id,name)' });
    const found = (await (await api(user, 'google', `${GDRIVE()}/files?${q}`)).json()).files?.[0];
    if (found) return { id: found.id, name: found.name };
    const made = await (await api(user, 'google', `${GDRIVE()}/files?fields=id,name`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }),
    })).json();
    return { id: made.id, name: made.name };
  },
  async list(user, folderId) {
    const out = [];
    let token = '';
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ q: `'${folderId.replace(/['\\]/g, '')}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`, fields: 'nextPageToken,files(id,name,size,modifiedTime)', pageSize: '200', ...(token ? { pageToken: token } : {}) });
      const data = await (await api(user, 'google', `${GDRIVE()}/files?${q}`)).json();
      for (const f of data.files || []) out.push({ id: f.id, name: f.name, size: Number(f.size) || 0, modified: Math.floor(Date.parse(f.modifiedTime) / 1000) || null });
      token = data.nextPageToken;
      if (!token) break;
    }
    return out;
  },
  async upload(user, folderId, filePath, name, onProgress) {
    const size = (await fs.promises.stat(filePath)).size;
    // Resumable upload: one request for the address, then the file in pieces.
    const start0 = await api(user, 'google', `${GUPLOAD()}/files?uploadType=resumable&fields=id,name,size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name: safeFileName(name), parents: [folderId] }),
    });
    const url = start0.headers.get('location');
    if (!url) throw new FileError(502, 'Google Drive didn’t give an upload address');
    const CHUNK = 256 * 1024 * 40; // 10 MiB (must be a multiple of 256 KiB)
    const fd = await fs.promises.open(filePath, 'r');
    try {
      for (let start = 0; ; start += CHUNK) {
        const body = await readChunk(fd, start, Math.min(CHUNK, size - start));
        const end = start + body.length;
        let res;
        for (let attempt = 0; ; attempt++) {
          res = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${await accessToken(user, 'google')}`, 'Content-Range': size ? `bytes ${start}-${end - 1}/${size}` : 'bytes */0' }, body }).catch(() => ({ ok: false, status: 0 }));
          if (res.ok || res.status === 308 || attempt >= 3 || (res.status >= 400 && res.status < 500)) break;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
        onProgress?.(end, size);
        if (res.ok) {
          const f = await res.json();
          // Drive allows two files with the same name: drop an older copy of this backup (sent again).
          for (const o of await gBackups.list(user, folderId).catch(() => [])) if (o.name === f.name && o.id !== f.id) await gBackups.remove(user, o.id).catch(() => {});
          return { id: f.id, name: f.name, size: Number(f.size) || size };
        }
        if (res.status !== 308) throw new FileError(502, `Google Drive upload failed (${res.status || 'no connection'})`);
        if (end >= size) throw new FileError(502, 'Google Drive didn’t finish the upload');
      }
    } finally { await fd.close(); }
  },
  async remove(user, id) {
    await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async download(user, id) {
    const res = await api(user, 'google', `${GDRIVE()}/files/${encodeURIComponent(id)}?alt=media`);
    return Readable.fromWeb(res.body);
  },
};

/** Backup operations for a provider ('onedrive' | 'google'). */
export function backupDrive(provider) {
  if (!PROVIDERS[provider]) throw new FileError(400, 'Unknown drive');
  if (!configured(provider)) throw new FileError(400, `${PROVIDERS[provider].label} isn’t set up on this server (Settings → Server → Files)`);
  return provider === 'onedrive' ? odBackups : gBackups;
}
export const driveLabel = provider => PROVIDERS[provider]?.label || provider;
/** The drives this person has connected (for choosing where backups go). */
export function connectedDrives(userId) {
  return db.prepare('SELECT provider, account FROM file_accounts WHERE user_id=?').all(userId)
    .filter(r => PROVIDERS[r.provider] && configured(r.provider))
    .map(r => ({ provider: r.provider, label: PROVIDERS[r.provider].label, account: r.account }));
}
export const drivesConfigured = () => Object.keys(PROVIDERS).filter(configured).map(id => ({ provider: id, label: PROVIDERS[id].label }));


// ───────────────────────── OneNote (import) ─────────────────────────
//
// Reads notebooks → sections (and section groups) → pages with the person's own Microsoft sign-in
// (needs the Notes.Read permission: "Connect OneNote" in the import window). Page pictures are
// downloaded here and put into the page as data URLs; attached files are fetched one by one through
// oneNoteResource(), which only accepts OneNote resource addresses on Microsoft Graph.

export function hasOneNote(user) {
  const row = db.prepare("SELECT tokens_enc FROM file_accounts WHERE user_id=? AND provider='onedrive'").get(user.id);
  if (!row) return 'none';
  try { return (JSON.parse(decrypt(row.tokens_enc) || '{}').scope || '').includes(ONENOTE_SCOPE) ? 'yes' : 'no'; } catch { return 'no'; }
}

async function graphJson(user, url, tries = 0) {
  const token = await accessToken(user, 'onedrive');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 && tries < 4) { // OneNote limits how fast pages can be read
    await new Promise(r => setTimeout(r, Math.min(30, Number(res.headers.get('retry-after')) || 5 * (tries + 1)) * 1000));
    return graphJson(user, url, tries + 1);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new FileError(403, 'OneNote: Synapse isn’t allowed to read your notebooks yet — click “Connect OneNote”');
    throw new FileError(res.status === 404 ? 404 : 502, `OneNote: ${data.error?.message || res.statusText}`);
  }
  return res;
}
async function graphAll(user, url) {
  const out = [];
  for (let next = url, page = 0; next && page < 50; page++) {
    const data = await (await graphJson(user, next)).json();
    out.push(...(data.value || []));
    next = data['@odata.nextLink'];
  }
  return out;
}

/** Notebooks with their sections (section groups become nested). */
export async function oneNoteNotebooks(user) {
  const sel = 'id,displayName';
  const groups = async (url, depth) => {
    if (depth > 3) return [];
    const list = await graphAll(user, url);
    return Promise.all(list.map(async g => ({
      id: g.id, name: g.displayName,
      sections: (await graphAll(user, `${GRAPH()}/me/onenote/sectionGroups/${encodeURIComponent(g.id)}/sections?$select=${sel}`)).map(x => ({ id: x.id, name: x.displayName })),
      groups: await groups(`${GRAPH()}/me/onenote/sectionGroups/${encodeURIComponent(g.id)}/sectionGroups?$select=${sel}`, depth + 1),
    })));
  };
  const books = await graphAll(user, `${GRAPH()}/me/onenote/notebooks?$select=${sel}&$orderby=displayName`);
  return Promise.all(books.map(async b => ({
    id: b.id, name: b.displayName,
    sections: (await graphAll(user, `${GRAPH()}/me/onenote/notebooks/${encodeURIComponent(b.id)}/sections?$select=${sel}`)).map(x => ({ id: x.id, name: x.displayName })),
    groups: await groups(`${GRAPH()}/me/onenote/notebooks/${encodeURIComponent(b.id)}/sectionGroups?$select=${sel}`, 1),
  })));
}

export async function oneNotePages(user, sectionId) {
  const pages = await graphAll(user, `${GRAPH()}/me/onenote/sections/${encodeURIComponent(sectionId)}/pages?$select=id,title,createdDateTime,level,order&$top=100&pagelevel=true`);
  return pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(p => ({ id: p.id, title: p.title || 'Untitled page', level: p.level || 0, created: p.createdDateTime || null }));
}

const isResource = u => typeof u === 'string' && u.startsWith(`${GRAPH()}/`) && /\/onenote\/resources\/[^/]+\/(\$value|content)/.test(u);
const MAX_PICTURE = 15 * 1024 * 1024;

/** A page's HTML, with pictures as data URLs and attached files marked for oneNoteResource(). */
export async function oneNotePage(user, pageId) {
  let html = await (await graphJson(user, `${GRAPH()}/me/onenote/pages/${encodeURIComponent(pageId)}/content`)).text();
  const pics = [...new Set([...html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)].map(m => m[1].replace(/&amp;/g, '&')).filter(isResource))];
  const data = new Map();
  for (const url of pics.slice(0, 200)) {
    try {
      const res = await graphJson(user, url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_PICTURE) continue;
      const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
      if (!/^image\//.test(type)) continue;
      data.set(url, `data:${type};base64,${buf.toString('base64')}`);
    } catch { /* leave it out */ }
  }
  html = html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (m, a, src, b) => {
    const d = data.get(src.replace(/&amp;/g, '&'));
    return d ? `${a}${d}${b}` : `${a}${b}`;
  });
  return { html };
}

/** Download one attached file of a OneNote page (url from the page HTML). */
export async function oneNoteResource(user, url) {
  if (!isResource(url)) throw new FileError(400, 'Not a OneNote file');
  const res = await graphJson(user, url);
  return { stream: Readable.fromWeb(res.body), type: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0], size: Number(res.headers.get('content-length')) || null };
}
