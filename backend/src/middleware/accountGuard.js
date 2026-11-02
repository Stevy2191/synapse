// Limits wrong guesses per account (on top of the per-address limits), so guessing a password or a
// two-step code from many different addresses doesn't work either. After too many wrong tries the
// account's sign-in pauses for 15 minutes; a right answer clears the count.
const WINDOW = 15 * 60 * 1000;
const fails = new Map(); // key → { n, first, lockedUntil }
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (v.first + WINDOW < t && (v.lockedUntil || 0) < t) fails.delete(k); }, 60_000).unref();

/** Minutes left if this key is locked, else 0. */
export function lockedFor(key) {
  const f = fails.get(key);
  if (!f?.lockedUntil) return 0;
  const left = f.lockedUntil - Date.now();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function recordFailure(key, max) {
  const now = Date.now();
  let f = fails.get(key);
  if (!f || f.first + WINDOW < now) f = { n: 0, first: now, lockedUntil: 0 };
  f.n++;
  if (f.n >= max) f.lockedUntil = now + WINDOW;
  fails.set(key, f);
}

export const clearFailures = key => fails.delete(key);
