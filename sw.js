/**
 * HAPPA TRADEMART — Service Worker
 * Strategy: Stale-while-revalidate for static assets (instant + always fresh),
 *            Network-first for API calls,
 *            Offline fallback page for navigation requests.
 */

// Bump this on EVERY deploy that changes a precached asset. It must always
// match SW_VERSION in index.html — test/sw-version.test.js fails the build if
// the two drift, because a stale SW_VERSION silently disables the one-time
// cache self-heal and leaves returning clients running old JS.
const CACHE_NAME      = 'happa-v165';
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
  // Icon font — precached on purpose. It used to be a jsDelivr CDN request that
  // was only cached opportunistically, so any cache wipe (see the self-heal in
  // index.html) left every icon dependent on a live third-party fetch. With no
  // local copy to fall back on, a failed fetch meant a blank icon set app-wide.
  './css/vendor/fontawesome.min.css',
  './css/webfonts/fa-solid-900.woff2',
  './css/webfonts/fa-regular-400.woff2',
  './css/webfonts/fa-brands-400.woff2',
  './js/chart.min.js',
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

  './js/utils.js',
  './js/upload.js',
  './js/search.js',
  './js/notifications.js',
  './js/wallet.js',
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

  // ── Storefront / store / store-admin URLs → Never intercept ──
  // These pages must always open in the real browser, not inside the PWA.
  const storefrontPaths = ['/storefront/', '/store/', '/store-admin/'];
  const isStorefrontNav = storefrontPaths.some(p => url.pathname.startsWith(p));
  // Also detect hash-based storefront routes served through index.html
  const isStorefrontHash =
    url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname === '';
  if (isStorefrontNav && request.mode === 'navigate') {
    // Let the browser handle it natively — don't touch the request
    return;
  }

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

  // ── Everything else → Stale-while-revalidate ──────────────
  // Same-origin assets: serve instantly from cache, but refresh in
  // the background so new deploys (CSS/JS fixes) reach users without
  // a manual cache bump. CDN assets (fonts/icons) are immutable, so
  // keep them true cache-first — no pointless background refetches.
  event.respondWith(
    caches.match(request).then(cached => {
      const isSameOrigin = url.origin === self.location.origin;

      // Cross-origin assets → cache-first, network fallback
      if (!isSameOrigin) {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
          }
          return response;
        // A real network error, NOT an empty 408. Returning `new Response('', {status:408})`
        // handed the browser a blank stylesheet/script that looked like a success,
        // so a failed CDN fetch silently wiped out the app's icons with no error
        // in the console. `Response.error()` surfaces it honestly instead.
        }).catch(() => Response.error());
      }

      // Same-origin assets → stale-while-revalidate
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => cached || new Response('', { status: 408 }));

      // Serve cached copy instantly if present; otherwise wait for network
      return cached || networkFetch;
    })
  );
});

// ── Background sync: retry failed API writes when back online ─
self.addEventListener('sync', event => {
  if (event.tag === 'retry-api') {
    console.log('[SW] Background sync triggered');
  }
});

// ── Push notifications ────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload = { title: 'HAPPA TRADEMART', body: 'You have a new notification' };
  try {
    payload = event.data.json();
  } catch (e) {
    try { payload.body = event.data.text() || payload.body; } catch(err) {}
  }
  const options = {
    body:  payload.body  || '',
    icon:  './images/icon-192.png',
    badge: './images/icon-192.png',
    vibrate: [100, 50, 100],
    data:  { url: payload.url || './' },
    tag:   payload.tag || 'happa-notif',
    renotify: true
  };
  // Show the OS notification (works with the tab closed)…
  const showPromise = self.registration.showNotification(payload.title || 'HAPPA TRADEMART', options);

  // …and immediately tell any open app pages to refresh their notification
  // data so in-app lists update instantly instead of waiting for the next
  // 20-second poll.
  const notifyPages = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => {
      clients.forEach(client => {
        try {
          client.postMessage({ type: 'PUSH_RECEIVED', title: payload.title || '', body: payload.body || '', url: payload.url || '' });
        } catch (e) {}
      });
    })
    .catch(() => {});

  event.waitUntil(Promise.all([showPromise, notifyPages]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || './';
  const targetUrl = new URL(rawUrl, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window if open, otherwise open new one
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if (rawUrl && rawUrl !== './') client.navigate(targetUrl);
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
