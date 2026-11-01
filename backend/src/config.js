import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Placeholder secrets that have shipped in this repo's examples. Treat them as "not set".
const PLACEHOLDER_SECRETS = new Set([
  'change-me-to-something-secure-in-production',
  'change-me-to-something-very-long-and-random',
  'synapse-change-this-secret-in-production',
]);

/**
 * Use JWT_SECRET from the environment when it's a real secret. Otherwise generate a
 * random one and persist it in DATA_DIR so tokens survive restarts.
 */
function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && !PLACEHOLDER_SECRETS.has(fromEnv)) {
    if (fromEnv.length < 32) {
      console.warn('⚠️  JWT_SECRET is shorter than 32 characters. Generate one with: openssl rand -base64 48');
    }
    return fromEnv;
  }

  const secretFile = path.join(DATA_DIR, '.jwt_secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing) return existing;
  } catch {}

  const generated = crypto.randomBytes(48).toString('base64');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.log(`🔑 No JWT_SECRET set — generated one and saved it to ${secretFile}`);
  return generated;
}

export const JWT_SECRET = resolveJwtSecret();

// After the first (admin) account exists, public sign-up is closed unless this is "true".
export const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true';

export const MIN_PASSWORD_LENGTH = 8;

/** Days a deleted note stays in the Trash before it's removed for good (TRASH_DAYS, default 30). */
export const TRASH_DAYS = (() => {
  const n = Number.parseInt(process.env.TRASH_DAYS || '30', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3650) : 30;
})();

function resolveFrontendDist() {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.join(__dirname, '../frontend/dist'),    // Docker image layout (/app/frontend/dist)
    path.join(__dirname, '../../frontend/dist'), // Local repo layout
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(path.join(p, 'index.html'))) || candidates[candidates.length - 1];
}

export const FRONTEND_DIST = resolveFrontendDist();
