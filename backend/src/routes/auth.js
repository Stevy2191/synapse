import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// Register (first user becomes admin)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const role = userCount === 0 ? 'admin' : 'user';

    const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const id = uuid();

    db.prepare('INSERT INTO users (id,username,email,password_hash,role) VALUES (?,?,?,?,?)').run(id, username, email, hash, role);

    // Create default workspace
    const wsId = uuid();
    db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(wsId, id, 'Personal', '🧠', '#6366f1');

    const user = db.prepare('SELECT id,username,email,role,theme FROM users WHERE id=?').get(id);
    const token = signToken({ id: user.id, username: user.username, role: user.role });

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(username, username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: user.id, username: user.username, role: user.role });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,username,email,role,theme FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Update theme
router.patch('/theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  const valid = ['dark', 'light', 'dracula', 'nord', 'solarized', 'tokyo-night'];
  if (!valid.includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
  db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, req.user.id);
  res.json({ theme });
});

export default router;
