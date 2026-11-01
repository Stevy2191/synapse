// Chat notifications. Loaded into the app's service worker (see vite.config.js → importScripts).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Synapse';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,      // one notification per chat, updated as messages arrive
    renotify: !!data.tag,
    data: { url: data.url || '/', chatId: data.chatId || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, chatId } = event.notification.data || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      if (chatId) win.postMessage({ type: 'open-chat', chatId });
      return;
    }
    await self.clients.openWindow(url || '/');
  })());
});
