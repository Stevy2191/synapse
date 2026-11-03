// Local copy of the user's data in IndexedDB, so Synapse works without a connection.
//
// Stores:
//   workspaces  — the user's workspaces
//   notes       — full notes. `server_version` is the server version this copy is based on
//                 (null for notes created offline that haven't been uploaded yet).
//   outbox      — changes waiting to be sent to the server, in order.
//   calendar    — calendar events by month ("2026-11"), for offline viewing.
//   recordings  — meeting recordings not uploaded yet (survive a crash / being offline)
//   ocr         — text read from pictures in notes (picture hash → text), so search finds it offline.
//   pdfs        — PDF files shown in PDF blocks: kept so they open offline, and ones added offline
//                 until they're uploaded ({ id, blob, name, noteId, pending, size, usedAt }).
import { openDB } from 'idb';

let dbPromise = null;
let currentUserId = null;

export function openUserDb(userId) {
  if (currentUserId === userId && dbPromise) return dbPromise;
  currentUserId = userId;
  // One database per user so people sharing a browser never see each other's notes.
  dbPromise = openDB(`synapse-${userId}`, 5, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('workspaces', { keyPath: 'id' });
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('workspace_id', 'workspace_id');
        db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      }
      // v2: calendar events, cached per month so the calendar works offline
      if (oldVersion < 2) db.createObjectStore('calendar');
      // v3: words read from pictures (OCR), keyed by picture hash
      if (oldVersion < 3) db.createObjectStore('ocr');
      // v4: meeting recordings not uploaded yet (kept while recording, and if the upload failed)
      if (oldVersion < 4) db.createObjectStore('recordings', { keyPath: 'localId' });
      // v5: PDF files of PDF blocks (offline copies + not uploaded yet)
      if (oldVersion < 5) db.createObjectStore('pdfs', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export function db() {
  if (!dbPromise) throw new Error('Offline database not opened');
  return dbPromise;
}

export async function deleteUserDb(userId) {
  if (currentUserId === userId && dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
    currentUserId = null;
  }
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(`synapse-${userId}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
