/**
 * EDX Digital - Service Worker
 * Keeps the app's own files available offline.
 *
 * Two rules keep a page and its code from ever being of different versions:
 *   - pages always come from the network, revalidated, and from the cache only when offline;
 *   - a file is taken from the cache only under its exact address, version included.
 */

const CACHE_NAME = 'edx-digital-v3.13.1';
// The build replaces this list with the exact files of the published version
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/landing.html',
  '/termos.html',
  '/privacidade.html',
  '/manifest.json',
  '/assets/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(STATIC_ASSETS.map((url) =>
        // "reload" skips the browser's own cache, so what is stored is what was just published
        fetch(url, { cache: 'reload' }).then((response) => (response.ok ? cache.put(url, response) : null)).catch(() => null)
      ));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function store(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // On the developer's own machine files change all the time: nothing is served from the cache
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Only this app's own files are handled here. Everything else (the database, sign-in,
  // the AI service, fonts) goes straight to the network.
  if (url.origin !== self.location.origin) return;
  // The API is never served from cache
  if (url.pathname.startsWith('/api/')) return;

  // Pages: always the published one; the stored copy is only for when there is no connection
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await store(event.request, await fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }));
      } catch {
        const isLanding = url.pathname.includes('landing');
        return (await caches.match(event.request, { ignoreSearch: true }))
          || (await caches.match(isLanding ? '/landing.html' : '/index.html'))
          || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Files: the exact address from the cache (it carries the version), otherwise the network.
  // Offline, an older copy of the same file is better than nothing.
  event.respondWith((async () => {
    const exact = await caches.match(event.request);
    if (exact) return exact;
    try {
      return await store(event.request, await fetch(event.request));
    } catch {
      return (await caches.match(event.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});

// A click on a notification brings the CRM to the front, on the screen it points to
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const view = (event.notification.data && event.notification.data.view) || '';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin && !new URL(client.url).pathname.includes('landing'));
    if (open) {
      await open.focus();
      open.postMessage({ type: 'OPEN_VIEW', view });
      return;
    }
    await self.clients.openWindow('/' + (view ? '#' + view : ''));
  })());
});
