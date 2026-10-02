'use strict';
// Storefront links must identify the store, not the marketplace.
//
// A storefront is served by the same shell as the main site, so /storefront/keplas-hub
// used to answer with the marketplace's own <title> and description: pasting the
// link into WhatsApp produced a card reading "HAPPA TRADEMART — Ghana's Premier
// Multi-Vendor Marketplace", i.e. it looked like a link to the main site. A link
// preview is built by fetching the HTML — nothing the browser does afterwards
// can change it — so the server now answers those paths with the store's own
// metadata, and the URLs we hand to vendors are path URLs (a '#fragment' never
// reaches the server at all).
//
// Asserted here: the metadata builder, the injection (including escaping, since
// store names are vendor input), and the wiring that keeps it reachable —
// routing, the vendored link, and the markers the injection needs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const shell = require('../lib/storefront-shell');

const ORIGIN = 'https://happa-trademart-dwxh.vercel.app';
const STOREFRONT = {
  name: "KEPLA'S HUB",
  slogan: 'Welcome to our store!',
  about_us: '',
  meta_description: '',
  location: 'Takoradi',
  logo_url: 'data:image/jpeg;base64,AAAA',
  banner_url: '',
};
const STORE = { name: "KEPLA'S HUB", category: 'Fashion & Footwear', location: 'Takoradi', slug: 'keplas-hub' };

test('a storefront page describes the store, not the marketplace', () => {
  // No vendor-written description at all: the built sentence has to name the
  // store and where it is, never the marketplace's own blurb.
  const bare = { name: "KEPLA'S HUB", logo_url: 'data:image/jpeg;base64,AAAA' };
  const meta = shell.storefrontShareMeta({ storefront: bare, store: STORE, slug: 'keplas-hub', origin: ORIGIN });

  assert.equal(meta.title, "KEPLA'S HUB — HAPPA TRADEMART");
  assert.match(meta.description, /KEPLA'S HUB/);
  assert.match(meta.description, /Takoradi/);
  assert.ok(!/Premier Multi-Vendor Marketplace/.test(meta.description), 'the marketplace blurb must not be the store description');
  assert.equal(meta.canonical, `${ORIGIN}/storefront/keplas-hub`);

  // A slogan the vendor did write is theirs to use.
  const withSlogan = shell.storefrontShareMeta({ storefront: STOREFRONT, store: STORE, slug: 'keplas-hub', origin: ORIGIN });
  assert.equal(withSlogan.description, 'Welcome to our store!');
});

test("the vendor's own description wins, and missing ones fall back to a store sentence", () => {
  const own = shell.storefrontShareMeta({
    storefront: { ...STOREFRONT, meta_description: 'Sneakers, slides and streetwear in Takoradi.' },
    store: STORE, slug: 'keplas-hub', origin: ORIGIN,
  });
  assert.equal(own.description, 'Sneakers, slides and streetwear in Takoradi.');

  const about = shell.storefrontShareMeta({
    storefront: { ...STOREFRONT, about_us: 'We sell the freshest kicks.' },
    store: STORE, slug: 'keplas-hub', origin: ORIGIN,
  });
  assert.equal(about.description, 'We sell the freshest kicks.');

  const none = shell.storefrontShareMeta({ storefront: { name: 'Bare Store' }, store: {}, slug: 'bare-store', origin: ORIGIN });
  assert.equal(none.title, 'Bare Store — HAPPA TRADEMART');
  assert.match(none.description, /Shop this store on HAPPA/);
});

test('a data-URI logo cannot be a preview image, so the platform image is used', () => {
  // Logos and banners are stored as base64 data URIs; a crawler cannot fetch
  // those, and putting one in og:image breaks the card silently.
  const meta = shell.storefrontShareMeta({ storefront: STOREFRONT, store: STORE, slug: 'keplas-hub', origin: ORIGIN });
  assert.equal(meta.image, `${ORIGIN}${shell.DEFAULT_IMAGE}`);

  const http = shell.storefrontShareMeta({
    storefront: { ...STOREFRONT, banner_url: 'https://cdn.example.com/banner.jpg' },
    store: STORE, slug: 'keplas-hub', origin: ORIGIN,
  });
  assert.equal(http.image, 'https://cdn.example.com/banner.jpg');

  const relative = shell.storefrontShareMeta({
    storefront: { ...STOREFRONT, logo_url: '/images/logo.png' },
    store: STORE, slug: 'keplas-hub', origin: ORIGIN,
  });
  assert.equal(relative.image, `${ORIGIN}/images/logo.png`);
});

test('injected metadata replaces the marketplace tags inside the markers only', () => {
  const html = read('index.html');
  assert.ok(html.includes(shell.MARK_OPEN), 'index.html lost the page-meta markers');
  assert.ok(html.includes(shell.MARK_CLOSE), 'index.html lost the closing page-meta marker');

  const meta = shell.storefrontShareMeta({ storefront: STOREFRONT, store: STORE, slug: 'keplas-hub', origin: ORIGIN });
  const out = shell.injectStorefrontMeta(html, meta);

  assert.match(out, /<title>KEPLA&#39;S HUB — HAPPA TRADEMART<\/title>/);
  assert.match(out, /property="og:title" content="KEPLA&#39;S HUB — HAPPA TRADEMART"/);
  assert.match(out, /property="og:url" content="https:\/\/happa-trademart-dwxh\.vercel\.app\/storefront\/keplas-hub"/);
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.ok(!/HAPPA TRADEMART – Ghana's Premier Multi-Vendor Marketplace/.test(out), 'the marketplace description survived');

  // Exactly one title, and the app itself untouched: the SPA still has to boot.
  assert.equal(out.match(/<title>/g).length, 1);
  for (const asset of ['/js/app.js', '/css/style.css', 'id="page-storefront"']) {
    assert.ok(out.includes(asset), `injection dropped ${asset} from the shell`);
  }
  assert.equal(out.length > html.length, true, 'the injected block should add tags');
});

test('a vendor-controlled store name cannot inject markup', () => {
  const meta = shell.storefrontShareMeta({
    storefront: { name: '"><script>alert(1)</script>', slogan: '</title><img src=x onerror=alert(1)>' },
    store: {}, slug: 'evil', origin: ORIGIN,
  });
  const out = shell.injectStorefrontMeta(read('index.html'), meta);
  assert.ok(!out.includes('<script>alert(1)</script>'), 'a store name broke out into markup');
  assert.ok(!out.includes('<img src=x'), 'a slogan broke out into an attribute');
  assert.ok(out.includes('&lt;script&gt;'), 'the name should be escaped, not dropped');
  // The escaped payload may only ever appear as text inside a value, never as a
  // tag or an attribute boundary. (Only the injected block is inspected — the
  // shell legitimately ships onerror fallbacks on its own images.)
  const block = out.slice(out.indexOf(shell.MARK_OPEN), out.indexOf(shell.MARK_CLOSE));
  assert.ok(block.length > 0, 'could not isolate the injected metadata block');
  assert.ok(!/<img/i.test(block), 'the slogan opened a real <img> tag');
  assert.ok(!/<script/i.test(block), 'the name opened a real <script> tag');
});

test('store-admin pages are served the store metadata but marked noindex', () => {
  const meta = shell.storefrontShareMeta({ storefront: STOREFRONT, store: STORE, slug: 'keplas-hub', origin: ORIGIN, kind: 'store-admin' });
  assert.equal(meta.title, "KEPLA'S HUB — Store Admin");
  assert.equal(meta.canonical, `${ORIGIN}/store-admin/keplas-hub`);
  assert.equal(meta.robots, 'noindex, nofollow');
  assert.match(shell.injectStorefrontMeta(read('index.html'), meta), /<meta name="robots" content="noindex, nofollow">/);
});

test('the slug is read out of both paths, decoded', () => {
  assert.equal(shell.slugFromPath('/storefront/keplas-hub'), 'keplas-hub');
  assert.equal(shell.slugFromPath('/store-admin/keplas-hub'), 'keplas-hub');
  assert.equal(shell.slugFromPath('/storefront/KEPLA%27S-HUB'), "KEPLA'S-HUB");
  assert.equal(shell.slugFromPath('/storefront/'), '');
  assert.equal(shell.slugFromPath('/product/abc'), '');
});

test('every storefront path reaches a handler that injects the metadata', () => {
  // Vercel must send the storefront paths to the function, not straight to the
  // static shell — otherwise the store never appears in a link preview.
  const vercel = JSON.parse(read('vercel.json'));
  const storefrontRoute = vercel.routes.find(r => r.src === '/storefront/(.*)');
  const adminRoute = vercel.routes.find(r => r.src === '/store-admin/(.*)');
  assert.ok(storefrontRoute, '/storefront/(.*) is not routed');
  assert.equal(storefrontRoute.dest, '/api/index.js');
  assert.ok(adminRoute, '/store-admin/(.*) is not routed');
  assert.equal(adminRoute.dest, '/api/index.js');

  // ...and both servers must answer those paths.
  for (const file of ['api/index.js', 'server.js']) {
    const src = read(file);
    assert.match(src, /app\.get\('\/storefront\/:slug'/, `${file} does not serve /storefront/:slug`);
    assert.match(src, /app\.get\('\/store-admin\/:slug'/, `${file} does not serve /store-admin/:slug`);
    assert.match(src, /injectStorefrontMeta\(/, `${file} does not inject the store metadata`);
  }

  // The storefront HTML is public: a stale token in the browser must not turn a
  // shared link into a JSON 401.
  assert.match(
    read('api/index.js'),
    /storefront\|store-admin[\s\S]{0,60}return next\(\)/,
    'the storefront shell route is not exempt from the dead-session check'
  );
});

test("the vendor's copyable storefront link is the path URL", () => {
  assert.match(read('js/utils.js'), /function\s+storefrontUrl\s*\(/, 'storefrontUrl() is missing from js/utils.js');

  const vendorSrc = read('js/vendor.js');
  assert.match(vendorSrc, /storefrontUrl\(sfSlug\)/, 'the vendor dashboard does not build its link with storefrontUrl()');
  assert.ok(
    !/window\.location\.origin\}\/#storefront\//.test(vendorSrc),
    'a hash storefront URL is still handed to the vendor — it cannot carry a preview'
  );

  // The client keeps the canonical address when a storefront blocks navigation.
  assert.match(read('js/app.js'), /storefrontUrl\(slug, App\.currentPage === 'store-admin'/);
});
