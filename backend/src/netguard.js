// Outbound requests to addresses people type in (calendar links, AI service addresses, push endpoints)
// go through here, so nobody can use the server to reach things it shouldn't:
//   • never: link-local / cloud metadata (169.254.x.x, fe80::), "this network", multicast, reserved
//   • the server itself and private networks (127.x, 10.x, 172.16–31.x, 192.168.x, 100.64.x, fc00::/7):
//     only for admins, or for everyone if an admin turned that on (Settings → Server) — e.g. Ollama on the LAN
// Every hop is checked: the resolved IP at connect time (so DNS tricks don't work) and every redirect.
import dns from 'dns';
import net from 'net';
import https from 'https';
import { Agent, fetch as undiciFetch } from 'undici';
import { getSetting } from './settings.js';

const NEVER = new net.BlockList();
NEVER.addSubnet('0.0.0.0', 8);
NEVER.addSubnet('169.254.0.0', 16);
NEVER.addSubnet('224.0.0.0', 4);
NEVER.addSubnet('240.0.0.0', 4);
NEVER.addAddress('::', 'ipv6');
NEVER.addSubnet('fe80::', 10, 'ipv6');
NEVER.addSubnet('ff00::', 8, 'ipv6');

const LOCAL = new net.BlockList();
LOCAL.addSubnet('127.0.0.0', 8);
LOCAL.addSubnet('10.0.0.0', 8);
LOCAL.addSubnet('172.16.0.0', 12);
LOCAL.addSubnet('192.168.0.0', 16);
LOCAL.addSubnet('100.64.0.0', 10);
LOCAL.addSubnet('198.18.0.0', 15);
LOCAL.addAddress('::1', 'ipv6');
LOCAL.addSubnet('fc00::', 7, 'ipv6');

export class BlockedAddressError extends Error {
  constructor(local) {
    super(local
      ? 'That address is on this server’s own network. Only an admin can use local-network addresses (an admin can allow it for everyone in Settings → Server → Sign-ups & about).'
      : 'That address can’t be used.');
    this.code = 'EBLOCKED';
    this.status = 400;
  }
}

/** null if the IP may be reached, else the reason ('never' | 'local'). */
export function addressBlocked(ip, allowLocal) {
  let addr = String(ip).replace(/^\[|\]$/g, '');
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) addr = mapped[1];
  const family = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
  if (!family) return 'never';
  if (NEVER.check(addr, family)) return 'never';
  if (!allowLocal && LOCAL.check(addr, family)) return 'local';
  return null;
}

/** May this person reach local-network addresses? */
export const mayUseLocal = user => user?.role === 'admin' || getSetting('allow_local_urls') === 'true';

function lookupFor(allowLocal) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      let reason = null;
      const ok = addrs.filter(a => { const r = addressBlocked(a.address, allowLocal); if (r) reason = r; return !r; });
      if (!ok.length) return cb(new BlockedAddressError(reason === 'local'));
      if (options.all) return cb(null, ok);
      return cb(null, ok[0].address, ok[0].family);
    });
  };
}

const agents = {
  public: new Agent({ connect: { lookup: lookupFor(false) } }),
  local: new Agent({ connect: { lookup: lookupFor(true) } }),
};
/** An https.Agent for libraries that use Node's https (web-push): public addresses only. */
export const publicHttpsAgent = new https.Agent({ keepAlive: true, lookup: lookupFor(false) });

/** Check a URL before using it: http(s) only, and an IP written in the URL must be allowed. */
export function checkUrl(url, allowLocal) {
  let u;
  try { u = new URL(url); } catch { throw Object.assign(new Error('That doesn’t look like a web address.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Only http:// and https:// addresses can be used.'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { const r = addressBlocked(host, allowLocal); if (r) throw new BlockedAddressError(r === 'local'); }
  if (/^localhost$|\.localhost$/i.test(host) && !allowLocal) throw new BlockedAddressError(true);
  return u;
}

/**
 * fetch() for addresses people typed in. `allowLocal`: may reach private networks / this server.
 * Redirects are followed by hand (up to 5) so every hop is checked.
 */
export async function guardedFetch(url, opts = {}, { allowLocal = false } = {}) {
  const dispatcher = allowLocal ? agents.local : agents.public;
  let current = String(url);
  for (let hop = 0; hop < 6; hop++) {
    checkUrl(current, allowLocal);
    let res;
    try {
      res = await undiciFetch(current, { ...opts, redirect: 'manual', dispatcher });
    } catch (err) {
      const blocked = err?.code === 'EBLOCKED' ? err : err?.cause?.code === 'EBLOCKED' ? err.cause : null;
      if (blocked) throw blocked;
      throw err;
    }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc || opts.redirect === 'manual') return res;
    current = new URL(loc, current).href;
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && opts.method && opts.method !== 'GET' && opts.method !== 'HEAD')) {
      opts = { ...opts, method: 'GET', body: undefined };
    }
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 502 });
}
