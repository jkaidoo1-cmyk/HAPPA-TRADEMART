'use strict';
// Money guards around product pricing.
//
// The bug this locks down: a product POST that carried NO `price` key at all
// passed validation, because the guard only ran `if ('price' in body)`. The row
// was stored with `price: null`, which the storefront renders as "Price
// unavailable" — and because resolveItems() prices a sale from the row with
// `Number(price) || 0`, that live listing then checked out for **GHS 0**. A
// listing nobody could buy at the right price, sold for free.
//
// These tests drive api/index.js directly (the handler vercel.json routes
// production traffic to) rather than server.js. api/index.js never loads .env,
// but the environment is cleared explicitly so getSupabase() returns null and
// the suite can never reach the deployed database.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

process.env.SESSION_SECRET = 'product-pricing-test-secret-not-real';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const dataStore = require(path.join('..', 'api', 'data-store'));

// data-store writes the real db.json on saveToFile(); neutralise it before
// api/index.js captures the module so this suite can never mutate repo data.
dataStore.saveToFile = () => true;

const app = require(path.join('..', 'api', 'index.js'));
const session = require('../lib/session');

const VENDOR_ID = 'pp-vendor-1';
const BUYER_ID = 'pp-buyer-1';
const STORE_ID = 'pp-store-1';

let server = null;
let base = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function api(p, opts = {}) {
  const res = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  let data = null;
  const raw = await res.text();
  try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
  return { status: res.status, data, raw };
}

const auth = (id, role) => ({ Authorization: `Bearer ${session.createSessionToken(id, role)}` });

before(async () => {
  const store = dataStore.getStore();
  store.users = [
    { id: VENDOR_ID, name: 'Pricing Vendor', email: 'pp-vendor@test.com', role: 'vendor', status: 'active' },
    { id: BUYER_ID, name: 'Pricing Buyer', email: 'pp-buyer@test.com', role: 'buyer', status: 'active', wallet_balance: 0 }
  ];
  store.stores = [{
    id: STORE_ID, vendor_id: VENDOR_ID, name: 'Pricing Store', slug: 'pricing-store',
    category: 'General', location: 'Accra', status: 'active', storefront_status: 'active', extra: {}
  }];
  store.products = [];
  store.packages = [];
  store.orders = [];

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  await new Promise(resolve => { server = app.listen(port, '127.0.0.1', resolve); });
});

after(() => {
  if (server) { try { server.close(); } catch (e) {} server = null; }
});

// ── The write boundary ───────────────────────────────────────────────────

test('POST /api/products without a price is refused, not stored as price:null', async () => {
  const headers = auth(VENDOR_ID, 'vendor');

  // Exactly the payload that produced the live "Price unavailable" listing.
  const missing = await api('/products', {
    method: 'POST',
    headers,
    body: { name: 'Striped long sleeve blue shirt', store_id: STORE_ID, stock_qty: 4, images: ['data:image/jpeg;base64,AAAA'] }
  });
  assert.equal(missing.status, 400, 'a product with no price must be refused');
  assert.match(String(missing.data && missing.data.error), /price/i);

  // Every other way a price can fail to be a real number.
  for (const price of [null, '', 'abc', 0, -1]) {
    const res = await api('/products', {
      method: 'POST', headers,
      body: { name: 'X', store_id: STORE_ID, stock_qty: 1, price, images: [] }
    });
    assert.equal(res.status, 400, `price ${JSON.stringify(price)} must be refused`);
  }

  // Nothing was written by any of the refusals.
  const stored = (dataStore.getStore().products || []).filter(p => String(p.store_id) === STORE_ID);
  assert.equal(stored.length, 0, 'a refused create must not leave a product row behind');
});

test('POST /api/products with a real price still works', async () => {
  const res = await api('/products', {
    method: 'POST',
    headers: auth(VENDOR_ID, 'vendor'),
    body: { name: 'Striped long sleeve blue shirt', store_id: STORE_ID, stock_qty: 4, price: 55, images: [] }
  });
  assert.ok(res.status === 200 || res.status === 201, `expected a create, got ${res.status} ${res.raw}`);
  assert.equal(Number(res.data.price), 55);
});

// ── The checkout boundary (the actual money) ─────────────────────────────

test('checkout refuses a legacy row whose stored price is null', async () => {
  // Simulate the pre-fix damage: a row already sitting in the database with
  // price null. The write guard cannot protect it — only the checkout can.
  dataStore.getStore().products.push({
    id: 'pp-legacy-null', name: 'Priceless shirt', store_id: STORE_ID, vendor_id: VENDOR_ID,
    price: null, original_price: null, stock_qty: 5, status: 'active', is_available: true, images: []
  });

  const res = await api('/packages', {
    method: 'POST',
    headers: auth(BUYER_ID, 'buyer'),
    body: { items: [{ product_id: 'pp-legacy-null', qty: 1, price: 999 }], store_id: STORE_ID }
  });

  assert.equal(res.status, 409, `a priceless row must not be sellable (got ${res.status} ${res.raw})`);
  assert.match(String(res.data && res.data.error), /no price set/i);
  // A client-supplied price cannot rescue it either — the 999 must be ignored.
  assert.equal((dataStore.getStore().packages || []).length, 0, 'nothing may be ordered');
});

test('checkout prices a real product from the stored row, ignoring the client amount', async () => {
  const created = (dataStore.getStore().products || []).find(p => String(p.store_id) === STORE_ID && Number(p.price) === 55);
  assert.ok(created, 'the priced product from the earlier test should exist');

  const res = await api('/packages', {
    method: 'POST',
    headers: auth(BUYER_ID, 'buyer'),
    body: { items: [{ product_id: created.id, qty: 2, price: 1 }], store_id: STORE_ID }
  });

  assert.ok(res.status === 200 || res.status === 201, `expected an order, got ${res.status} ${res.raw}`);
  const items = res.data.items || [];
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].price), 55, 'the stored price wins, not the 1 the client sent');
  assert.equal(Number(items[0].qty), 2);
});
