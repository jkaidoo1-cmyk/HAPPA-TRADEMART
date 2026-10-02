'use strict';
// Cache-version guards for the PWA shell.
//
// Two versions have to move together, and for a while they did not:
//
//   * `CACHE_NAME` in sw.js is the cache the service worker installs and keeps.
//   * `SW_VERSION` in index.html gates a one-time self-heal that unregisters
//     the worker and deletes *every* cache — but it is stored in localStorage
//     and only runs when the stored value differs.
//
// index.html sat at `happa-v144` while sw.js reached `happa-v159`. Clients that
// had already healed at v144 therefore never healed again, so after a deploy
// they kept running the old cached JS (which is exactly why a product-upload
// fix could be live on the server and still bounce in the vendor's browser).
// Drift between these two strings is silent, so it is asserted here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf-8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');

function pick(src, label, re) {
  const m = src.match(re);
  assert.ok(m, `${label} not found — the pattern it is read with has drifted`);
  return m[1];
}

const cacheName = pick(swSrc, "sw.js CACHE_NAME", /const\s+CACHE_NAME\s*=\s*'([^']+)'/);
const swVersion = pick(indexSrc, 'index.html SW_VERSION', /var\s+SW_VERSION\s*=\s*'([^']+)'/);

test('the PWA cache name and the self-heal version never drift apart', () => {
  assert.equal(
    swVersion,
    cacheName,
    'index.html SW_VERSION must equal sw.js CACHE_NAME — otherwise the one-time ' +
    'self-heal never fires again and returning clients keep the old cached JS'
  );
});

test('the cache name is versioned so a deploy invalidates the previous cache', () => {
  assert.match(cacheName, /^happa-v\d+$/, 'CACHE_NAME should look like happa-v<N>');
});

test('every precached asset exists on disk', () => {
  const listMatch = swSrc.match(/const\s+PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(listMatch, 'PRECACHE_ASSETS list not found in sw.js');

  const assets = [...listMatch[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
  assert.ok(assets.length > 0, 'PRECACHE_ASSETS should not be empty');

  for (const asset of assets) {
    // './' is the app root, which is index.html.
    const rel = asset === '' ? 'index.html' : asset;
    assert.ok(
      fs.existsSync(path.join(ROOT, rel)),
      `sw.js precaches ${rel} but the file does not exist`
    );
  }
});

test('the self-heal runs before the worker is re-registered', () => {
  const healAt = indexSrc.indexOf('sw_selfheal_version');
  const registerAt = indexSrc.indexOf("navigator.serviceWorker.register");
  assert.ok(healAt !== -1, 'the self-heal block is missing from index.html');
  assert.ok(registerAt !== -1, 'the service-worker registration is missing from index.html');
  assert.ok(
    healAt < registerAt,
    'the self-heal must run (and delete caches) before the new worker registers'
  );
});
