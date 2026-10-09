'use strict';
// A product whose price would read as 0 or "Price unavailable" must never
// reach a public shelf.
//
// The reported bug: two live products showed "Price unavailable" in the
// marketplace. The price helpers made a missing price honest (they print
// "Price unavailable" instead of a fake GHS 0), but an honest broken card is
// still a broken storefront — so the display rule is now: a row without a
// usable, non-zero price is not listed at all.
//
//   * isProductListable (js/utils.js) is the single choke point behind the
//     home page, marketplace, search, ads, storefronts and store pages, so the
//     gate lives there and every surface inherits it.
//   * The surfaces that do NOT go through it are wired explicitly: product
//     detail, the storefront quick-view modal, the wishlist, and both carts
//     (legacy localStorage lines that predate the gate).
//   * Vendor/admin management lists deliberately stay unfiltered — the owner
//     must still SEE a priceless row to fix it — and a deliberate 0 stays
//     sellable server-side (test/commerce-atomic.test.js). This is a display
//     rule, not a commerce rule.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const utilsSrc = read('js/utils.js');

// ── Load the real rule out of the browser bundle ────────────────────────────
// Same slicing approach as test/price-format.test.js: the suite runs the code
// that ships, so the assertions cannot drift from the app.
const HELPERS_START = utilsSrc.indexOf('// ── Price display helper');
const HELPERS_END = utilsSrc.indexOf('window.priceInputValue = priceInputValue;');
const GATE_START = utilsSrc.indexOf('window.isProductListable = function');
const GATE_END = utilsSrc.indexOf('// A store is visible on the main site');
assert.ok(HELPERS_START > -1 && HELPERS_END > HELPERS_START, 'the price helpers are missing from js/utils.js');
assert.ok(GATE_START > -1 && GATE_END > GATE_START, 'the listing gate is missing from js/utils.js');

const AppStub = { allStores: [] };
const win = {};
new Function('window', 'App',
  utilsSrc.slice(HELPERS_START, HELPERS_END) +
  '\nwindow.priceInputValue = priceInputValue;\n' +
  utilsSrc.slice(GATE_START, GATE_END) +
  // shouldShowProductOnMainWebsite() calls isProductListable by name; the
  // browser resolves the bare name through window, so bind it in this scope too.
  '\nconst isProductListable = window.isProductListable;' +
  '\nreturn { hasDisplayablePrice, isProductListable, shouldShowProductOnMainWebsite: window.shouldShowProductOnMainWebsite, priceText };'
)(win, AppStub);

const { hasDisplayablePrice, isProductListable, shouldShowProductOnMainWebsite, priceText } = win;

// ── The rule ────────────────────────────────────────────────────────────────

test('hasDisplayablePrice: only a real, non-zero price is displayable', () => {
  for (const price of [55, '55', 'GHS 55', 'GHS 1,200.50', 0.5]) {
    assert.equal(hasDisplayablePrice({ price }), true, `a product priced ${JSON.stringify(price)} must be displayable`);
  }
  for (const price of [null, undefined, '', '   ', 'abc', 0, '0', 'GHS 0', NaN, -5]) {
    assert.equal(hasDisplayablePrice({ price }), false, `a product priced ${JSON.stringify(price)} must be hidden`);
  }
  assert.equal(hasDisplayablePrice(null), false, 'a missing row is not displayable');
  assert.equal(hasDisplayablePrice({}), false, 'a row without a price is not displayable');
  assert.equal(hasDisplayablePrice({ price: 55, original_price: 100 }), true, 'the listed price decides');
});

test('isProductListable hides priceless and zero-priced products, keeps real ones', () => {
  const base = { stock_qty: 5, status: 'active' };
  assert.equal(isProductListable({ ...base, price: 55 }), true);
  assert.equal(isProductListable({ ...base, price: 'GHS 55' }), true, 'a string price (Postgres numeric) still lists');
  for (const price of [null, undefined, '', 0, '0', 'abc']) {
    assert.equal(isProductListable({ ...base, price }), false, `a product priced ${JSON.stringify(price)} must not be listed`);
  }
  // The pre-existing stock/status rules are unchanged.
  assert.equal(isProductListable({ ...base, price: 55, stock_qty: 0 }), false);
  assert.equal(isProductListable({ ...base, price: 55, status: 'sold_out' }), false);
  assert.equal(isProductListable({ ...base, price: 55, status: 'archived' }), false);
  assert.equal(isProductListable({ ...base, price: 55, status: 'pending_deletion' }), false);
  assert.equal(isProductListable(null), false);
});

test('shouldShowProductOnMainWebsite inherits the price gate', () => {
  assert.equal(shouldShowProductOnMainWebsite({ price: 55, stock_qty: 1 }), true);
  assert.equal(shouldShowProductOnMainWebsite({ price: null, stock_qty: 1 }), false, 'a priceless row is not listed on main');
  assert.equal(shouldShowProductOnMainWebsite({ price: 0, stock_qty: 1 }), false, 'a zero-priced row is not listed on main');

  // The storefront-only rule still applies on top of the gate.
  AppStub.allStores = [{ id: 's1', extra: JSON.stringify({ only_show_on_storefront: true }) }];
  assert.equal(shouldShowProductOnMainWebsite({ price: 55, stock_qty: 1, store_id: 's1' }), false);
  AppStub.allStores = [];
});

test('the helper stays honest for 0 while the listing rule hides it', () => {
  // The two rules are deliberately different: priceText reports what is stored
  // (a genuine 0 is a real amount), the listing gate decides what may be shown.
  assert.equal(priceText(0), 'GHS 0');
  assert.equal(priceText(null), 'Price unavailable');
  assert.equal(hasDisplayablePrice({ price: 0 }), false);
  assert.equal(hasDisplayablePrice({ price: null }), false);
});

// ── Wiring: the surfaces outside isProductListable ──────────────────────────

function sliceAround(src, marker, len) {
  const i = src.indexOf(marker);
  assert.ok(i !== -1, `${marker} is missing`);
  return src.slice(i, i + len);
}

test('product detail and the storefront modal gate priceless rows', () => {
  const market = read('js/marketplace.js');
  const detail = sliceAround(market, 'async function renderProductDetail', 4000);
  assert.match(detail, /hasDisplayablePrice\(p\)/, 'renderProductDetail does not gate priceless rows');
  assert.match(detail, /Product unavailable/, 'renderProductDetail has no unavailable empty state');

  const modal = sliceAround(market, 'window.openStorefrontProductModal', 2000);
  assert.match(modal, /hasDisplayablePrice\(p\)/, 'the storefront quick-view modal does not gate priceless rows');
});

test('both carts prune legacy priceless lines instead of printing them', () => {
  assert.match(
    read('js/cart.js'),
    /App\.cart\.filter\(item => hasDisplayablePrice\(item\)\)/,
    'the main cart does not prune priceless lines'
  );
  assert.match(
    read('js/marketplace.js'),
    /stored\.filter\(item => hasDisplayablePrice\(item\)\)/,
    'the storefront cart does not prune priceless lines'
  );
  assert.match(
    sliceAround(read('js/app.js'), 'function loadSession', 900),
    /pruneUnpricedCartItems\(\)/,
    'loadSession does not clean the restored cart'
  );
});

test('the wishlist does not resurface a priceless card', () => {
  assert.match(
    sliceAround(read('js/buyer.js'), 'window.renderBuyerWishlist', 900),
    /hasDisplayablePrice\(p\)/,
    'the wishlist does not gate priceless rows'
  );
});

test('isProductListable is the choke point the public lists share', () => {
  // Every list that must hide priceless rows routes through this one helper.
  for (const [file, marker] of [
    ['js/app.js', 'shouldShowProductOnMainWebsite(p)'],
    ['js/search.js', 'shouldShowProductOnMainWebsite(p)'],
    ['js/marketplace.js', 'shouldShowProductOnMainWebsite(p)'],
  ]) {
    assert.ok(read(file).includes(marker), `${file} no longer uses the main-website gate`);
  }
  assert.match(utilsSrc, /window\.isProductListable = function\(product\) \{[\s\S]{0,400}hasDisplayablePrice\(product\)/);
});
