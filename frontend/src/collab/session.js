// Live editing together: one CollabSession per open note in a shared workspace. It keeps a Yjs
// document (also saved on this device, so edits made offline merge in later), talks to the server
// over a WebSocket (/api/collab — see backend/src/collab.js for the messages), and shares who's
// here and where their cursor is.
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useStore } from '../stores/useStore';
import api from '../api';

const MSG_SYNC = 0, MSG_AWARENESS = 1, MSG_CONTROL = 3;
const COLORS = ['#e5534b', '#3b9eff', '#2fb67c', '#f2a93b', '#c061cb', '#14b8a6', '#f97316', '#6366f1', '#ec4899', '#84cc16'];
export const colorFor = id => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

const genKey = (userId, noteId) => `synapse.ygen.${userId}.${noteId}`;
const dbName = (userId, noteId) => `synapse-y-${userId}-${noteId}`;

export class CollabSession {
  constructor(noteId, { onStatus } = {}) {
    const { user } = useStore.getState();
    this.noteId = noteId;
    this.userId = user?.id;
    this.onStatus = onStatus || (() => {});
    this.status = { connected: false, synced: false, local: false, role: null, people: [] };
    this.handlers = { seed: null, external: null };
    this.queued = [];          // seed / external messages that arrived before the editor was ready
    this.pendingHtml = null;   // text to save once connected
    this.destroyed = false;
    this.retry = 1000;
    this.ydoc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    this.awareness.setLocalStateField('user', { name: user?.display_name || user?.username || 'Me', color: colorFor(user?.id), id: user?.id });
    this.persistence = new IndexeddbPersistence(dbName(this.userId, noteId), this.ydoc);
    this.whenLocal = this.persistence.whenSynced.then(() => {
      this.status.local = this.ydoc.getXmlFragment('default').length > 0;
      this.emit();
      return this.status.local;
    });
    this.onUpdate = (update, origin) => {
      if (origin === this) return; // came from the server
      this.sendSync(enc => syncProtocol.writeUpdate(enc, update));
    };
    this.ydoc.on('update', this.onUpdate);
    this.onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === 'remote') { this.updatePeople(); return; }
      const changed = added.concat(updated, removed);
      this.send(MSG_AWARENESS, enc => encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
    };
    this.awareness.on('update', this.onAwareness);
    this.onOnline = () => { if (!this.ws) this.connect(); };
    this.onOffline = () => { try { this.ws?.close(); } catch { /* ignore */ } };
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.connect();
  }

  emit() { this.onStatus({ ...this.status }); }
  updatePeople() {
    const people = [];
    this.awareness.getStates().forEach((s, id) => { if (id !== this.ydoc.clientID && s.user && !people.some(p => p.id === s.user.id)) people.push(s.user); });
    this.status.people = people;
    this.emit();
  }

  async connect() {
    if (this.destroyed || this.ws || this.connecting || !navigator.onLine) return;
    // A one-time pass instead of the sign-in token, so the token never appears in a URL (proxy logs).
    this.connecting = true;
    let ticket;
    try { ticket = (await api.post(`/notes/${this.noteId}/collab-ticket`)).data.ticket; } catch {
      this.connecting = false;
      if (!this.destroyed) { setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 2, 30_000); }
      return;
    }
    this.connecting = false;
    if (this.destroyed || this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/collab?note=${encodeURIComponent(this.noteId)}&ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = e => this.onMessage(e.data);
    ws.onclose = () => {
      this.ws = null;
      this.status.connected = false; this.status.synced = false;
      awarenessProtocol.removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.ydoc.clientID), 'remote');
      this.emit();
      if (!this.destroyed) { setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 2, 30_000); }
    };
    ws.onerror = () => {};
  }

  send(type, write) {
    if (!this.ws || this.ws.readyState !== 1 || !this.status.connected) return false;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, type);
    write(enc);
    this.ws.send(encoding.toUint8Array(enc));
    return true;
  }
  sendSync(write) { return this.send(MSG_SYNC, write); }
  control(obj) { return this.send(MSG_CONTROL, enc => encoding.writeVarString(enc, JSON.stringify(obj))); }

  async onMessage(data) {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    if (type === MSG_CONTROL) {
      const msg = JSON.parse(decoding.readVarString(dec));
      if (msg.type === 'hello') {
        await this.whenLocal;
        const known = localStorage.getItem(genKey(this.userId, this.noteId));
        if (known && Number(known) !== msg.gen && this.status.local) { await this.forget(msg.gen); return; }
        try { localStorage.setItem(genKey(this.userId, this.noteId), String(msg.gen)); } catch { /* ignore */ }
        this.retry = 1000;
        this.status.connected = true; this.status.role = msg.role; this.emit();
        this.sendSync(enc => syncProtocol.writeSyncStep1(enc, this.ydoc));
        this.send(MSG_AWARENESS, enc => encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.ydoc.clientID])));
      } else if (msg.type === 'seed' || msg.type === 'external') {
        this.dispatch(msg);
      } else if (msg.type === 'reset') {
        await this.forget(msg.gen);
      }
      return;
    }
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      const sub = syncProtocol.readSyncMessage(dec, enc, this.ydoc, this);
      if (encoding.length(enc) > 1) this.ws?.send(encoding.toUint8Array(enc));
      if (sub === syncProtocol.messageYjsSyncStep2 && !this.status.synced) {
        this.status.synced = true; this.emit();
        if (this.pendingHtml) { const p = this.pendingHtml; this.pendingHtml = null; this.saveHtml(p.html, p.md); }
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), 'remote');
    }
  }

  dispatch(msg) {
    const h = this.handlers[msg.type];
    if (h) h(msg); else this.queued.push(msg);
  }
  /** The editor is ready to handle seed / external messages. */
  setHandlers(handlers) {
    this.handlers = handlers;
    const q = this.queued; this.queued = [];
    q.forEach(m => this.dispatch(m));
  }

  /** Save the note's current text (rich_content / content) on the server — now if connected, else on reconnect. */
  saveHtml(html, md) {
    if (this.status.role === 'view') return;
    if (!(this.status.synced && this.control({ type: 'html', html, md }))) this.pendingHtml = { html, md };
  }

  /** The server threw its copy away: forget this device's copy too, and start again. */
  async forget(gen) {
    try { localStorage.setItem(genKey(this.userId, this.noteId), String(gen)); } catch { /* ignore */ }
    this.status.reset = true;
    this.emit(); // the editor remounts with a fresh session
  }

  async clearLocal() {
    try { await this.persistence.clearData(); } catch { /* ignore */ }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.ydoc.off('update', this.onUpdate);
    this.awareness.off('update', this.onAwareness);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.ydoc.clientID], 'local');
    try { this.ws?.close(); } catch { /* ignore */ }
    this.persistence.destroy();
    this.ydoc.destroy();
  }
}
