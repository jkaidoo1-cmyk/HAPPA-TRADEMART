'use strict';
// The role bundles must not be downloaded by people who cannot use them.
//
// index.html used to list all 20 scripts unconditionally, so an anonymous
// shopper opening the home page paid for the vendor dashboard (274 KB), the
// admin dashboard and its profile screens (301 KB), Chart.js (200 KB) and the
// rendor dashboard (66 KB) — ~865 KB, most of it the largest thing on the page.
// Lighthouse measured 1.3 MB of unused JavaScript on the home page.
//
// js/app.js now fetches them for the account's role or for the page being
// opened. That is a promise about *when* they load, so it is pinned here:
//
//   1. index.html lists none of them.
//   2. Each one is reachable — a role, a page, or both, in js/app.js.
//   3. Nothing that every page loads calls into them on a path a shopper takes.
//      This is the one that broke while the change was being made: switchTab()
//      and resendOTP() lived in js/vendor.js but the BUYER dashboard calls both,
//      so the buyer dashboard would have silently lost its tabs.
//   4. The service worker does not precache them either.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const indexHtml = read('index.html');
const appJs = read('js/app.js');
const sw = read('sw.js');
const buyerJs = read('js/buyer.js');
const ordersJs = read('js/orders.js');
const utilsJs = read('js/utils.js');
const authJs = read('js/auth.js');

// The bundles that moved out of index.html, and the cost of each.
const ROLE_BUNDLES = [
  '/js/vendor.js',
  '/js/admin.js',
  '/js/admin-profiles.js',
  '/js/admin-settings.js',
  '/js/rendor.js',
  '/js/chart.min.js'
];

// Scripts every visitor still gets, in the order index.html loads them.
const EAGER = [
  'optimistic_ui', 'utils', 'upload', 'app', 'auth', 'orders', 'marketplace',
  'cart', 'checkout', 'wallet', 'buyer', 'search', 'notifications', 'support', 'ads'
];

test('index.html does not list any role bundle', () => {
  const srcTags = [...indexHtml.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  for (const bundle of ROLE_BUNDLES) {
    assert.ok(
      !srcTags.includes(bundle),
      `${bundle} is listed in index.html again — every visitor would download it`
    );
  }
  for (const name of EAGER) {
    assert.ok(
      srcTags.includes(`/js/${name}.js`),
      `/js/${name}.js is a bundle every page needs and must stay in index.html`
    );
  }
});

test('every role bundle is reachable from js/app.js', () => {
  const roleList = appJs.slice(appJs.indexOf('const ROLE_SCRIPTS'), appJs.indexOf('const PAGE_SCRIPTS'));
  const pageList = appJs.slice(appJs.indexOf('const PAGE_SCRIPTS'), appJs.indexOf('const _scriptLoads'));
  assert.ok(roleList.length > 0 && pageList.length > 0, 'the script maps are missing from js/app.js');

  const reachable = roleList + pageList;
  for (const bundle of ROLE_BUNDLES) {
    assert.ok(reachable.includes(`'${bundle}'`), `${bundle} is in neither ROLE_SCRIPTS nor PAGE_SCRIPTS`);
  }

  // The roles that can reach a dashboard must be named.
  for (const role of ['vendor', 'admin', 'rendor']) {
    assert.match(roleList, new RegExp(`\\b${role}:\\s*\\[`), `ROLE_SCRIPTS has no entry for the ${role} role`);
  }
  // `seller` is routed to the vendor dashboard by showPage().
  assert.match(roleList, /seller:\s*\[/, 'a seller lands on the vendor dashboard and needs the vendor bundle');

  // The page triggers the vendor/admin flows actually use.
  for (const page of ['vendor-dashboard', 'vendor-my-store', 'vendor-orders', 'store-admin', 'admin-dashboard', 'rendor-dashboard']) {
    assert.ok(pageList.includes(`'${page}'`), `PAGE_SCRIPTS has no entry for '${page}'`);
  }

  // …and the loader has to be awaited before the page's init call runs, or the
  // function it calls is simply not defined yet.
  const runPageInit = appJs.slice(appJs.indexOf('async function runPageInit'), appJs.indexOf('// ── PWA Storefront Guard'));
  assert.match(
    runPageInit,
    /await ensureScriptsForPage\(pageId\);/,
    'runPageInit() must await the page bundle before the switch that uses it'
  );
  assert.ok(
    runPageInit.indexOf('await ensureScriptsForPage(pageId)') < runPageInit.indexOf('switch(pageId)'),
    'the bundle must be awaited before the switch, not inside a case'
  );

  // A vendor's wallet top-up re-renders the vendor dashboard from js/wallet.js,
  // and js/orders.js reads a setting out of admin-settings.js, so the role list
  // has to carry them too — not just the page list.
  assert.match(roleList, /vendor:\s*\[[^\]]*admin-settings\.js/, 'vendor role must load admin-settings.js');
  assert.match(roleList, /admin:\s*\[[^\]]*chart\.min\.js/, 'the admin role must get Chart.js with its dashboard');
});

test('the buyer dashboard does not depend on the vendor bundle', () => {
  // switchTab() and resendOTP() were both defined in js/vendor.js while being
  // called from the buyer dashboard's own markup.
  const buyerHandlers = [...buyerJs.matchAll(/onclick="([^"]+)"/g)].map(m => m[1]).join('\n');
  assert.match(buyerHandlers, /switchTab\(/, 'the buyer dashboard is expected to use switchTab()');
  assert.match(
    utilsJs,
    /^function switchTab\(el, tabId\) \{/m,
    'switchTab() must live in js/utils.js, which every page loads'
  );
  assert.match(authJs, /^function resendOTP\(\) \{/m, 'resendOTP() must live in js/auth.js, which every page loads');

  for (const name of ['switchTab', 'resendOTP']) {
    const decls = ['js/vendor.js', 'js/admin.js', 'js/admin-profiles.js', 'js/admin-settings.js', 'js/rendor.js']
      .filter(f => new RegExp(`^function ${name}\\(`, 'm').test(read(f)));
    assert.deepEqual(decls, [], `${name}() is defined in ${decls.join(', ')} — an eager page needs it`);
  }

  // switchTab() must keep closing the storefront editor's fixed preview overlay,
  // which is why it existed in the vendor file in the first place.
  const fn = utilsJs.slice(utilsJs.indexOf('function switchTab('));
  assert.match(fn.slice(0, 2000), /sfTogglePreview\(false\)/, 'switchTab() must still close the preview drawer');
  assert.match(utilsJs, /window\.switchTab = switchTab;/, 'switchTab() must stay reachable from inline handlers');
});

test('js/orders.js can still read the referral percentage it needs', () => {
  assert.match(
    ordersJs,
    /getEffectiveReferralCommissionPct/,
    'the audit this file encodes assumed orders.js reads this setting'
  );
  const roleList = appJs.slice(appJs.indexOf('const ROLE_SCRIPTS'), appJs.indexOf('const PAGE_SCRIPTS'));
  for (const role of ['vendor', 'seller', 'admin']) {
    const entry = new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`).exec(roleList);
    assert.ok(entry, `${role} is missing from ROLE_SCRIPTS`);
    assert.match(
      entry[1],
      /admin-settings\.js/,
      `${role} can release a delivery without admin-settings.js loaded — the referral % would silently fall back`
    );
  }
});

test('the service worker does not precache the role bundles', () => {
  const precache = sw.slice(sw.indexOf('PRECACHE_ASSETS'), sw.indexOf('// ── Install'));
  for (const bundle of ROLE_BUNDLES) {
    assert.ok(
      !precache.includes(`'./${bundle.replace(/^\//, '')}'`),
      `${bundle} is precached again — installing the app would fetch it for everybody`
    );
  }
  // The eager bundles must stay precached, or the installed app boots offline
  // into a blank page.
  for (const name of EAGER) {
    assert.ok(precache.includes(`'./js/${name}.js'`), `/js/${name}.js must stay in PRECACHE_ASSETS`);
  }
});
