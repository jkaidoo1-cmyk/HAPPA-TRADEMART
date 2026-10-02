'use strict';
// A storefront is its own world — isolation guards.
//
// Nothing may cross between the main site and a storefront, or between two
// storefronts. This was broken in a way that looked like a small convenience:
// the storefront checkout prefilled its delivery form from App.currentUser.
// App.currentUser is the platform-wide account, and on a vendor's own phone that
// is the vendor — so the vendor's own name, phone and location were stamped onto
// the order as the customer's delivery details.
//
// Three rules are asserted here:
//
//   1. The checkout form never reads the signed-in account; it reads only what
//      was typed at THIS storefront before (per-store localStorage).
//   2. A storefront order carries a guest identity — no buyer_id link back to the
//      main-site account and no profile data on the row.
//   3. Storefront orders do not appear in the main site's buyer order lists.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const mktSrc = read('js/marketplace.js');

// Run the real per-store memory helpers against a fake localStorage, so the
// isolation guarantee is asserted on behaviour rather than on the shape of the
// source.
function loadBuyerInfoHelpers() {
  const start = mktSrc.indexOf('function sfBuyerInfoKey');
  assert.ok(start !== -1, 'sfBuyerInfoKey() is missing from js/marketplace.js');
  const end = mktSrc.indexOf('window.renderStorefrontCheckout = function');
  assert.ok(end > start, 'could not isolate the storefront buyer-info helpers');
  const src = mktSrc.slice(start, end);

  const store = new Map();
  const fakeLocalStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const factory = new Function(
    'localStorage',
    `${src}\nreturn { sfBuyerInfoKey, loadStorefrontBuyerInfo, saveStorefrontBuyerInfo };`
  );
  return { helpers: factory(fakeLocalStorage), store };
}

test('delivery details are remembered per storefront, never shared', () => {
  const { helpers } = loadBuyerInfoHelpers();

  helpers.saveStorefrontBuyerInfo('storeA', { name: 'Ama', phone: '0244000000', address: 'KNUST' });
  assert.deepEqual(helpers.loadStorefrontBuyerInfo('storeA'), {
    name: 'Ama', phone: '0244000000', address: 'KNUST'
  });
  assert.deepEqual(
    helpers.loadStorefrontBuyerInfo('storeB'), {},
    'details entered at one storefront must not fill in another storefront'
  );
});

test('the storefront key is scoped to the store, and there is no global fallback', () => {
  const { helpers, store } = loadBuyerInfoHelpers();

  assert.equal(helpers.sfBuyerInfoKey('storeA'), 'happa_sf_buyer_storeA');
  assert.equal(helpers.sfBuyerInfoKey(''), '', 'an unknown store must not get a shared key');

  assert.deepEqual(helpers.loadStorefrontBuyerInfo(''), {});
  helpers.saveStorefrontBuyerInfo('', { name: 'Nobody' });
  helpers.saveStorefrontBuyerInfo(null, { name: 'Nobody' });
  assert.equal(store.size, 0, 'an empty store id must never write anything');
});

test('the checkout form never prefills from the signed-in account', () => {
  const form = mktSrc.slice(
    mktSrc.indexOf('window.renderStorefrontCheckout = function'),
    mktSrc.indexOf('window.placeStorefrontOrder = async function')
  );
  assert.ok(form.length > 0, 'could not isolate renderStorefrontCheckout()');

  for (const field of ['name', 'phone', 'address']) {
    assert.match(
      form,
      new RegExp(`id="sf-ch-${field}" value="\\$\\{escHtml\\(sfBuyer\\.${field}`),
      `sf-ch-${field} must be filled from the details stored for THIS storefront`
    );
  }
  assert.doesNotMatch(
    form,
    /escHtml\(user\.(name|phone|location)/,
    'the storefront checkout is reading the main-site profile again'
  );
  assert.ok(
    form.includes('loadStorefrontBuyerInfo(storeId)'),
    'the checkout must load its prefill through loadStorefrontBuyerInfo()'
  );
});

test('a storefront order carries a guest identity, not the main-site account', () => {
  const place = mktSrc.slice(
    mktSrc.indexOf('window.placeStorefrontOrder = async function'),
    mktSrc.indexOf('window.renderStorefrontAdminPortal = function')
  );
  assert.ok(place.length > 0, 'could not isolate placeStorefrontOrder()');

  const guestLinks = place.match(/buyer_id: 'guest'/g) || [];
  assert.equal(guestLinks.length, 2, 'both the package and the mirrored order must be guest orders');
  assert.doesNotMatch(place, /buyer_id: user\.id/, 'the storefront order is linked to the platform account again');
  assert.doesNotMatch(place, /buyer_email: user\.email/, 'the platform account email is written onto a storefront order');
  assert.doesNotMatch(place, /App\.currentUser/, 'the storefront checkout must not read the signed-in account at all');
});

test('guest tracking keys are per storefront, and never the main-site keys', () => {
  // `happa_last_package_*` belongs to the main site (js/checkout.js writes it and
  // js/cart.js reads it). A storefront touching it would tie the two worlds back
  // together in both directions.
  assert.doesNotMatch(
    mktSrc,
    /happa_last_package_(code|phone)/,
    'the storefront is using the main site\'s tracking key again'
  );
  assert.ok(
    mktSrc.includes("setItem('happa_sf_last_code_' + storeId"),
    'the package code must be remembered per storefront'
  );
  assert.ok(
    mktSrc.includes("setItem('happa_sf_last_phone_' + storeId"),
    'the tracking phone must be remembered per storefront'
  );
});

test('storefront orders stay out of the main-site buyer views', () => {
  const buyerSrc = read('js/buyer.js');
  assert.ok(
    buyerSrc.includes('!isStorefrontOrder(p) && buyerOwnsPackage(p, u)'),
    'the buyer dashboard is counting storefront orders again'
  );
  assert.doesNotMatch(
    buyerSrc,
    /sfPkgsWithoutOrder/,
    'storefront packages must not be added to the main-site Total Orders stat'
  );

  const ordersSrc = read('js/orders.js');
  assert.match(
    ordersSrc,
    /!isStorefrontOrder\(p\) && buyerOwnsPackage\(p, App\.currentUser\)/,
    'the main-site buyer orders list is showing storefront orders again'
  );
});
