const CACHE_NAME = 'bin-calendar-v6';
const WORKER_URL = 'https://bin-collection-push.timbo-hoare.workers.dev';
const VAPID_PUBLIC_KEY = 'BPK7tkq2TNezvOTnhvBl3YSerg4hjG03EZ_lGWmrvQ9MFv0o4mTk4ZGAY_mVL1I5hve4ZNoMsXoO4vhlNTJuiKk';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const clone = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Bin Day', {
      body: data.body || 'Check your bin collection schedule',
      icon: data.icon || './icon-192.png',
      badge: './icon-192.png',
      data: { url: data.url || './' },
    })
  );
});

// The push service can rotate a subscription (browser/Play Services updates,
// cache clears). The browser fires this event; without it the worker keeps the
// dead endpoint, which FCM accepts (201) but never delivers. Re-subscribe and
// re-register the fresh endpoint, and clean up the old one.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      if (e.oldSubscription?.endpoint) {
        await fetch(`${WORKER_URL}/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: e.oldSubscription.endpoint }),
        });
      }
      const sub = e.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY,
      });
      await fetch(`${WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (err) {
      console.error('pushsubscriptionchange re-subscribe failed:', err);
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('/bin-collection/') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
