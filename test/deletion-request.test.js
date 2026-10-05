'use strict';
// Account-deletion REQUEST workflow.
//
// A user no longer deletes their account outright: they request deletion, every
// public row they own is hidden (store, storefront, products, services, ads),
// and the main admin is notified so they can investigate and run the real
// cascade delete — or restore the account.
//
// Part 1 tests the shared pure logic in lib/deletion.js; part 2 runs the real
// server.js over HTTP against an isolated copy of db.json (development data is
// never touched).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const deletion = require('../lib/deletion');

// ── Shared pure logic ────────────────────────────────────────────────────
test('hideUserContent hides only the target user\'s publicly-visible rows', () => {
  const rows = {
    stores: [
      { id: 's1', vendor_id: 'u1', status: 'active' },
      { id: 's2', vendor_id: 'u2', status: 'active' },
      { id: 's3', vendor_id: 'u1', status: 'suspended' },
    ],
    products: [
      { id: 'p1', vendor_id: 'u1', status: 'active' },
      { id: 'p2', vendor_id: 'u1', status: 'archived' },
      { id: 'p3', vendor_id: 'u1', status: 'sold_out' },
      { id: 'p4', vendor_id: 'u2', status: 'active' },
    ],
    services: [{ id: 'sv1', rendor_id: 'u1', status: 'active' }],
    ad_campaigns: [{ id: 'a1', vendor_id: 'u1', status: 'active' }],
    storefronts: [{ id: 'sf1', vendor_id: 'u1', status: 'active' }],
  };
  const counts = deletion.hideUserContent(rows, 'u1');
  assert.equal(rows.stores[0].status, deletion.PENDING_DELETION);
  assert.equal(rows.stores[1].status, 'active');           // other user untouched
  assert.equal(rows.stores[2].status, 'suspended');        // already hidden, untouched
  assert.equal(rows.products[0].status, deletion.PENDING_DELETION);
  assert.equal(rows.products[1].status, 'archived');       // left alone (restore must not publish it)
  assert.equal(rows.products[2].status, 'sold_out');
  assert.equal(rows.products[3].status, 'active');
  assert.equal(rows.services[0].status, deletion.PENDING_DELETION);
  assert.equal(rows.ad_campaigns[0].status, deletion.PENDING_DELETION);
  assert.equal(rows.storefronts[0].status, deletion.PENDING_DELETION);
  assert.equal(counts.stores, 1);
  assert.equal(counts.products, 1);
});

test('restoreUserContent flips only pending_deletion rows back to active', () => {
  const rows = {
    stores: [
      { id: 's1', vendor_id: 'u1', status: deletion.PENDING_DELETION },
      { id: 's2', vendor_id: 'u2', status: deletion.PENDING_DELETION },
      { id: 's3', vendor_id: 'u1', status: 'suspended' },
    ],
    products: [{ id: 'p1', vendor_id: 'u1', status: deletion.PENDING_DELETION }],
  };
  deletion.restoreUserContent(rows, 'u1');
  assert.equal(rows.stores[0].status, 'active');
  assert.equal(rows.stores[1].status, deletion.PENDING_DELETION); // other user
  assert.equal(rows.stores[2].status, 'suspended');               // never published by restore
  assert.equal(rows.products[0].status, 'active');
});

test('deletionRequestNotification addresses the admin with the requesting user', () => {
  const n = deletion.deletionRequestNotification({ name: 'Ama', email: 'ama@test.com', role: 'vendor' });
  assert.equal(n.user_id, 'admin');
  assert.equal(n.type, 'admin');
  assert.match(n.message, /Ama/);
  assert.match(n.message, /ama@test\.com/);
  assert.ok(n.title);
});

// ── HTTP integration against a spawned server ────────────────────────────
(function resolveFromEnvFile() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq !== -1 && trimmed.slice(0, eq).trim() === 'SESSION_SECRET') {
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

let tmpDir = null;
let dbFile = '';
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
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function auth(userId, role) {
  return { Authorization: `Bearer ${session.createSessionToken(userId, role)}` };
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
}

function findRows(table, key, value) {
  return (readDb()[table] || []).filter(r => String(r[key]) === String(value));
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happa-del-'));
  dbFile = path.join(tmpDir, 'db.json');
  fs.copyFileSync(path.join(ROOT, 'db.json'), dbFile);

  const db = readDb();
  const isFixture = id => String(id || '').startsWith('del-');
  for (const t of ['users', 'stores', 'storefronts', 'products', 'services', 'ad_campaigns', 'notifications']) {
    db[t] = (db[t] || []).filter(r => !isFixture(r && r.id));
  }

  const hash = '$2b$10$0123456789012345678901234567890123456789012345678901';
  db.users.push(
    { id: 'del-vendor-1', name: 'Del Vendor One', email: 'del-vendor-1@test.com', role: 'vendor', status: 'active', password_hash: hash },
    { id: 'del-buyer-1', name: 'Del Buyer One', email: 'del-buyer-1@test.com', role: 'buyer', status: 'active', password_hash: hash },
    { id: 'del-admin-1', name: 'Del Admin One', email: 'del-admin-1@test.com', role: 'admin', status: 'active', password_hash: hash }
  );
  db.stores.push({ id: 'del-store-1', name: 'Del Store', slug: 'del-store', vendor_id: 'del-vendor-1', status: 'active' });
  db.storefronts.push({ id: 'del-sf-1', store_id: 'del-store-1', vendor_id: 'del-vendor-1', status: 'active' });
  db.products.push({ id: 'del-prod-1', name: 'Del Product', price: 100, stock_qty: 5, store_id: 'del-store-1', vendor_id: 'del-vendor-1', status: 'active' });
  db.services.push({ id: 'del-svc-1', rendor_id: 'del-vendor-1', status: 'active' });
  db.ad_campaigns.push({ id: 'del-ad-1', vendor_id: 'del-vendor-1', status: 'active' });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), HAPPA_DB_FILE: dbFile, SESSION_SECRET }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const deadline = Date.now() + 15000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('server.js did not start:\n' + log);
    try {
      const r = await fetch(base + '/settings');
      if (r.ok) break;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
});

after(() => {
  if (child) { try { child.kill('SIGKILL'); } catch (e) {} child = null; }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} tmpDir = null; }
});

test('guests cannot request deletion', async () => {
  const res = await api('/auth/request-deletion', { method: 'POST' });
  assert.equal(res.status, 401, JSON.stringify(res.data));
});

test('the main admin cannot request deletion', async () => {
  const res = await api('/auth/request-deletion', { method: 'POST', headers: auth('admin', 'admin') });
  assert.equal(res.status, 400, JSON.stringify(res.data));
});

test('a request hides the user\'s public rows and notifies the admin', async () => {
  const res = await api('/auth/request-deletion', { method: 'POST', headers: auth('del-vendor-1', 'vendor') });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.status, 'pending_deletion');

  const user = findRows('users', 'id', 'del-vendor-1')[0];
  assert.equal(user.status, 'pending_deletion');
  assert.ok(user.deletion_requested_at, 'request timestamp stored');

  assert.equal(findRows('stores', 'id', 'del-store-1')[0].status, 'pending_deletion');
  assert.equal(findRows('storefronts', 'id', 'del-sf-1')[0].status, 'pending_deletion');
  assert.equal(findRows('products', 'id', 'del-prod-1')[0].status, 'pending_deletion');
  assert.equal(findRows('services', 'id', 'del-svc-1')[0].status, 'pending_deletion');
  assert.equal(findRows('ad_campaigns', 'id', 'del-ad-1')[0].status, 'pending_deletion');

  const adminNotifs = findRows('notifications', 'user_id', 'admin').filter(n => /deletion/i.test(n.title));
  assert.equal(adminNotifs.length, 1, 'exactly one admin notification');
});

test('a repeat request is idempotent (no second notification)', async () => {
  const res = await api('/auth/request-deletion', { method: 'POST', headers: auth('del-vendor-1', 'vendor') });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.alreadyRequested, true);
  const adminNotifs = findRows('notifications', 'user_id', 'admin').filter(n => /deletion/i.test(n.title));
  assert.equal(adminNotifs.length, 1);
});

test('a non-admin cannot restore a pending account', async () => {
  const res = await api('/auth/deletion/restore', { method: 'POST', headers: auth('del-buyer-1', 'buyer'), body: { user_id: 'del-vendor-1' } });
  assert.equal(res.status, 403, JSON.stringify(res.data));
});

test('an admin restore clears the request and republishes the hidden rows', async () => {
  const res = await api('/auth/deletion/restore', { method: 'POST', headers: auth('del-admin-1', 'admin'), body: { user_id: 'del-vendor-1' } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.status, 'active');

  assert.equal(findRows('users', 'id', 'del-vendor-1')[0].status, 'active');
  assert.equal(findRows('stores', 'id', 'del-store-1')[0].status, 'active');
  assert.equal(findRows('storefronts', 'id', 'del-sf-1')[0].status, 'active');
  assert.equal(findRows('products', 'id', 'del-prod-1')[0].status, 'active');
  assert.equal(findRows('services', 'id', 'del-svc-1')[0].status, 'active');
  assert.equal(findRows('ad_campaigns', 'id', 'del-ad-1')[0].status, 'active');
});

test('restoring an account with no open request is refused', async () => {
  const res = await api('/auth/deletion/restore', { method: 'POST', headers: auth('del-admin-1', 'admin'), body: { user_id: 'del-buyer-1' } });
  assert.equal(res.status, 400, JSON.stringify(res.data));
});
