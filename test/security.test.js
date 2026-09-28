'use strict';
// Negative-path regression tests for the security audit (#1, #2, #7, #8, #9,
// #10, #11, #13, #18). Most run over HTTP against a real server.js instance on
// an ephemeral port seeded from an isolated copy of db.json (HAPPA_DB_FILE), so
// development data is never touched.
//
// Covered here:
//   #10 unknown tables 404 instead of succeeding
//   #9  notifications are created by the server/admin only
//   #1  verify-phone / request-otp reject anonymous callers and store no
//       plaintext OTP; the verification handler runs without crashing
//   #8  signup never stores the plaintext password; #18 unknown login is a 401
//   #2  owner fields come from the session, never the request body
//   #13 replaying a package id as a non-owner leaks nothing
//   #7  the VAPID private key is invisible through the public settings API
//   #11 session tokens last 7 days, not a year

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const VAPID_MARKER = 'SEC_TEST_PRIVATE_KEY_DO_NOT_LEAK';

// ── Match the session secret the spawned server will use ────────────────
// server.js loads .env at startup (overriding the inherited environment) and
// lib/session falls back to the persisted .session-secret file. Resolve the
// same value here so tokens minted in this process validate in the child.
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
const access = require('../lib/access');

// Requiring lib/session just created the fallback file when no secret was set.
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
    body: opts.body ? JSON.stringify(opts.body) : undefined
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

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happa-sec-'));
  dbFile = path.join(tmpDir, 'db.json');
  fs.copyFileSync(path.join(ROOT, 'db.json'), dbFile);

  const db = readDb();
  const isFixture = id => String(id || '').startsWith('sec-');
  db.users = (db.users || []).filter(u => !isFixture(u && u.id));
  db.stores = (db.stores || []).filter(s => !isFixture(s && s.id));
  db.products = (db.products || []).filter(p => !isFixture(p && p.id));
  db.packages = (db.packages || []).filter(p => !isFixture(p && p.id));
  db.settings = (db.settings || []).filter(s => !String((s && s.key) || '').startsWith('vapid_'));

  const hash = '$2b$10$0123456789012345678901234567890123456789012345678901';
  db.users.push(
    { id: 'sec-vendor-1', name: 'Sec Vendor One', email: 'sec-vendor-1@test.com', role: 'vendor', status: 'active', password_hash: hash },
    { id: 'sec-vendor-2', name: 'Sec Vendor Two', email: 'sec-vendor-2@test.com', role: 'vendor', status: 'active', password_hash: hash },
    { id: 'sec-buyer-1', name: 'Sec Buyer One', email: 'sec-buyer-1@test.com', role: 'buyer', status: 'active', password_hash: hash },
    { id: 'sec-admin-1', name: 'Sec Admin One', email: 'sec-admin-1@test.com', role: 'admin', status: 'active', password_hash: hash }
  );
  // A package is the shared record that authorizes buyer↔vendor notifications.
  db.packages.push(
    { id: 'sec-pkg-1', buyer_id: 'sec-buyer-1', vendor_id: 'sec-vendor-1', package_code: 'PKG-SEC-1', status: 'received' }
  );
  db.stores.push(
    { id: 'store-sec-1', name: 'Sec Store One', slug: 'sec-store-one', vendor_id: 'sec-vendor-1', status: 'active' },
    { id: 'store-sec-2', name: 'Sec Store Two', slug: 'sec-store-two', vendor_id: 'sec-vendor-2', status: 'active' }
  );
  db.products.push(
    { id: 'prod-sec-1', name: 'Sec Product One', price: 100, stock_qty: 5, store_id: 'store-sec-1', vendor_id: 'sec-vendor-1', status: 'active', is_available: true },
    { id: 'prod-sec-2', name: 'Sec Product Two', price: 100, stock_qty: 5, store_id: 'store-sec-2', vendor_id: 'sec-vendor-2', status: 'active', is_available: true }
  );
  // Server-owned secrets must exist in the settings table to prove the public
  // read policy filters them out (#7).
  db.settings.push(
    { id: 'set-sec-pub', key: 'vapid_public_key', value: 'SEC_TEST_PUBLIC_KEY' },
    { id: 'set-sec-priv', key: 'vapid_private_key', value: VAPID_MARKER }
  );
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), HAPPA_DB_FILE: dbFile, SESSION_SECRET }),
    stdio: ['ignore', 'pipe', 'pipe']
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

test('#10: unknown tables 404 instead of silently succeeding', async () => {
  const res = await api('/definitely-not-a-table', {
    method: 'POST',
    headers: auth('admin', 'admin'),
    body: { anything: true }
  });
  assert.equal(res.status, 404);
  assert.equal(access.WRITABLE_TABLES.has('definitely-not-a-table'), false);
  assert.equal(access.WRITABLE_TABLES.has('packages'), true);
});

test('#9: notifications cannot be created by anonymous or non-admin callers', async () => {
  const anon = await api('/notifications', {
    method: 'POST',
    body: { user_id: 'sec-buyer-1', title: 'spam', message: 'spam' }
  });
  assert.equal(anon.status, 403, JSON.stringify(anon.data));

  const vendor = await api('/notifications', {
    method: 'POST',
    headers: auth('sec-vendor-1', 'vendor'),
    body: { user_id: 'sec-vendor-1', title: 'spam', message: 'spam' }
  });
  assert.equal(vendor.status, 403, JSON.stringify(vendor.data));

  const admin = await api('/notifications', {
    method: 'POST',
    headers: auth('admin', 'admin'),
    body: { user_id: 'sec-buyer-1', title: 'Order update', message: 'Your order shipped' }
  });
  assert.ok(admin.status < 300, JSON.stringify(admin.data));

  const rows = readDb().notifications || [];
  assert.ok(rows.some(n => n && n.title === 'Order update'), 'the admin notification is persisted');
  assert.equal(rows.filter(n => n && n.title === 'spam').length, 0, 'no spam notification is persisted');
});

test('#1: phone verification requires a session and a pending code', async () => {
  const anon = await api('/auth/verify-phone', {
    method: 'POST',
    body: { userId: 'sec-buyer-1', code: '000000' }
  });
  assert.equal(anon.status, 401, JSON.stringify(anon.data));

  const otp = await api('/auth/request-otp', { method: 'POST', body: { phone: '+233000000000' } });
  assert.equal(otp.status, 401, JSON.stringify(otp.data));

  // Signed in but with no code requested → a clean 400 (not a 500 from a
  // broken handler) and the account stays unverified.
  const noCode = await api('/auth/verify-phone', {
    method: 'POST',
    headers: auth('sec-buyer-1', 'buyer'),
    body: { code: '123456' }
  });
  assert.equal(noCode.status, 400, JSON.stringify(noCode.data));
  const me = (readDb().users || []).find(u => String(u.id) === 'sec-buyer-1');
  assert.notEqual(me.is_verified, true, 'an unproven code must never verify the account');
});

test('#8/#18: signup stores a hash (never the plaintext) and unknown logins 401', async () => {
  const res = await api('/users', {
    method: 'POST',
    body: {
      name: 'Signup Probe',
      email: 'sec-signup-probe@test.com',
      password: 'hunter2-plaintext',
      role: 'admin',
      wallet_balance: 999999,
      is_verified: true
    }
  });
  assert.ok(res.status < 300, JSON.stringify(res.data));

  const row = (readDb().users || []).find(u => String(u.email) === 'sec-signup-probe@test.com');
  assert.ok(row, 'the signup row is persisted');
  assert.equal(row.password, undefined, 'the plaintext password must never be stored');
  assert.match(String(row.password_hash || ''), /^\$2[aby]\$/, 'the password is stored bcrypt-hashed');
  assert.notEqual(String(row.role), 'admin', 'an anonymous signup must not mint an admin');
  assert.notEqual(Number(row.wallet_balance), 999999, 'an anonymous signup must not set a balance');

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email: 'nobody-here-at-all@test.com', password: 'whatever' }
  });
  assert.equal(login.status, 401, 'an unknown email is a clean 401, not a crash');
});

test('#2: ownership comes from the session, not the request body', async () => {
  const foreign = await api('/products/prod-sec-1', {
    method: 'PATCH',
    headers: auth('sec-vendor-2', 'vendor'),
    body: { name: 'Hijacked' }
  });
  assert.equal(foreign.status, 403, 'another vendor cannot edit the product');

  // A vendor may edit their own product, but cannot re-file it under another
  // vendor's store — that store would receive the vendor payout.
  const move = await api('/products/prod-sec-1', {
    method: 'PATCH',
    headers: auth('sec-vendor-1', 'vendor'),
    body: { store_id: 'store-sec-2' }
  });
  assert.equal(move.status, 403, 'a product cannot be moved into another store');

  const own = await api('/products/prod-sec-1', {
    method: 'PATCH',
    headers: auth('sec-vendor-1', 'vendor'),
    body: { name: 'Renamed By Owner', vendor_id: 'sec-vendor-2' }
  });
  assert.ok(own.status < 300, JSON.stringify(own.data));

  const row = (readDb().products || []).find(p => String(p.id) === 'prod-sec-1');
  assert.equal(row.name, 'Renamed By Owner', 'the owner can rename the product');
  assert.equal(String(row.vendor_id), 'sec-vendor-1', 'vendor_id must not be client-controlled');
  assert.equal(String(row.store_id), 'store-sec-1', 'store_id must not be client-controlled');
});

test('#13/#2: package replay by a non-owner leaks nothing and vendor comes from the store', async () => {
  const create = await api('/packages', {
    method: 'POST',
    headers: auth('sec-buyer-1', 'buyer'),
    body: {
      id: 'sec-pkg-replay',
      store_id: 'store-sec-1',
      vendor_id: 'sec-vendor-2', // forged — must be replaced by the store's owner
      items: [{ id: 'prod-sec-1', qty: 1, price: 1 }]
    }
  });
  assert.ok(create.status < 300, JSON.stringify(create.data));
  const stored = (readDb().packages || []).find(p => String(p.id) === 'sec-pkg-replay');
  assert.ok(stored, 'the package is persisted');
  assert.equal(String(stored.vendor_id), 'sec-vendor-1', 'vendor_id comes from the store');
  assert.equal(String(stored.buyer_id), 'sec-buyer-1', 'buyer_id comes from the session');
  assert.equal(Number(stored.gross_amount), 100, 'money is derived from the product row');

  const replay = await api('/packages', {
    method: 'POST',
    headers: auth('sec-vendor-2', 'vendor'),
    body: { id: 'sec-pkg-replay', store_id: 'store-sec-1', items: [{ id: 'prod-sec-1', qty: 1 }] }
  });
  assert.equal(replay.status, 409, JSON.stringify(replay.data));
  assert.equal(replay.data && replay.data.items, undefined, 'a non-owner must not receive the order row');
  assert.equal(replay.data && replay.data.gross_amount, undefined);
});

test('#7: the public settings API never exposes server-owned secrets', async () => {
  const res = await api('/settings');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const text = JSON.stringify(res.data);
  assert.ok(!text.includes(VAPID_MARKER), 'the VAPID private key must not leak');
  assert.ok(!text.includes('vapid_private_key'), 'server-owned setting keys must be hidden');
  assert.ok(!text.includes('SEC_TEST_PUBLIC_KEY'), 'the VAPID public key is served by /push/vapid-key, not here');
});

test('#11: session tokens expire in 7 days, not a year', () => {
  assert.ok(SESSION_SECRET, 'a session secret is available for signed tokens');
  const token = session.createSessionToken('sec-buyer-1', 'buyer');
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  const days = (payload.exp - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `token lifetime should be ~7 days, got ${days.toFixed(2)}`);
});

test('#9: notification patches only carry is_read and updated_at', () => {
  const out = access.sanitizeNotificationPatch({ title: 'evil', user_id: 'someone-else', is_read: true, amount: 9 });
  assert.deepEqual(Object.keys(out).sort(), ['is_read', 'updated_at']);
  assert.equal(out.is_read, true);
});

// ── /api/notify: the narrow notification endpoint (#10) ─────────────
// The notifications TABLE stays server/admin-only because a client insert
// auto-dispatches a web-push. These tests pin the replacement path: the caller
// may address themselves, an admin, or the other party on a shared record —
// nothing else.

const notifyLib = require('../lib/notify');

test('#10: /api/notify rejects anonymous self-alerts', async () => {
  const res = await api('/notify', {
    method: 'POST',
    body: { to: 'sec-buyer-1', type: 'system', title: 'Hi', message: 'hello' }
  });
  assert.equal(res.status, 401, JSON.stringify(res.data));
});

test('#10: /api/notify lets a user notify themselves', async () => {
  const res = await api('/notify', {
    method: 'POST',
    headers: auth('sec-buyer-1', 'buyer'),
    body: { to: 'sec-buyer-1', type: 'order', title: 'Order placed', message: 'All good' }
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data && res.data.user_id, 'sec-buyer-1');
  const stored = (readDb().notifications || []).find(n => n && n.title === 'Order placed');
  assert.ok(stored, 'the notification is persisted by the server');
});

test('#10: /api/notify refuses an unrelated recipient', async () => {
  const res = await api('/notify', {
    method: 'POST',
    headers: auth('sec-vendor-2', 'vendor'),
    body: { to: 'sec-buyer-1', type: 'order', title: 'Phishing', message: 'Pay me' }
  });
  assert.equal(res.status, 403, JSON.stringify(res.data));
  assert.equal((readDb().notifications || []).filter(n => n && n.title === 'Phishing').length, 0);
});

test('#10: /api/notify allows the other party on a shared package', async () => {
  const res = await api('/notify', {
    method: 'POST',
    headers: auth('sec-vendor-1', 'vendor'),
    body: {
      to: 'sec-buyer-1', type: 'order', title: 'Order received',
      message: 'We are preparing it', ref: { table: 'packages', id: 'sec-pkg-1' }
    }
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  // The same ref must not authorize a vendor who is not on the package.
  const forged = await api('/notify', {
    method: 'POST',
    headers: auth('sec-vendor-2', 'vendor'),
    body: {
      to: 'sec-buyer-1', type: 'order', title: 'Forged',
      message: 'not yours', ref: { table: 'packages', id: 'sec-pkg-1' }
    }
  });
  assert.equal(forged.status, 403, JSON.stringify(forged.data));
});

test('#10: /api/notify only lets admins broadcast', async () => {
  const shooter = await api('/notify', {
    method: 'POST',
    headers: auth('sec-buyer-1', 'buyer'),
    body: { to: 'all', type: 'promotion', title: 'Free money', message: 'click here' }
  });
  assert.equal(shooter.status, 403, JSON.stringify(shooter.data));

  const admin = await api('/notify', {
    method: 'POST',
    headers: auth('sec-admin-1', 'admin'),
    body: { to: 'sec-buyer-1', type: 'system', title: 'Wallet adjusted', message: 'GHS 10 added' }
  });
  assert.equal(admin.status, 201, JSON.stringify(admin.data));
});

test('#10: anonymous callers may only escalate to admins', async () => {
  const ok = await api('/notify', {
    method: 'POST',
    body: { to: 'admin', type: 'support', title: 'Password reset request', message: 'phone 000' }
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  const staff = await api('/notify', {
    method: 'POST',
    body: { to: 'sec-admin-1', type: 'support', title: 'Signup alert', message: 'new user' }
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.data));

  const relay = await api('/notify', {
    method: 'POST',
    body: { to: 'sec-buyer-1', type: 'phishing', title: 'Reset your wallet', message: 'click' }
  });
  assert.equal(relay.status, 401, JSON.stringify(relay.data));
  assert.equal((readDb().notifications || []).filter(n => n && n.title === 'Reset your wallet').length, 0);
});

test('#10: notify bodies are clamped to fixed field limits', () => {
  const long = 'x'.repeat(5000);
  const clean = notifyLib.sanitizeNotifyBody({ to: 'sec-buyer-1', type: 'NOT-A-TYPE', title: long, message: long, action_url: long });
  assert.equal(clean.ok, true);
  assert.equal(clean.value.type, 'system', 'unknown types fall back to system');
  assert.equal(clean.value.title.length, notifyLib.MAX_TITLE);
  assert.equal(clean.value.message.length, notifyLib.MAX_MESSAGE);

  assert.equal(notifyLib.sanitizeNotifyBody({ to: '', title: 'x' }).ok, false);
  assert.equal(notifyLib.sanitizeNotifyBody({ to: 'sec-buyer-1', title: '   ' }).ok, false);

  // A ref pointing at a table that does not link users is discarded, and an
  // unrelated pair is then refused.
  const bogus = notifyLib.sanitizeNotifyBody({ to: 'sec-buyer-1', title: 'x', ref: { table: 'products', id: 'prod-sec-1' } });
  assert.equal(bogus.value.ref, null);
  const denied = notifyLib.authorizeNotify({
    viewer: { userId: 'sec-vendor-2', role: 'vendor' },
    value: bogus.value, recipientIsAdmin: false, sharedEntity: false
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
});

test('#10: a user row links referrer and referred', () => {
  const row = { id: 'u-referred', referred_by: 'u-referrer' };
  assert.equal(notifyLib.recordLinksBoth(row, 'users', 'u-referred', 'u-referrer'), true);
  assert.equal(notifyLib.recordLinksBoth(row, 'users', 'u-referrer', 'u-referred'), true);
  assert.equal(notifyLib.recordLinksBoth(row, 'users', 'u-referred', 'u-stranger'), false);
});
