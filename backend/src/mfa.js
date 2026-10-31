// Two-step verification: authenticator-app codes (TOTP), passkeys (WebAuthn) and recovery codes.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import { JWT_SECRET } from './config.js';
import { db } from './db/index.js';
import { HttpError } from './users.js';

export const ISSUER = 'Synapse';

// ── Second-step tokens ──────────────────────────────────────────────────────
// After a correct password, a user with two-step verification gets this short-lived token
// instead of a session. It only works for finishing sign-in (requireAuth rejects it).
export function signMfaToken(user) {
  return jwt.sign({ id: user.id, tv: user.token_version ?? 0, purpose: 'mfa' }, JWT_SECRET, { expiresIn: '10m' });
}

export function userFromMfaToken(token) {
  let payload;
  try { payload = jwt.verify(String(token || ''), JWT_SECRET); } catch { payload = null; }
  if (!payload || payload.purpose !== 'mfa') throw new HttpError(401, 'Your sign-in took too long. Please start again.');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.id);
  if (!user || user.token_version !== payload.tv) throw new HttpError(401, 'Please sign in again.');
  return user;
}

export function mfaMethods(userId) {
  const u = db.prepare('SELECT totp_enabled FROM users WHERE id=?').get(userId);
  const passkeys = db.prepare('SELECT COUNT(*) AS c FROM passkeys WHERE user_id=?').get(userId).c;
  const recovery = db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(userId).c;
  const methods = [];
  if (u?.totp_enabled) methods.push('totp');
  if (passkeys > 0) methods.push('passkey');
  if (methods.length && recovery > 0) methods.push('recovery');
  return methods;
}

export function hasMfa(userId) {
  return mfaMethods(userId).some(m => m === 'totp' || m === 'passkey');
}

// ── Authenticator app (TOTP) ────────────────────────────────────────────────
function totpFor(user, secret = user.totp_secret) {
  return new OTPAuth.TOTP({
    issuer: ISSUER, label: user.username, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function startTotpSetup(user) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(secret, user.id);
  return { secret, uri: totpFor(user, secret).toString() };
}

/** Checks a 6-digit code (allowing ±30s of clock drift) and refuses reuse of a code. */
export function checkTotp(user, code) {
  if (!user.totp_secret) return false;
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  const totp = totpFor(user);
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return false;
  const step = totp.counter() + delta;
  if (step <= user.totp_last_step) return false; // already used
  db.prepare('UPDATE users SET totp_last_step=? WHERE id=?').run(step, user.id);
  return true;
}

// ── Recovery codes ──────────────────────────────────────────────────────────
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const hashCode = code => crypto.createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

export function newRecoveryCodes(userId) {
  const codes = Array.from({ length: 10 }, () => {
    const raw = [...crypto.randomBytes(10)].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
    const insert = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const c of codes) insert.run(userId, hashCode(c));
  })();
  return codes;
}

/** Recovery codes are made the first time a two-step method is turned on. */
export function recoveryCodesIfFirst(userId) {
  const left = db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(userId).c;
  return left > 0 ? null : newRecoveryCodes(userId);
}

export function useRecoveryCode(userId, code) {
  const row = db.prepare('SELECT id FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL').get(userId, hashCode(String(code || '')));
  if (!row) return false;
  db.prepare('UPDATE recovery_codes SET used_at=unixepoch() WHERE id=?').run(row.id);
  return true;
}

/** When the last two-step method is removed, the recovery codes go too. */
export function cleanupIfNoMfa(userId) {
  if (!hasMfa(userId)) db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
}

export function resetMfa(userId) {
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_last_step=0, token_version=token_version+1 WHERE id=?').run(userId);
    db.prepare('DELETE FROM passkeys WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
  })();
}

// ── Passkeys (WebAuthn) ─────────────────────────────────────────────────────
// Challenges live in memory for a few minutes, keyed by a random id the browser sends back.
const challenges = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
}, 60_000).unref();

export function saveChallenge(data) {
  const id = crypto.randomBytes(16).toString('base64url');
  challenges.set(id, { ...data, expires: Date.now() + 5 * 60_000 });
  return id;
}

export function takeChallenge(id, purpose) {
  const c = challenges.get(String(id || ''));
  challenges.delete(String(id || ''));
  if (!c || c.expires < Date.now() || c.purpose !== purpose) throw new HttpError(400, 'That took too long. Please try again.');
  return c;
}

/**
 * Passkeys belong to a web address (the "relying party"). It's taken from the page making the
 * request, which must be the site serving Synapse. Browsers only allow passkeys on HTTPS with a
 * domain name (or on localhost) — never on a bare IP address.
 */
export function relyingParty(req) {
  const origin = req.get('origin');
  if (!origin) throw new HttpError(400, 'Missing origin');
  let url;
  try { url = new URL(origin); } catch { throw new HttpError(400, 'Bad origin'); }
  if (url.hostname !== req.hostname) throw new HttpError(400, 'Origin mismatch');
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new HttpError(400, 'Passkeys need Synapse to be opened at a web address (like notes.example.com), not an IP address.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new HttpError(400, 'Passkeys need a secure (https://) connection.');
  }
  return { rpID: url.hostname, origin: url.origin };
}

export function userPasskeys(userId) {
  return db.prepare('SELECT * FROM passkeys WHERE user_id=? ORDER BY created_at').all(userId);
}

export function passkeyCredential(row) {
  return {
    id: row.id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: row.transports ? JSON.parse(row.transports) : undefined,
  };
}
