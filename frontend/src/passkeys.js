// Passkeys in the browser. Browsers only offer them on HTTPS with a web address
// (or on localhost) — never on a bare IP address like 192.168.1.10.
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import api from './api';

export function passkeySupport() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { ok: false, reason: 'This browser doesn’t support passkeys.' };
  }
  const host = location.hostname;
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return { ok: false, reason: 'Passkeys need Synapse to be opened at a web address (like notes.example.com) with HTTPS. They can’t be used with an IP address.' };
  }
  if (!window.isSecureContext) {
    return { ok: false, reason: 'Passkeys need a secure (https://) connection to Synapse.' };
  }
  return { ok: true };
}

// A friendly default name for a new passkey, e.g. "iPhone" or "Windows PC".
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'This device';
}

function friendlyError(err) {
  if (err?.name === 'NotAllowedError') return new Error('Cancelled, or the passkey wasn’t available.');
  if (err?.name === 'InvalidStateError') return new Error('This device already has a passkey for your account.');
  return new Error(err?.response?.data?.error || err?.message || 'Something went wrong with the passkey.');
}

/** Sign in with a passkey. Pass the mfa_token when it's the second step after a password. */
export async function signInWithPasskey(mfaToken) {
  try {
    const { data } = await api.post('/auth/passkey/options', mfaToken ? { mfa_token: mfaToken } : {});
    const response = await startAuthentication({ optionsJSON: data.options });
    const res = await api.post('/auth/passkey/verify', { challenge_id: data.challenge_id, response });
    return res.data; // { token, user }
  } catch (err) { throw friendlyError(err); }
}

/** Save a new passkey for the signed-in user. Returns recovery codes if they were just created. */
export async function registerPasskey(name) {
  try {
    const { data } = await api.post('/auth/passkeys/register/options');
    const response = await startRegistration({ optionsJSON: data.options });
    const res = await api.post('/auth/passkeys/register/verify', { challenge_id: data.challenge_id, response, name });
    return res.data;
  } catch (err) { throw friendlyError(err); }
}
