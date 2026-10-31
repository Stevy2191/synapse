import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { ALLOW_REGISTRATION } from '../config.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createUser, setPassword, HttpError, PUBLIC_USER_FIELDS } from '../users.js';
import { checkSetupCode, clearSetupCode, setupCodeDisabled } from '../setup.js';
import { hasMfa, mfaMethods, signMfaToken } from '../mfa.js';
import { sessionFor } from './security.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// A valid hash to compare against when the user doesn't exist, so response time
// doesn't reveal which usernames are registered.
const DUMMY_HASH = bcrypt.hashSync('synapse-timing-guard', 12);

function userCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

// Tells the login page whether to offer sign-up.
router.get('/status', (req, res) => {
  const setupRequired = userCount() === 0;
  res.json({
    setupRequired,
    setupCodeRequired: setupRequired && !setupCodeDisabled(),
    registrationOpen: setupRequired || ALLOW_REGISTRATION,
  });
});

// Register. The first user becomes admin; after that, sign-up is closed unless ALLOW_REGISTRATION=true.
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const user = await createUser(body, (count) => {
      if (count === 0) {
        if (!checkSetupCode(body.setup_code)) {
          throw new HttpError(403, 'That setup code isn’t right. It was shown by the installer — or run "synapse setup-code" on the server.');
        }
        return 'admin';
      }
      if (!ALLOW_REGISTRATION) throw new HttpError(403, 'Registration is closed. Ask your admin for an account.');
      return 'user';
    });
    if (user.role === 'admin') clearSetupCode();
    const { token_version, ...safeUser } = user;
    res.json({ token: signToken(user), user: safeUser });
  } catch (err) { next(err); }
});

// Login with username or email
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(username.trim(), username.trim());
    const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: 'Invalid username or password' });

    // Two-step verification: the password was right, now ask for the second step.
    if (hasMfa(user.id)) {
      return res.json({ mfa_required: true, mfa_token: signMfaToken(user), methods: mfaMethods(user.id) });
    }
    res.json(sessionFor(user.id));
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id=?`).get(req.user.id);
  res.json({ user });
});

router.patch('/theme', requireAuth, (req, res) => {
  const { theme } = req.body || {};
  const valid = ['auto', 'neural', 'neural-light', 'dark', 'light', 'dracula', 'nord', 'solarized', 'tokyo-night'];
  if (!valid.includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
  db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, req.user.id);
  res.json({ theme });
});

// Change own password. Returns a fresh token; all other sessions are signed out.
router.patch('/password', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if (typeof current_password !== 'string' || !(await bcrypt.compare(current_password, row.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const updated = await setPassword(req.user.id, new_password);
    res.json({ token: signToken(updated) });
  } catch (err) { next(err); }
});

export default router;
