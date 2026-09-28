'use strict';
// Regression tests for the checkout money/stock rules (guide §6/§7/§8),
// exercised over HTTP against a real server.js instance:
//
//   - money fields are derived server-side from product rows (client amounts
//     are display-only and must be ignored)
//   - stock is decremented exactly once per sale, with store stats
//   - replaying a package id is a no-op (no double decrement / double stats)
//   - overselling is refused with 409 and leaves no side effects
//   - invalid input (empty items, negative price, bogus coupon) is refused
//
// The server runs on an ephemeral port against an isolated copy of db.json
// (HAPPA_DB_FILE), so real development data is never touched and the test can
// run concurrently with the rest of the suite.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');

// Match the session secret the spawned server will use (server.js loads .env at
// startup, then lib/session falls back to the persisted .session-secret file),
// so tokens minted here validate there. Needed because the replay guard now
// only returns an order row to its own buyer/vendor (#13).
(function resolveFromEnvFile() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0 && trimmed.slice(0, eq).trim() === 'SESSION_SECRET') {
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (value) process.env.SESSION_SECRET = value;
    }
  }
})();

const session = require('../lib/session');
let SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();
if (!SESSION_SECRET) {
  try { SESSION_SECRET = fs.readFileSync(path.join(ROOT, '.session-secret'), 'utf-8').trim(); } catch (e) {}
  if (SESSION_SECRET) process.env.SESSION_SECRET = SESSION_SECRET;
}

// The checkout flows below act as one signed-in buyer so the replay guard can
// recognise them as the order's owner.
const BUYER_ID = 'rules-buyer';
function buyerHeaders() {
  return { Authorization: `Bearer ${session.createSessionToken(BUYER_ID, 'buyer')}` };
}

let tmpDir = null;
let child = null;
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
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function getProd() {
  const r = await api('/products/prod-diag-1');
  return Array.isArray(r.data) ? r.data[0] : r.data;
}

async function getStore() {
  const r = await api('/stores/store-msku253he58z');
  return Array.isArray(r.data) ? r.data[0] : r.data;
}

before(async () => {
  // Isolated database with a known fixture state.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happa-rules-'));
  const testDb = path.join(tmpDir, 'db.json');
  fs.copyFileSync(path.join(ROOT, 'db.json'), testDb);
  const db = JSON.parse(fs.readFileSync(testDb, 'utf-8'));
  const prod = (db.products || []).find(x => x.id === 'prod-diag-1');
  assert.ok(prod, 'fixture prod-diag-1 must exist in db.json');
  prod.stock_qty = 5;
  prod.total_sold = 0;
  prod.sold_count = 0;
  prod.status = 'active';
  prod.is_available = true;
  // (#14) item→store binding: a package may only contain products that
  // actually belong to the store it claims, so the fixture product must live
  // under the same store these packages check out from.
  prod.store_id = 'store-msku253he58z';
  prod.vendor_id = 'msku253he58z';
  const store = (db.stores || []).find(x => String(x.id) === 'store-msku253he58z');
  assert.ok(store, 'fixture store-msku253he58z must exist in db.json');
  store.total_orders = 0;
  store.total_sales = 0;
  fs.writeFileSync(testDb, JSON.stringify(db));

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HAPPA_DB_FILE: testDb, SESSION_SECRET },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  // Wait for readiness (bounded).
  const deadline = Date.now() + 10000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('server.js did not start:\n' + log);
    try {
      const r = await fetch(base + '/products/prod-diag-1');
      if (r.ok) break;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
});

after(() => {
  if (child) { try { child.kill('SIGKILL'); } catch (e) {} child = null; }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} tmpDir = null; }
});

test('package POST derives money server-side and ignores client amounts', async () => {
  const before = await getStore();
  const res = await api('/packages', {
    method: 'POST',
    headers: buyerHeaders(),
    body: {
      id: 'rules-pkg-1',
      store_id: 'store-msku253he58z',
      vendor_id: 'evil-vendor', // must be overridden by the store's vendor
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', name: 'Kente Shawl', qty: 2, price: 999999 }],
      gross_amount: 999999,
      vendor_amount: 999999,
      commission_amount: 0,
      platform_fee: 0,
      total_amount: 999999,
      delivery_fee: 500
    }
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const m = res.data;
  assert.equal(Number(m.gross_amount), 300);           // 2 × 150 (authoritative)
  assert.equal(Number(m.commission_amount), 12);       // 4% tier for price 150
  assert.equal(Number(m.vendor_amount), 288);
  assert.equal(Number(m.platform_fee), 4.5);           // 1.5% buyer fee
  assert.equal(Number(m.total_amount), 304.5);
  assert.equal(Number(m.delivery_fee), 0);             // delivery disabled platform-wide
  assert.equal(m.vendor_id, 'msku253he58z');           // vendor comes from the store
  assert.equal(Number(m.items[0].price), 150);         // item price rewritten server-side

  // Stock and sold counters fell exactly once.
  const p = await getProd();
  assert.equal(Number(p.stock_qty), 3);
  assert.equal(Number(p.total_sold != null ? p.total_sold : p.sold_count), 2);

  // Store stats moved by exactly this sale.
  const afterStore = await getStore();
  assert.equal(Number(afterStore.total_orders), (Number(before.total_orders) || 0) + 1);
  assert.ok(Math.abs((Number(afterStore.total_sales) || 0) - ((Number(before.total_sales) || 0) + 300)) < 0.01);
});

test('replaying the same package id is a no-op for its owner', async () => {
  const res = await api('/packages', {
    method: 'POST',
    headers: buyerHeaders(), // the same buyer as the original order
    body: {
      id: 'rules-pkg-1', // same id → replay
      store_id: 'store-msku253he58z',
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', qty: 2, price: 999999 }],
      gross_amount: 999999,
      vendor_amount: 999999,
      total_amount: 999999
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, 'rules-pkg-1');
  assert.equal(Number(res.data.gross_amount), 300, 'replay must not re-mint money');

  const p = await getProd();
  assert.equal(Number(p.stock_qty), 3, 'replay must not re-decrement stock');
  const st = await getStore();
  assert.equal(Number(st.total_orders), 1, 'replay must not double-count stats');

  // (#13) An anonymous caller has no identity to prove, so a guessed id must
  // not hand back the stored order (buyer name, phone, address, totals).
  const anon = await api('/packages', {
    method: 'POST',
    body: { id: 'rules-pkg-1', store_id: 'store-msku253he58z', items: [{ id: 'prod-diag-1', qty: 2 }] }
  });
  assert.equal(anon.status, 409);
  assert.equal(anon.data && anon.data.items, undefined, 'an anonymous replay must not leak the order');
  assert.equal(anon.data && anon.data.gross_amount, undefined);
});

test('overselling is refused with 409 and leaves no side effects', async () => {
  const stBefore = await getStore();
  const res = await api('/packages', {
    method: 'POST',
    body: {
      id: 'rules-pkg-over',
      store_id: 'store-msku253he58z',
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', qty: 10 }],
      gross_amount: 1, vendor_amount: 1, total_amount: 1
    }
  });
  assert.equal(res.status, 409);
  assert.match(String(res.data.error), /Only 3 left/);

  const p = await getProd();
  assert.equal(Number(p.stock_qty), 3, 'refused sale must not touch stock');
  const stAfter = await getStore();
  assert.equal(Number(stAfter.total_orders), Number(stBefore.total_orders));
  assert.equal(Number(stAfter.total_sales), Number(stBefore.total_sales));
});

test('invalid input is refused: empty items, negative price, bogus coupon', async () => {
  const empty = await api('/orders', {
    method: 'POST',
    body: { buyer_id: 'test-buyer', items: [], subtotal: 0, total: 0 }
  });
  assert.equal(empty.status, 400);

  const neg = await api('/products', {
    method: 'POST',
    body: { name: 'Evil', price: -5, stock_qty: 1, vendor_id: 'x' }
  });
  assert.equal(neg.status, 400);

  const coupon = await api('/orders', {
    method: 'POST',
    body: {
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', qty: 1, price: 1 }],
      coupon_code: 'BOGUS50',
      subtotal: 1, total: 1
    }
  });
  assert.equal(coupon.status, 409);
});

test('order totals are server-derived and the order row does not touch stock', async () => {
  const pBefore = await getProd();
  const res = await api('/orders', {
    method: 'POST',
    body: {
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', qty: 1, price: 999999 }],
      subtotal: 1, platform_fee: 0, discount: 99, total: 1 // all spoofed
    }
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(Number(res.data.subtotal), 150);
  assert.equal(Number(res.data.platform_fee), 2.25); // 1.5% of 150
  assert.equal(Number(res.data.discount), 0);        // unvalidated discount dropped
  assert.equal(Number(res.data.total), 152.25);

  const pAfter = await getProd();
  assert.equal(Number(pAfter.stock_qty), Number(pBefore.stock_qty),
    'orders are mirrors — packages own the stock decrement');
});

test('a package mixing another store\'s items is refused with 409 and no side effects', async () => {
  const stBefore = await getStore();
  const pBefore = await getProd();
  const res = await api('/packages', {
    method: 'POST',
    body: {
      id: 'rules-pkg-crossstore',
      store_id: 'store-vendor', // claims a different store...
      buyer_id: 'test-buyer',
      items: [{ id: 'prod-diag-1', qty: 1 }] // ...while the item belongs to store-msku253he58z
    }
  });
  assert.equal(res.status, 409);
  assert.match(String(res.data.error), /not available from this store/);

  const pAfter = await getProd();
  assert.equal(Number(pAfter.stock_qty), Number(pBefore.stock_qty),
    'refused sale must not touch stock');
  const stAfter = await getStore();
  assert.equal(Number(stAfter.total_orders), Number(stBefore.total_orders));
  assert.equal(Number(stAfter.total_sales), Number(stBefore.total_sales));
});
