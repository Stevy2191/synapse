import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db, removeUploadFiles } from './db/index.js';
import { MIN_PASSWORD_LENGTH } from './config.js';

export const PUBLIC_USER_FIELDS = 'id,username,email,role,theme,created_at';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 200) throw new HttpError(400, 'Password is too long');
}

function validateNewUser({ username, email, password }) {
  if (typeof username !== 'string' || typeof email !== 'string' || !username.trim() || !email.trim() || !password) {
    throw new HttpError(400, 'Username, email and password are required');
  }
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username.trim())) {
    throw new HttpError(400, 'Username must be 2–32 characters: letters, numbers, . _ -');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid email address');
  }
  validatePassword(password);
}

/**
 * Creates a user plus their default workspace.
 * `canCreate(userCount)` runs inside the transaction and returns the role to assign,
 * or throws — this keeps "first user becomes admin" safe from concurrent sign-ups.
 */
export async function createUser({ username, email, password }, canCreate) {
  validateNewUser({ username, email, password });
  username = username.trim();
  email = email.trim().toLowerCase();
  const hash = await bcrypt.hash(password, 12);
  const id = uuid();

  db.transaction(() => {
    const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const role = canCreate(userCount);
    const existing = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(username, email);
    if (existing) throw new HttpError(409, 'Username or email already taken');
    db.prepare('INSERT INTO users (id,username,email,password_hash,role) VALUES (?,?,?,?,?)').run(id, username, email, hash, role);
    db.prepare('INSERT INTO workspaces (id,user_id,name,icon,color) VALUES (?,?,?,?,?)').run(uuid(), id, 'Personal', '🧠', '#6366f1');
  })();

  return db.prepare(`SELECT ${PUBLIC_USER_FIELDS}, token_version FROM users WHERE id=?`).get(id);
}

export async function setPassword(userId, password) {
  validatePassword(password);
  const hash = await bcrypt.hash(password, 12);
  // Bumping token_version signs the user out everywhere else.
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hash, userId);
  return db.prepare('SELECT id, token_version FROM users WHERE id=?').get(userId);
}

export function deleteUser(userId) {
  const files = db.prepare(`
    SELECT a.filename FROM attachments a
    JOIN notes n ON n.id=a.note_id
    JOIN workspaces w ON w.id=n.workspace_id
    WHERE w.user_id=?`).all(userId).map(r => r.filename);
  db.prepare('DELETE FROM users WHERE id=?').run(userId);
  removeUploadFiles(files);
}

export function adminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin'").get().c;
}
