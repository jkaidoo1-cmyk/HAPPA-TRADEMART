'use strict';
// What the page is allowed to fetch, and from where.
//
// The performance pass moved four things out of the critical path, and each one
// is the kind of change that silently comes back (a pasted snippet, a reverted
// deploy, a "quick fix" to a broken logo):
//
//   1. Fonts. Inter and Outfit came from fonts.googleapis.com + fonts.gstatic.com
//      — two render-blocking third-party stylesheets and a second origin for the
//      files themselves, with no offline story for the installed app. They are
//      now one variable woff2 per subset, served from our own origin.
//   2. Placeholders. Every record without a picture pointed at placehold.co.
//      On the home page the largest one *was* the LCP element and took 4.4 s to
//      arrive over a throttled connection. It is an inline data-URI SVG now.
//   3. Images. The brand logo was a 234 KB RGBA PNG (shown at 40-128 px) and the
//      icons were 201 KB + 41 KB. The logo is WebP; the icons are re-encoded.
//   4. Loading order. The first cards of a list are the LCP candidates, so they
//      load eagerly; everything below the fold stays lazy.
//
// Measured before/after (Lighthouse, mobile, throttled): performance 37 → 53,
// LCP 15.4 s → 13.2 s, TBT 820 ms → 100 ms, unused JS 1325 KiB → 546 KiB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const indexHtml = read('index.html');
const styleCss = read('css/style.css');
const appJs = read('js/app.js');
const utilsJs = read('js/utils.js');
const sw = read('sw.js');
const vercel = JSON.parse(read('vercel.json'));

// Every file that renders markup a shopper can see.
const FRONT_END = ['index.html', 'offline.html']
  .concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));

// Explanations of *why* the fonts moved are worth keeping, so comments are
// stripped before a file is searched for a host: only real requests count.
const withoutComments = src => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('fonts are self-hosted, not fetched from a third party', () => {
  // The app shell must not depend on a font CDN at all.
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    for (const file of ['index.html', 'offline.html', 'css/style.css']) {
      assert.ok(
        !withoutComments(read(file)).includes(host),
        `${file} loads from ${host} again — that is a render-blocking third-party request`
      );
    }
  }

  // One deliberate exception survives: a storefront whose owner picked a custom
  // brand font loads that single family from Google, on demand, on that store's
  // page only (js/marketplace.js). That is the store's font, not the app's, and
  // it must stay the only place a Google font is requested.
  for (const file of FRONT_END.filter(f => f.startsWith('js/'))) {
    read(file).split('\n').forEach((line, i) => {
      if (!/fonts\.(googleapis|gstatic)\.com/.test(line)) return;
      assert.ok(
        line.includes('font_family') || /^\s*(\/\/|\*)/.test(line),
        `${file}:${i + 1} requests a font from Google outside the per-store custom-font loader`
      );
    });
  }

  // The preconnect hints only existed for Google Fonts; a leftover preconnect
  // to an origin we no longer use wastes a DNS lookup + TLS handshake.
  assert.ok(
    !/rel="preconnect"[^>]*fonts\./.test(indexHtml),
    'index.html still preconnects to a font CDN it no longer loads from'
  );

  // Both families, both subsets, actually on disk.
  for (const file of ['inter-latin', 'inter-latin-ext', 'outfit-latin', 'outfit-latin-ext']) {
    assert.ok(
      styleCss.includes(`/css/webfonts/${file}.woff2`),
      `css/style.css has no @font-face for ${file}.woff2`
    );
    assert.ok(exists(`css/webfonts/${file}.woff2`), `css/webfonts/${file}.woff2 is missing from disk`);
  }

  // font-display: swap keeps text visible while the file arrives — without it a
  // slow font makes the whole page blank, which is worse than a font swap.
  const faces = styleCss.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 4, 'expected exactly four @font-face blocks (two families × two subsets)');
  for (const face of faces) {
    assert.match(face, /font-display:\s*swap/, 'every @font-face needs font-display: swap');
    assert.match(face, /unicode-range:/, 'unicode-range is what keeps latin-ext from being downloaded needlessly');
  }

  // The latin subset is the one every page needs, so it is worth a preload.
  assert.match(
    indexHtml,
    /rel="preload"[^>]*inter-latin\.woff2[^>]*crossorigin/,
    'the latin font must be preloaded (fonts are discovered late otherwise)'
  );

  // The installed app must be able to paint in its own typeface offline.
  const precache = sw.slice(sw.indexOf('PRECACHE_ASSETS'), sw.indexOf('// ── Install'));
  for (const file of ['inter-latin', 'outfit-latin']) {
    assert.ok(
      precache.includes(`./css/webfonts/${file}.woff2`),
      `${file}.woff2 must be precached, or the installed app falls back to Segoe UI offline`
    );
  }
});

test('no image placeholder is fetched from a third party', () => {
  for (const file of FRONT_END) {
    assert.ok(
      !read(file).includes('placehold.co/'),
      `${file} points an image at placehold.co again — that is a network request per card`
    );
  }

  // The replacement is a data URI, and the CSP has to allow it.
  assert.match(utilsJs, /const PLACEHOLDER_IMG = 'data:image\/svg\+xml;base64,/, 'PLACEHOLDER_IMG is missing from js/utils.js');
  assert.match(utilsJs, /const PLACEHOLDER_BANNER = 'data:image\/svg\+xml;base64,/, 'PLACEHOLDER_BANNER is missing from js/utils.js');
  assert.match(utilsJs, /window\.PLACEHOLDER_IMG = PLACEHOLDER_IMG;/, 'PLACEHOLDER_IMG must be reachable from inline handlers');

  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /img-src[^;]*data:/, 'the CSP must allow data: images, or every placeholder is blocked in production');
});

test('the brand image and the PWA icons shipped in a modern, smaller form', () => {
  assert.ok(exists('images/happa-logo.webp'), 'images/happa-logo.webp is missing');
  assert.ok(
    !exists('images/photo_2026-05-30_17-40-49-Photoroom.png'),
    'the 234 KB PNG logo is back — every reference should point at the WebP'
  );
  assert.ok(
    fs.statSync(path.join(ROOT, 'images/happa-logo.webp')).size < 60 * 1024,
    'the WebP logo grew past 60 KB; re-encode it rather than shipping a large file'
  );

  for (const file of ['index.html', 'offline.html', 'js/auth.js', 'js/marketplace.js', 'js/vendor.js', 'sw.js']) {
    const src = read(file);
    assert.ok(src.includes('happa-logo.webp'), `${file} does not reference the WebP logo`);
    assert.ok(
      !/photo_2026-05-30_17-40-49-Photoroom/.test(src),
      `${file} still references the retired PNG logo`
    );
  }

  // Icons stay PNG for manifest compatibility, but they must stay small.
  for (const [file, budget] of [
    ['images/icon-192.png', 12 * 1024],
    ['images/icon-512.png', 40 * 1024],
    // Maskable variants: full square of white with the bag art inside the
    // safe-zone circle — flat colour fills compress worse than transparency.
    ['images/icon-maskable-192.png', 12 * 1024],
    ['images/icon-maskable-512.png', 60 * 1024],
  ]) {
    assert.ok(exists(file), `${file} is missing`);
    assert.ok(fs.statSync(path.join(ROOT, file)).size < budget, `${file} is over its ${Math.round(budget / 1024)} KB budget`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(
    manifest.icons.map(i => i.src).sort(),
    [
      'images/icon-192.png',
      'images/icon-512.png',
      'images/icon-maskable-192.png',
      'images/icon-maskable-512.png',
    ],
    'the manifest icon list changed — update this test and re-check the install icons'
  );
  // Purpose split, not "any maskable" on one file: Android scales a maskable
  // icon to fill its shape, so full-bleed art with no safe zone came out huge
  // and cropped on the launcher and the Android 12 launch splash.
  const bySrc = Object.fromEntries(manifest.icons.map(i => [i.src, i]));
  for (const src of ['images/icon-maskable-192.png', 'images/icon-maskable-512.png']) {
    assert.equal(bySrc[src].purpose, 'maskable', `${src} must declare only the maskable purpose`);
  }
  for (const src of ['images/icon-192.png', 'images/icon-512.png']) {
    assert.equal(bySrc[src].purpose, 'any', `${src} must declare only the any purpose`);
  }
  assert.equal(
    manifest.icon_background_color,
    '#ffffff',
    'icon_background_color must stay white so the launch splash does not paint a dark backing behind the logo'
  );
});

test('the maskable icons keep the bag big enough to read, small enough to survive the launcher mask', () => {
  // Two ways this has gone wrong already, in opposite directions:
  //   * the full-bleed art declared as maskable → Android scaled it to fill its
  //     shape and cropped it into a giant, clipped logo;
  //   * the first padded pass → the bag became a small stamp on the launcher
  //     and on the Android 12 launch splash.
  // The safe-zone geometry is what keeps both from coming back, so it is
  // measured from the pixels instead of trusted to the build script.
  const { decode } = require(path.join('..', 'tools', 'png.js'));

  for (const [file, size] of [
    ['images/icon-maskable-192.png', 192],
    ['images/icon-maskable-512.png', 512],
  ]) {
    const { width, height, data } = decode(fs.readFileSync(path.join(ROOT, file)));
    assert.equal(width, size, `${file} is not ${size}px wide`);
    assert.equal(height, size, `${file} is not ${size}px tall`);

    // A maskable icon has to paint every pixel: the OS composites whatever the
    // launcher mask leaves uncovered, and a transparent corner shows through as
    // the platform background.
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const [r, g, b, a] = [data[o], data[o + 1], data[o + 2], data[o + 3]];
        assert.equal(a, 255, `${file} has a transparent pixel at ${x},${y}`);
        if (r > 250 && g > 250 && b > 250) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    assert.ok(maxX > -1, `${file} has no artwork at all`);

    const artWidth = maxX - minX + 1;
    const artHeight = maxY - minY + 1;
    const fraction = artWidth / width;

    // ~39.5% of the canvas. The lower bound is the "too small" regression the
    // 1.2× bump fixed; the upper bound keeps it clear of the crop.
    assert.ok(
      fraction > 0.36 && fraction < 0.45,
      `${file}: the artwork is ${(fraction * 100).toFixed(1)}% of the canvas — ` +
      'it should sit around 39-40%, not shrink to a stamp or grow into the crop'
    );

    // Centred, so the launcher mask trims evenly on every side.
    assert.ok(
      Math.abs((minX + maxX) / 2 - width / 2) <= 2 && Math.abs((minY + maxY) / 2 - height / 2) <= 2,
      `${file}: the artwork is off-centre (${(minX + maxX) / 2}, ${(minY + maxY) / 2})`
    );

    // The guarantee that actually matters: every corner of the artwork is
    // inside the 80%-diameter circle Android treats as the safe zone.
    const safeRadius = size * 0.4;
    const corner = Math.hypot(artWidth / 2, artHeight / 2);
    assert.ok(
      corner < safeRadius,
      `${file}: the artwork corner (${corner.toFixed(1)}px) falls outside the ` +
      `${safeRadius.toFixed(1)}px maskable safe zone — a round launcher would clip it`
    );
  }
});

test('the first cards of a list load eagerly and the rest stay lazy', () => {
  // A lazy LCP image is the mistake this pins: Lighthouse found the largest
  // paint was an image the browser had been told to defer.
  const fn = appJs.slice(appJs.indexOf('function _pcSlideshowHTML'), appJs.indexOf('function productCardHTML'));
  assert.match(fn, /opts && opts\.eager/, '_pcSlideshowHTML must accept an eager option');
  assert.match(fn, /loading="eager" fetchpriority="high"/, 'eager cards must also be marked high priority');
  assert.match(fn, /loading="lazy"/, 'below-the-fold cards must still be lazy');

  for (const [label, needle] of [
    ['the Near You list', 'items.map((p, i) => productCardSmall(p, { eager: i < 3 }))'],
    ['the trending list', 'items.map((p, i) => productCardHTML(p, { eager: i < 3 }))']
  ]) {
    assert.ok(appJs.includes(needle), `${label} no longer marks its first cards eager`);
  }
  assert.match(read('js/marketplace.js'), /renderItemsProgressively\(grid, items, \(p, i\) => productCardHTML\(p, \{ eager: i < 3 \}\)/,
    'the marketplace grid must pass the card index so its first row is eager');

  // And they all carry the attributes that keep decoding off the main thread.
  assert.match(fn, /decoding="async"/, 'product images should decode off the main thread');
  assert.match(fn, /onerror="this\.src=window\.PLACEHOLDER_IMG"/,
    'the fallback handler must reference the global — a bare identifier inside an attribute never interpolates');
});

test('static assets are cacheable, and the HTML that versions them is not', () => {
  const find = src => vercel.routes.find(r => r.src === src);
  for (const route of ['/css/(.*)', '/js/(.*)']) {
    const cc = find(route).headers['Cache-Control'];
    assert.match(cc, /max-age=\d+/, `${route} must be cacheable — every load revalidating it is a round trip per file`);
    assert.match(cc, /stale-while-revalidate/, `${route} should serve stale-while-revalidate so repeat views are instant`);
  }

  // index.html carries SW_VERSION, so it must never be served from cache.
  for (const route of ['/storefront/(.*)', '/store-front-not-a-route', '/(.*)']) {
    const r = find(route);
    if (!r) continue;
    assert.match(r.headers['Cache-Control'], /max-age=0|no-cache|no-store/,
      `${route} must revalidate, or a deploy can leave a client on the old shell`);
  }

  // Images are immutable by content; the service worker is not.
  assert.equal(find('/images/(.*)').headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.match(find('/sw.js').headers['Cache-Control'], /no-store/, 'the service worker must never be cached');
});
