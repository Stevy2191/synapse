// Server-wide settings an admin can change from Settings → Server (stored in the database).
// Environment variables give the starting value; once an admin changes a setting, the stored
// value wins.
import { db } from './db/index.js';
import { ALLOW_REGISTRATION } from './config.js';

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

const DEFAULTS = {
  allow_registration: ALLOW_REGISTRATION ? 'true' : 'false',
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : DEFAULTS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function registrationOpen() {
  return getSetting('allow_registration') === 'true';
}

// Small pictures (avatars, workspace icons) are stored as data URLs. The browser shrinks them
// to a small square before upload; this just makes sure what arrives is a modest image.
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export function validImage(value) {
  return typeof value === 'string' && value.length <= 300_000 && IMAGE.test(value);
}
