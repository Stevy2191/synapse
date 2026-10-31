import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config.js';
import { db } from '../db/index.js';

export function signToken(user) {
  return jwt.sign({ id: user.id, tv: user.token_version ?? 0 }, JWT_SECRET, { expiresIn: '7d' });
}

const findUser = db.prepare('SELECT id, username, role, token_version FROM users WHERE id=?');

// Looks the user up on every request, so deleted users, role changes and
// password changes take effect immediately instead of when the token expires.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const user = findUser.get(payload.id);
  if (!user || (payload.tv ?? 0) !== user.token_version) {
    return res.status(401).json({ error: 'Session expired' });
  }
  req.user = { id: user.id, username: user.username, role: user.role };
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin required' });
    }
    next();
  });
}
