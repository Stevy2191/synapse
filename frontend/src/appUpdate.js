// Keeps the app up to date. Synapse works offline because a service worker keeps a copy of the
// app in the browser. If that copy is stale (the worker didn't update — e.g. a reverse proxy
// cached it), people keep seeing an old version until a hard refresh. Here the app asks the
// server which build it has; if it's a different one, it drops the saved copy and reloads.
// Notes and other offline data (IndexedDB) are not touched.
/* global __BUILD_ID__ */
const MINE = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null;
const GUARD = 'synapse-updated-to';

async function check() {
  if (!MINE || !navigator.onLine) return;
  let server;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    server = (await res.json()).build;
  } catch { return; } // offline
  if (!server || server === MINE) return;
  // Only once per new build, so a misbehaving cache can never cause a reload loop.
  try { if (sessionStorage.getItem(GUARD) === server) return; sessionStorage.setItem(GUARD, server); } catch { return; }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map(r => r.unregister()));
    const names = (await window.caches?.keys?.()) || [];
    await Promise.all(names.filter(n => /workbox-precache|^precache/.test(n)).map(n => caches.delete(n)));
  } catch { /* still reload */ }
  location.reload();
}

export function startAppUpdateCheck() {
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
}
