'use strict';
// A storefront must never open as / through the installed app.
//
// The storefront shares the app's shell (index.html), which is what makes the
// shared-link previews work. The cost was that a storefront URL was served with
// the app's manifest link and its mobile-web-app-capable / apple-mobile-web-app-*
// metas still in place, so an OS treated the storefront as part of the installed
// HAPPA TRADEMART app: tapping a storefront link handed it to the installed app
// instead of the browser, and "Add to Home Screen" from a storefront built a
// standalone app for that store.
//
// Three things keep them apart, all pinned here:
//   1. The served storefront document carries no PWA hooks (lib/storefront-shell.js).
//   2. The shell sets up no service-worker plumbing on a storefront URL (index.html).
//   3. Inside the installed app, a storefront hands off to the browser instead of
//      rendering in the app window (js/app.js).
// The app's own pages must keep everything: the fix may never cost installability.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

const shell = require(path.join(ROOT, 'lib', 'storefront-shell.js'));
const indexHtml = read('index.html');
const appJs = read(path.join('js', 'app.js'));
const marketplaceJs = read(path.join('js', 'marketplace.js'));
const buyerJs = read(path.join('js', 'buyer.js'));
const utilsJs = read(path.join('js', 'utils.js'));
const sw = read('sw.js');

const META = {
  title: "MIMI'S COLLECTION — HAPPA TRADEMART",
  description: 'Quality fashion, delivered across Ghana.',
  image: 'https://example.test/banner.png',
  canonical: 'https://example.test/storefront/mimis-collection',
  robots: '',
  siteName: 'HAPPA TRADEMART',
};

test('a storefront page is served without the app manifest or app-capable metas', () => {
  const out = shell.injectStorefrontMeta(indexHtml, META);

  assert.ok(out.includes("MIMI&#39;S COLLECTION"), 'the store title must still be injected');
  assert.match(out, /<meta property="og:title"/, 'the share card must survive — that is why the shell is reused');

  assert.ok(!/rel="manifest"/.test(out), 'a storefront must not point at the app manifest');
  for (const name of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title', 'mobile-web-app-capable', 'application-name']) {
    assert.ok(
      !new RegExp(`name="${name}"`).test(out),
      `${name} makes the storefront launchable as an app and must be stripped`
    );
  }

  // Plain web-page furniture is fine and must not be over-stripped.
  assert.match(out, /<link rel="icon"/, 'icons are harmless on a normal page');
  assert.match(out, /name="theme-color"/, 'theme-color only tints the browser chrome');
  assert.ok(!out.includes('<!DOCTYPE html>') === false, 'the document itself must be intact');
});

test('stripPwaHooks removes only the installability hooks', () => {
  const sample = [
    '<link rel="manifest" href="/manifest.json?v=2">',
    '<link rel="manifest" href="/manifest.json?v=2" crossorigin="use-credentials">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="application-name" content="HAPPAMART">',
    '<link rel="icon" href="/images/icon-192.png">',
    '<link rel="apple-touch-icon" href="/images/icon-192.png">',
    '<meta name="viewport" content="width=device-width">',
  ].join('\n');

  const out = shell.stripPwaHooks(sample);

  assert.ok(!/rel="manifest"/.test(out), 'every manifest link must go, whatever its other attributes');
  assert.ok(!/apple-mobile-web-app-capable|mobile-web-app-capable|application-name/.test(out), 'app-capable metas must go');
  assert.match(out, /<link rel="icon" href="\/images\/icon-192\.png">/, 'the icon link must stay');
  assert.match(out, /<link rel="apple-touch-icon"/, 'the touch icon must stay');
  assert.match(out, /name="viewport"/, 'unrelated metas must stay');
});

test('the app itself keeps every PWA hook', () => {
  // Guards against a fix that quietly de-PWAs the marketplace.
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.json\?v=2">/, 'the app must keep its manifest');
  assert.match(indexHtml, /name="apple-mobile-web-app-capable" content="yes"/, 'the app must stay installable on iOS');
  assert.match(indexHtml, /name="mobile-web-app-capable" content="yes"/, 'the app must stay installable on Android');
  assert.match(indexHtml, /name="application-name" content="HAPPAMART"/, 'the app keeps its application-name');
  // The strip runs only in the storefront path of injectStorefrontMeta().
  const lib = read(path.join('lib', 'storefront-shell.js'));
  assert.match(lib, /function stripPwaHooks/, 'the hook stripper must exist');
  assert.equal(
    (lib.match(/stripPwaHooks\(/g) || []).length,
    3, // definition + two returns in injectStorefrontMeta (both branches)
    'injectStorefrontMeta() must strip on every path it returns from'
  );
});

test('the shell sets up no service-worker plumbing on a storefront URL', () => {
  // A path-addressed storefront is a store page; a hash storefront is in-app
  // navigation on a page that already is the app.
  assert.match(
    indexHtml,
    /window\.HAPPA_STOREFRONT_SHELL = \/\^\\\/\(\?:storefront\|store-admin\)\\\/\/\.test\(p\)/,
    'the flag must key off the PATH only, so in-app #storefront/<slug> navigation is unaffected'
  );

  assert.match(
    indexHtml,
    /if \('serviceWorker' in navigator && !window\.HAPPA_STOREFRONT_SHELL\)/,
    'a storefront visit must not install the app service worker for a shopper'
  );
  const selfHealAt = indexHtml.indexOf("var SW_VERSION = 'happa-v");
  const guardAt = indexHtml.lastIndexOf('if (window.HAPPA_STOREFRONT_SHELL) return;', selfHealAt);
  assert.ok(guardAt !== -1, 'the cache self-heal must skip a storefront page');
  // The guard has to run before the self-heal can unregister anything.
  const returnAt = indexHtml.indexOf('navigator.serviceWorker.getRegistrations', selfHealAt);
  assert.ok(guardAt < returnAt, 'the guard must sit above the unregister call, not after it');
});

test('inside the installed app a storefront hands off to the browser', () => {
  const body = appJs.slice(appJs.indexOf('function showPage(pageId'));
  const guard = body.slice(0, 4000);

  assert.match(
    guard,
    /\(pageId === 'storefront' \|\| pageId === 'store-admin'\) && isPwaMode\(\)/,
    'showPage must hand a storefront off whenever it is running in the installed app'
  );
  // The guard must NOT be narrowed by the URL shape. `scope` does not keep an
  // out-of-scope deep link out of the installed app (the browser merely adds a
  // URL bar), so exempting /storefront/<slug> is what let a shared store link
  // render the store inside the PWA.
  assert.doesNotMatch(
    guard,
    /isPwaMode\(\) && !isPathAddressedStorefront\(\)/,
    'the /storefront/<slug> path form must hand off too, not render in the app window'
  );
  assert.match(guard, /openStorefrontInBrowser\(pageId, targetEntity\);\s*return;/, 'the handoff must return before the page renders');

  // The helper used to be exported and never called, so tapping a store inside
  // the installed app rendered the storefront in the app window.
  const uses = (appJs.match(/openStorefrontInBrowser\(/g) || []).length;
  assert.ok(uses >= 2, `openStorefrontInBrowser() must actually be called (found ${uses} references)`);
  assert.match(appJs, /window\.open\(targetUrl, '_blank', 'noopener,noreferrer'\)/, 'the handoff must open a fresh browser context');

  // …and the anchor path (any <a href="/storefront/x">) keeps its own guard.
  assert.match(appJs, /if \(!isPWA\(\)\) return;/, 'the anchor handler must only act inside the installed app');
  assert.match(appJs, /const storefrontPaths = \['\/storefront\/', '\/store\/', '\/store-admin\/'\]/, 'the anchor handler must know the storefront paths');
});

test('a storefront deep link never boots the app inside the installed app', () => {
  // The path that actually broke: an installed app window holding
  // /storefront/<slug>. The runtime guard alone is not enough, because the boot
  // block applies the storefront classes, drops the splash and pushes history
  // before it ever reaches showPage.
  const boot = appJs.slice(appJs.indexOf("if (isDirectStorefront) {"), appJs.indexOf('function resolveRouteFromHash'));
  assert.ok(boot.length > 0, 'could not isolate the startup storefront block');

  const firstStatement = boot.indexOf('if (isPwaMode()) {');
  assert.ok(firstStatement !== -1, 'the startup block must check for the installed app');
  assert.ok(
    firstStatement < boot.indexOf('App.isStandaloneStorefront = true'),
    'the hand-off must come before any storefront state is applied'
  );
  assert.ok(
    firstStatement < boot.indexOf('showPage(isStoreAdmin'),
    'the hand-off must come before the storefront is rendered'
  );
  assert.match(
    boot,
    /if \(isPwaMode\(\)\) \{\s*openStorefrontInBrowser\(isStoreAdmin \? 'store-admin' : 'storefront', storeSlug, \{ replaceWindow: true \}\);\s*return;/,
    'the startup block must hand off and stop'
  );
});

test('nothing in the shell shows a storefront before the hand-off runs', () => {
  // The pre-boot script in index.html used to reach for window.open() with the
  // non-standard '_system' target in the middle of parsing — no user activation,
  // so Chrome's popup blocker refused it and the guard did nothing. It then
  // removed the splash and activated #page-storefront on DOMContentLoaded, so the
  // store was already on screen whatever js/app.js decided afterwards.
  const start = indexHtml.indexOf('Standalone PWA Link Guard');
  const end = indexHtml.indexOf('</script>', start);
  assert.ok(start !== -1 && end > start, 'could not isolate the pre-boot storefront guard');
  // Comments are stripped so the assertions describe the code, not the prose
  // that documents why the old code was wrong.
  const pre = indexHtml.slice(start, end).replace(/^[^\n]*\/\/[^\n]*$/gm, '');

  assert.doesNotMatch(pre, /_system/, "'_system' is a Cordova target name, not a web one");
  assert.doesNotMatch(pre, /window\.open\(/, 'a popup attempted during parsing is always blocked');
  assert.match(
    pre,
    /const isStorefrontInInstalledApp = isPWAStandalone && isStorefrontUrl;/,
    'the installed-app condition must be computed before the skeleton is set up'
  );
  assert.match(
    pre,
    /if \(!isStorefrontInInstalledApp\) \{\s*const splash = document\.getElementById\('pwa-splash-screen'\);\s*if \(splash\) splash\.remove\(\);\s*\}/,
    'the splash must stay up in an installed app so nothing of the app shows through'
  );

  const skeleton = pre.slice(pre.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.ok(skeleton.length > 0, 'could not isolate the skeleton block');
  const guardAt = skeleton.indexOf('if (isStorefrontInInstalledApp) return;');
  assert.ok(guardAt !== -1, 'the skeleton must be skipped in an installed app');
  assert.ok(
    guardAt < skeleton.indexOf("sfPage.classList.add('active')"),
    'the guard must sit above the code that activates the storefront page'
  );
});

test('the hand-off can never fall through and render the storefront in the app', () => {
  const fn = appJs.slice(appJs.indexOf('function openStorefrontInBrowser'), appJs.indexOf('window.openStorefrontInBrowser'));
  assert.ok(fn.length > 0, 'could not isolate openStorefrontInBrowser()');

  // Returning false from inside the dedupe window made the caller continue into
  // the render path — the store came back inside the app on the second caller.
  assert.doesNotMatch(fn, /return false;/, 'the hand-off must not report "not handled" and let the app render the store');
  assert.match(fn, /return true;\s*\}/, 'the hand-off must always report that it handled the navigation');

  // A standalone window can refuse the programmatic open (no user activation),
  // so there must be a tappable way out that does not depend on it.
  assert.match(fn, /showStorefrontHandoffNotice\(targetUrl\)/, 'a refused window.open must still leave the visitor a way to the store');
  const notice = appJs.slice(appJs.indexOf('function showStorefrontHandoffNotice'), appJs.indexOf('let _sfHandoffLastUrl'));
  assert.match(notice, /link\.target = '_blank'/, 'the notice link must open a real browser context');
  assert.match(notice, /shown\.textContent = targetUrl;/, 'the URL must be set as text, never as HTML');
  assert.doesNotMatch(notice, /innerHTML/, 'no HTML interpolation of a URL');
  // The store's own URL keeps whatever it was opened with (?product=, ?ref=).
  assert.match(appJs, /if \(isPathAddressedStorefront\(\)\) return window\.location\.href;/, 'the path form must hand off the exact URL it was opened with');
});

test('a link shared from a storefront carries the store, not the marketplace', () => {
  // Which URL is shared must not depend on the sharer's address bar: a path
  // storefront and a hash one are the same store, and a referral link copied on
  // a store page must still point at the marketplace signup.
  assert.match(
    utilsJs,
    /function currentStorefrontSlug\(\)/,
    'the current storefront slug must be resolvable from the page context'
  );
  assert.match(utilsJs, /window\.currentStorefrontSlug = currentStorefrontSlug;/, 'it must be shared with the other modules');

  const share = marketplaceJs.slice(marketplaceJs.indexOf('async function shareProduct'), marketplaceJs.indexOf('// Convert a product image'));
  assert.match(
    share,
    /const sfSlug = [^;]*currentStorefrontSlug\(\)/,
    'shareProduct() must ask which storefront the sharer is inside'
  );
  assert.match(
    share,
    /sfSlug \? storefrontUrl\(sfSlug\) : window\.location\.origin \+ window\.location\.pathname/,
    'the share URL must be the store’s own URL inside a storefront, the marketplace’s otherwise'
  );

  const ref = buyerJs.slice(buyerJs.indexOf('function buildRefLink'), buyerJs.indexOf('function copyRefLink'));
  assert.ok(
    !/window\.location\.pathname/.test(ref),
    'a referral link must never inherit the page it was copied from'
  );
  assert.match(ref, /window\.location\.origin \+ '\/'/, 'referral links must point at the marketplace itself');
});

test('a shared storefront link survives in the visitor’s address bar', () => {
  // The SPA rewrites the URL to the store's canonical path when it renders the
  // storefront; dropping the query there silently demoted an arrived-on
  // '?product=<id>' link to a bare store URL for anyone who re-shared it.
  const rewrite = appJs.slice(appJs.indexOf('if ((pageId === \'storefront\' || pageId === \'store-admin\') && isPathAddressedStorefront())'));
  const line = rewrite.slice(0, 700);
  assert.match(
    line,
    /storefrontCanonicalUrl\(targetEntity,[^)]*\)\s*\+\s*\(window\.location\.search \|\| ''\)/,
    'the canonical storefront URL must keep the query string it was opened with'
  );
});

test('a storefront product link opens in the store, whatever the network did', () => {
  const open = appJs.slice(appJs.indexOf('async function openProduct'));
  const body = open.slice(0, 1200);

  assert.match(
    body,
    /const storefrontContext =[\s\S]{0,200}isPathAddressedStorefront\(\)/,
    'the URL must be part of the decision — otherwise the link races the storefront boot'
  );
  assert.match(body, /if \(storefrontContext\) \{/, 'the modal branch must hang off that decision');
  assert.match(body, /openStorefrontProductModal\(id\)/, 'a storefront product link must open the store’s own product view');
  assert.match(body, /showPage\('product', id\)/, 'the marketplace must still open its own product page');
});

test('the service worker never intercepts a storefront navigation', () => {
  assert.match(
    sw,
    /isStorefrontNav && request\.mode === 'navigate'\) \{\s*\/\/[^\n]*\n\s*return;/,
    'a storefront navigation must be left to the browser so a cached shell can never swallow it'
  );
});
