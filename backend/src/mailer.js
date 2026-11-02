// Sending email (daily digest, tests). One mail account for the whole server, set by an admin in
// Settings → Server → Email: SMTP host/port/security/user/password/from. The password is stored
// encrypted with a key derived from JWT_SECRET. `app_url` (the address people open Synapse at) is
// remembered from the admin's browser so emails can link back into the app.
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { db } from './db/index.js';
import { JWT_SECRET } from './config.js';
import { getSetting, setSetting } from './settings.js';

const KEY = crypto.createHash('sha256').update(`synapse-mail-secret:${JWT_SECRET}`).digest();
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

export class MailError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function config() {
  return {
    host: getSetting('smtp_host') || '',
    port: Number(getSetting('smtp_port')) || 587,
    security: getSetting('smtp_security') || 'starttls', // 'tls' (465) | 'starttls' (587) | 'none'
    user: getSetting('smtp_user') || '',
    pass: decrypt(getSetting('smtp_pass_enc')) || '',
    from: getSetting('smtp_from') || '',
    app_url: getSetting('app_url') || '',
  };
}

export const mailConfigured = () => { const c = config(); return !!(c.host && c.from); };
export const appUrl = () => config().app_url.replace(/\/+$/, '');

/** Admin view (no password). */
export function mailView() {
  const c = config();
  return { host: c.host, port: c.port, security: c.security, user: c.user, pass_set: !!c.pass, from: c.from, app_url: c.app_url, configured: mailConfigured() };
}

export function updateMail(body = {}) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  if ('host' in body) {
    const h = str(body.host, 255);
    if (h && !/^[a-z0-9.-]+$/i.test(h)) throw new MailError(400, 'That doesn’t look like a mail server name (e.g. smtp.gmail.com)');
    setSetting('smtp_host', h);
  }
  if ('port' in body) {
    const p = Number(body.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new MailError(400, 'Port must be a number like 587 or 465');
    setSetting('smtp_port', String(p));
  }
  if ('security' in body) {
    if (!['tls', 'starttls', 'none'].includes(body.security)) throw new MailError(400, 'Unknown security setting');
    setSetting('smtp_security', body.security);
  }
  if ('user' in body) setSetting('smtp_user', str(body.user, 255));
  if ('pass' in body) {
    if (body.pass) setSetting('smtp_pass_enc', encrypt(String(body.pass)));
    else db.prepare('DELETE FROM settings WHERE key=?').run('smtp_pass_enc');
  }
  if ('from' in body) {
    const f = str(body.from, 255);
    if (f && !/[^\s@<>]+@[^\s@<>]+/.test(f)) throw new MailError(400, 'The “From” address needs an email address, e.g. Synapse <synapse@example.com>');
    setSetting('smtp_from', f);
  }
  if ('app_url' in body) {
    const u = str(body.app_url, 300);
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new MailError(400, 'The Synapse address must start with http:// or https://');
    setSetting('app_url', u.replace(/\/+$/, ''));
  }
  return mailView();
}

function transport() {
  const c = config();
  if (!c.host || !c.from) throw new MailError(400, 'Email isn’t set up yet — an admin can do it in Settings → Server → Email.');
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === 'tls',
    requireTLS: c.security === 'starttls',
    ignoreTLS: c.security === 'none',
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** Send one email. Throws MailError with a readable message on failure. */
export async function sendMail({ to, subject, text, html }) {
  const t = transport();
  try {
    await t.sendMail({ from: config().from, to, subject, text, html });
  } catch (err) {
    const msg = err.code === 'EAUTH' ? 'The mail server refused the username or password (Gmail and Outlook need an “app password”).'
      : ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED'].includes(err.code) || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message)
        ? `Couldn’t reach the mail server (${err.message}). Check the server name, port and security.`
        : `The mail server said: ${err.response || err.message}`;
    throw new MailError(502, msg);
  } finally { t.close(); }
}
