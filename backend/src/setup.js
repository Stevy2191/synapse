// One-time setup code for creating the first (admin) account.
//
// Until an admin exists, anyone who can reach Synapse could create the admin account. To stop a
// stranger getting there first, the first sign-up must include this code. It's shown by the
// installer, printed in the server log, and available with `synapse setup-code`.
//
//   SETUP_CODE=<code>  use this code instead of a random one
//   SETUP_CODE=off     don't require a code (e.g. on a trusted network)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, '.setup_code');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

function normalize(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generate() {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function setupCodeDisabled() {
  return process.env.SETUP_CODE?.trim().toLowerCase() === 'off';
}

/** Call at startup. Creates (or removes) the code depending on whether an admin exists. */
export function prepareSetupCode(userCount) {
  if (userCount > 0) { clearSetupCode(); return; }
  if (setupCodeDisabled()) {
    console.log('⚠️  SETUP_CODE=off: the first person to open Synapse becomes the admin.');
    return;
  }
  let code = process.env.SETUP_CODE?.trim();
  if (!code) {
    try { code = fs.readFileSync(FILE, 'utf8').trim(); } catch {}
  }
  if (!code) code = generate();
  fs.writeFileSync(FILE, code + '\n', { mode: 0o600 });
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │  Welcome to Synapse!                         │');
  console.log(`  │  Setup code for the admin account: ${code.padEnd(10)}│`);
  console.log('  │  Open Synapse in your browser to create it.  │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
}

export function checkSetupCode(input) {
  if (setupCodeDisabled()) return true;
  let expected = process.env.SETUP_CODE?.trim();
  if (!expected) {
    try { expected = fs.readFileSync(FILE, 'utf8').trim(); } catch { return false; }
  }
  const a = Buffer.from(normalize(input));
  const b = Buffer.from(normalize(expected));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

export function clearSetupCode() {
  try { fs.unlinkSync(FILE); } catch {}
}
