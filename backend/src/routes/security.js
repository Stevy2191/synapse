// Two-step verification routes (mounted under /api/auth).
import { Router } from 'express';
import { lockedFor, recordFailure, clearFailures } from '../middleware/accountGuard.js';
import bcrypt from 'bcryptjs';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { db } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, PUBLIC_USER_FIELDS } from '../users.js';
import {
  ISSUER, userFromMfaToken, mfaMethods, startTotpSetup, checkTotp, newRecoveryCodes,
  recoveryCodesIfFirst, useRecoveryCode, cleanupIfNoMfa, saveChallenge, takeChallenge,
  relyingParty, userPasskeys, passkeyCredential,
} from '../mfa.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

/** A full session for this user, in the same shape as /login returns. */
export function sessionFor(userId) {
  const user = db.prepare(`SELECT ${PUBLIC_USER_FIELDS}, token_version FROM users WHERE id=?`).get(userId);
  const { token_version, ...publicUser } = user;
  return { token: signToken(user), user: publicUser };
}

async function confirmPassword(userId, password) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId);
  if (typeof password !== 'string' || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(400, 'Your password isn’t right.');
  }
}

// ── Finishing a two-step sign-in ────────────────────────────────────────────
router.post('/mfa/totp', limiter, (req, res, next) => {
  try {
    const user = userFromMfaToken(req.body?.mfa_token);
    const key = `mfa:${user.id}`;
    const wait = lockedFor(key);
    if (wait) throw new HttpError(429, `Too many wrong codes. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    if (!user.totp_enabled || !checkTotp(user, req.body?.code)) { recordFailure(key, 6); throw new HttpError(401, 'That code isn’t right. Codes change every 30 seconds — try the newest one.'); }
    clearFailures(key);
    res.json(sessionFor(user.id));
  } catch (err) { next(err); }
});

router.post('/mfa/recovery', limiter, (req, res, next) => {
  try {
    const user = userFromMfaToken(req.body?.mfa_token);
    const key = `mfa:${user.id}`;
    const wait = lockedFor(key);
    if (wait) throw new HttpError(429, `Too many wrong codes. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    if (!useRecoveryCode(user.id, req.body?.code)) { recordFailure(key, 6); throw new HttpError(401, 'That recovery code isn’t right, or it has already been used.'); }
    clearFailures(key);
    const left = db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(user.id).c;
    res.json({ ...sessionFor(user.id), recovery_codes_left: left });
  } catch (err) { next(err); }
});

// ── Signing in with a passkey ───────────────────────────────────────────────
// With an mfa_token: the passkey is the second step after a password.
// Without one: passwordless sign-in with any passkey saved on the device.
router.post('/passkey/options', limiter, async (req, res, next) => {
  try {
    const { rpID } = relyingParty(req);
    let userId = null;
    let allowCredentials;
    if (req.body?.mfa_token) {
      userId = userFromMfaToken(req.body.mfa_token).id;
      allowCredentials = userPasskeys(userId).map(p => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined }));
      if (allowCredentials.length === 0) throw new HttpError(400, 'No passkeys are set up for this account.');
    }
    const options = await generateAuthenticationOptions({
      rpID, allowCredentials,
      // Passwordless sign-in must check it's really you (Face ID, fingerprint or PIN).
      userVerification: userId ? 'preferred' : 'required',
    });
    const challenge_id = saveChallenge({ purpose: 'login', challenge: options.challenge, userId });
    res.json({ challenge_id, options });
  } catch (err) { next(err); }
});

router.post('/passkey/verify', limiter, async (req, res, next) => {
  try {
    const { rpID, origin } = relyingParty(req);
    const c = takeChallenge(req.body?.challenge_id, 'login');
    const response = req.body?.response;
    const row = response?.id && db.prepare('SELECT * FROM passkeys WHERE id=?').get(String(response.id));
    if (!row || (c.userId && row.user_id !== c.userId)) throw new HttpError(401, 'That passkey isn’t registered with Synapse.');
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID,
        credential: passkeyCredential(row), requireUserVerification: !c.userId,
      });
    } catch (e) {
      throw new HttpError(401, 'The passkey couldn’t be verified. Please try again.');
    }
    if (!result.verified) throw new HttpError(401, 'The passkey couldn’t be verified.');
    db.prepare('UPDATE passkeys SET counter=?, last_used_at=unixepoch() WHERE id=?').run(result.authenticationInfo.newCounter, row.id);
    res.json(sessionFor(row.user_id));
  } catch (err) { next(err); }
});

// ── Managing two-step verification (signed in) ──────────────────────────────
router.get('/security', requireAuth, (req, res) => {
  const u = db.prepare('SELECT totp_enabled FROM users WHERE id=?').get(req.user.id);
  const passkeys = userPasskeys(req.user.id).map(p => ({
    id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at,
    synced: !!p.backed_up,
  }));
  const recoveryLeft = db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(req.user.id).c;
  res.json({ totp_enabled: !!u.totp_enabled, passkeys, recovery_codes_left: recoveryLeft, methods: mfaMethods(req.user.id) });
});

router.post('/totp/setup', requireAuth, limiter, (req, res) => {
  const user = db.prepare('SELECT id, username, totp_enabled FROM users WHERE id=?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: 'An authenticator app is already set up. Turn it off first to switch apps.' });
  res.json(startTotpSetup(user));
});

router.post('/totp/enable', requireAuth, limiter, (req, res, next) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (user.totp_enabled) throw new HttpError(400, 'Already turned on.');
    if (!user.totp_secret) throw new HttpError(400, 'Start the setup first.');
    if (!checkTotp(user, req.body?.code)) throw new HttpError(400, 'That code isn’t right. Make sure the app is set up with the code shown, then enter the newest 6-digit code.');
    db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(user.id);
    res.json({ ok: true, recovery_codes: recoveryCodesIfFirst(user.id) });
  } catch (err) { next(err); }
});

router.post('/totp/disable', requireAuth, limiter, async (req, res, next) => {
  try {
    await confirmPassword(req.user.id, req.body?.password);
    db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(req.user.id);
    cleanupIfNoMfa(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/passkeys/register/options', requireAuth, limiter, async (req, res, next) => {
  try {
    const { rpID } = relyingParty(req);
    const user = db.prepare('SELECT id, username, email FROM users WHERE id=?').get(req.user.id);
    const options = await generateRegistrationOptions({
      rpName: ISSUER, rpID,
      userName: user.username, userDisplayName: user.username,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: userPasskeys(user.id).map(p => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
      // Saved on the device, so it can also be used to sign in without a password.
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challenge_id = saveChallenge({ purpose: 'register', challenge: options.challenge, userId: user.id });
    res.json({ challenge_id, options });
  } catch (err) { next(err); }
});

router.post('/passkeys/register/verify', requireAuth, limiter, async (req, res, next) => {
  try {
    const { rpID, origin } = relyingParty(req);
    const c = takeChallenge(req.body?.challenge_id, 'register');
    if (c.userId !== req.user.id) throw new HttpError(400, 'Please try again.');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: req.body?.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(400, 'The passkey couldn’t be saved. Please try again.');
    }
    if (!result.verified) throw new HttpError(400, 'The passkey couldn’t be verified.');
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const name = (typeof req.body?.name === 'string' && req.body.name.trim().slice(0, 60)) || 'Passkey';
    db.prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, device_type, backed_up)
      VALUES (?,?,?,?,?,?,?,?)`).run(credential.id, req.user.id, Buffer.from(credential.publicKey), credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null, name, credentialDeviceType, credentialBackedUp ? 1 : 0);
    res.json({ ok: true, recovery_codes: recoveryCodesIfFirst(req.user.id) });
  } catch (err) { next(err); }
});

router.patch('/passkeys/:id', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  if (!name) return res.status(400).json({ error: 'Give the passkey a name.' });
  const r = db.prepare('UPDATE passkeys SET name=? WHERE id=? AND user_id=?').run(name, req.params.id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.delete('/passkeys/:id', requireAuth, limiter, async (req, res, next) => {
  try {
    await confirmPassword(req.user.id, req.body?.password);
    const r = db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (r.changes === 0) throw new HttpError(404, 'Not found');
    cleanupIfNoMfa(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/recovery-codes', requireAuth, limiter, async (req, res, next) => {
  try {
    await confirmPassword(req.user.id, req.body?.password);
    if (mfaMethods(req.user.id).length === 0) throw new HttpError(400, 'Turn on two-step verification first.');
    res.json({ recovery_codes: newRecoveryCodes(req.user.id) });
  } catch (err) { next(err); }
});

export default router;
