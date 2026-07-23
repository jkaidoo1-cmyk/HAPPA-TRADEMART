/**
 * HAPPA TRADEMART — Service Worker
 * Strategy: Cache-first for static assets, Network-first for API calls,
 *            Offline fallback page for navigation requests.
 */

const CACHE_NAME      = 'happa-v21';
const OFFLINE_URL     = 'offline.html';

// Core static assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './vercel.json',
  './images/photo_2026-05-30_17-40-49-Photoroom.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './css/style.css',
  './js/optimistic_ui.js',
  './js/app.js',
  './js/auth.js',
  './js/marketplace.js',
  './js/cart.js',
  './js/checkout.js',
  './js/orders.js',
  './js/vendor.js',
  './js/buyer.js',
  './js/admin.js',
  './js/admin-profiles.js',
  './js/admin-settings.js',
  './js/local_autofill.js',
  './js/utils.js',
  './js/search.js',
  './js/notifications.js',
  './js/wallet.js',
  './js/delivery.js',
  './js/ads.js',
  './js/rendor.js'
];

// ── Install: pre-cache all core assets ───────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching assets…');
      // addAll fails silently on individual errors by using add per item
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ── API calls (tables/) → Network-first, no cache ─────────
  if (url.pathname.includes('/tables/') || url.pathname.includes('api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline', data: [], total: 0 }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // ── Navigation requests → Network-first, offline fallback ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache fresh navigation response
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  // ── Everything else → Cache-first, network fallback ────────
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache successful same-origin or CDN responses
        if (
          response.ok &&
          (url.origin === self.location.origin ||
            url.hostname.includes('jsdelivr') ||
            url.hostname.includes('googleapis') ||
            url.hostname.includes('fontawesome') ||
            url.hostname.includes('gstatic'))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached || new Response('', { status: 408 }));
    })
  );
});

// ── Background sync: retry failed API writes when back online ─
self.addEventListener('sync', event => {
  if (event.tag === 'retry-api') {
    console.log('[SW] Background sync triggered');
  }
});

// ── Push notifications (future-ready) ────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({ title: 'HAPPA', body: 'You have a new notification' }));
  event.waitUntil(
    data.then(d =>
      self.registration.showNotification(d.title || 'HAPPA TRADEMART', {
        body:  d.body  || '',
        icon:  '/images/icon-192.png',
        badge: '/images/icon-192.png',
        data:  { url: d.url || '/' }
      })
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
