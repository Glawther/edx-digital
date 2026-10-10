/**
 * Nexus CRM - Service Worker
 * Keeps the app's own files available offline.
 */

const CACHE_NAME = 'nexus-crm-v3.8.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/landing.html',
  '/landing',
  '/termos.html',
  '/termos',
  '/privacidade.html',
  '/privacidade',
  '/manifest.json',
  '/assets/icon.svg',
  '/css/design-tokens.css',
  '/css/identity.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/animations.css',
  '/js/app.js',
  '/js/core/config.js',
  '/js/core/crm-store.js',
  '/js/core/storage-manager.js',
  '/js/core/theme-manager.js',
  '/js/ui/ui-renderer.js',
  '/js/services/firebase-app.js',
  '/js/services/auth-service.js',
  '/js/services/employee-service.js',
  '/js/services/billing-service.js',
  '/js/services/audit-service.js',
  '/js/services/notification-service.js',
  '/js/services/team-invite-service.js',
  '/js/services/whatsapp-service.js',
  '/js/services/webhook-service.js',
  '/js/services/firebase-service.js',
  '/js/services/gemini-service.js',
  '/js/services/export-service.js'
];

// Install: Cache core application assets safely without failing if one asset 404s
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch((err) => {
          console.warn(`[Nexus PWA] Cache skip for ${url}:`, err.message);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up older cache versions and take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[Nexus PWA] Removendo cache legado: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate for app assets; Network-only for Google Cloud APIs
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Only this app's own files are handled here. Everything else (the database, sign-in,
  // the AI service, fonts) goes straight to the network: intercepting those breaks the
  // database's live connection, and nothing from them was ever cached anyway.
  if (url.origin !== self.location.origin) {
    return;
  }

  // The API is never served from cache
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 1. Special handling for navigation requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const isLanding = url.pathname.includes('landing');
        try {
          // If user requests /landing.html or /landing, target /landing directly
          const targetUrl = isLanding ? new URL('/landing', url.origin).href : event.request.url;
          const networkResponse = await fetch(targetUrl, {
            headers: event.request.headers,
            credentials: event.request.credentials
          });
          if (networkResponse && (networkResponse.ok || networkResponse.status === 304)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone()).catch(() => {});
            return networkResponse;
          }
          if (networkResponse && networkResponse.status >= 300 && networkResponse.status < 400) {
            return networkResponse;
          }
        } catch (err) {
          // Network failed or offline - proceed to offline fallback
        }

        const fallbackTarget = isLanding ? '/landing' : '/index.html';
        const cachedFallback = (await caches.match(event.request, { ignoreSearch: true })) ||
                               (await caches.match(fallbackTarget, { ignoreSearch: true })) ||
                               (await caches.match('/landing.html', { ignoreSearch: true }));

        if (cachedFallback) {
          return cachedFallback;
        }

        return new Response('Offline - Nexus CRM', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // 2. Stale-While-Revalidate for static assets
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone()).catch(() => {});
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline, silent
      });

      return cachedResponse || fetchPromise;
    })
  );
});
