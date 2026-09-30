'use strict';
// Egress guards for api/index.js (the Vercel production path).
//
// Two things are asserted, both of which were real bugs:
//
//   1. `GET /api/storefronts` ignored `limit` entirely — it returned every
//      storefront no matter what the caller asked for (admin.js asks for 200),
//      so the response was always larger than anyone wanted.
//   2. Saving a storefront mirrored the logo/banner data URLs into the `extra`
//      JSONB column *in addition to* their real columns. Every store therefore
//      carried each image twice, so every list read moved roughly double the
//      bytes it needed to. `writeWithCandidates` already covers the
//      missing-column case that the mirror was there for.
//
// Unlike the other suites this drives api/index.js directly rather than
// spawning server.js, because server.js is not what serves production traffic:
// vercel.json routes /api/(.*) to api/index.js.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

// Must be set before lib/session (and therefore api/index.js) is required.
process.env.SESSION_SECRET = 'egress-test-secret-not-a-real-secret';
// api/index.js never loads .env, but be explicit: getSupabase() must return
// null so this suite exercises the local data store and can never reach the
// deployed database.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const path = require('node:path');
const dataStore = require(path.join('..', 'api', 'data-store'));

// data-store writes to the real db.json on saveToFile(). Neutralise that before
// api/index.js captures the module, so this suite can never mutate the repo's
// checked-in data.
let fileWrites = 0;
dataStore.saveToFile = () => { fileWrites++; return true; };

const app = require(path.join('..', 'api', 'index.js'));
const session = require('../lib/session');

const STORE_IDS = ['sf-1', 'sf-2', 'sf-3', 'sf-4', 'sf-5'];
const ADMIN_ID = 'sf-admin-1';

const LOGO = 'data:image/jpeg;base64,' + 'L'.repeat(4096);
const BANNER = 'data:image/jpeg;base64,' + 'B'.repeat(4096);

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
  let raw = '';
  try {
    raw = await res.text();
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {}
  return { status: res.status, data, raw, headers: res.headers };
}

before(async () => {
  const store = dataStore.getStore();
  store.users = [{
    id: ADMIN_ID, name: 'Egress Admin', email: 'egress-admin@test.com',
    role: 'admin', status: 'active',
    password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901'
  }];
  store.stores = STORE_IDS.map((id, i) => ({
    id,
    vendor_id: 'sf-vendor-' + (i + 1),
    name: 'Store ' + (i + 1),
    slug: 'store-' + (i + 1),
    category: 'General',
    location: 'Accra',
    status: 'active',
    storefront_status: 'active',
    extra: {}
  }));
  store.storefronts = [];

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  await new Promise(resolve => { server = app.listen(port, '127.0.0.1', resolve); });
});

after(() => {
  if (server) { try { server.close(); } catch (e) {} server = null; }
});

function adminAuth() {
  return { Authorization: `Bearer ${session.createSessionToken(ADMIN_ID, 'admin')}` };
}

test('egress: GET /api/storefronts honours limit instead of returning every store', async () => {
  const all = await api('/storefronts');
  assert.equal(all.status, 200);
  assert.equal(all.data.data.length, STORE_IDS.length, 'the unlimited read still returns everything');

  const one = await api('/storefronts?limit=1');
  assert.equal(one.status, 200);
  assert.equal(one.data.data.length, 1, 'limit=1 must not return all 5 storefronts');

  const three = await api('/storefronts?limit=3');
  assert.equal(three.data.data.length, 3);

  const paged = await api('/storefronts?limit=2&page=2');
  assert.equal(paged.data.data.length, 2, 'page 2 of 2-per-page over 5 rows holds 2 rows');
});

test('egress: a bounded stores read is bounded too', async () => {
  const res = await api('/stores?limit=2');
  assert.equal(res.status, 200);
  assert.equal(res.data.data.length, 2);
});

test('egress: saving a storefront does not duplicate the images into `extra`', async () => {
  const res = await api('/storefronts/sft-sf-1', {
    method: 'PATCH',
    headers: adminAuth(),
    body: { name: 'Renamed Store', logo_url: LOGO, banner_url: BANNER, slogan: 'Fresh' }
  });
  assert.ok(res.status === 200 || res.status === 204, `unexpected status ${res.status}`);

  const row = dataStore.getStore().stores.find(s => String(s.id) === 'sf-1');
  assert.ok(row, 'the store row must still exist');

  // The image must survive, on its real column.
  assert.equal(row.logo_url, LOGO, 'logo_url must be persisted on its column');
  assert.equal(row.banner_url, BANNER, 'banner_url must be persisted on its column');

  const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : (row.extra || {});
  assert.equal(extra.logo_url, undefined,
    'logo_url must NOT also be stored in `extra` — that doubled every store read');
  assert.equal(extra.banner_url, undefined,
    'banner_url must NOT also be stored in `extra` — that doubled every store read');

  // The small, non-image fields are still mirrored — the read path uses them as
  // fallbacks (st.extra.layout, extra.slogan). `name` is not asserted here only
  // because this PATCH branch has never written it (it sets no storeUpdates.name).
  assert.equal(extra.slogan, 'Fresh', 'small fields keep their `extra` fallback');
});

test('egress: a repeat list read is answered with an empty 304', async () => {
  const first = await api('/storefronts?limit=3');
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'list reads must carry an ETag or nothing can revalidate');
  assert.match(String(first.headers.get('vary') || ''), /Authorization/i,
    'a viewer-specific body must never be shared between viewers');
  assert.ok(first.raw.length > 0, 'the first read sends the body');

  // Byte-identical second read: no body crosses the wire.
  const second = await api('/storefronts?limit=3', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304, 'an unchanged list must be a 304');
  assert.equal(second.raw, '', 'a 304 must carry no body');

  // Same data, same tag — it is derived from the content, not the clock.
  const third = await api('/storefronts?limit=3');
  assert.equal(third.headers.get('etag'), etag, 'the ETag is stable for unchanged data');

  // Now change the data: the stale tag must NOT be honoured. Rename a row that
  // is actually inside the requested page, or the payload would be unchanged
  // and a 304 would be the correct answer.
  const target = dataStore.getStore().stores.find(s => String(s.id) === 'sf-1');
  target.name = 'Renamed After Cache';
  const changed = await api('/storefronts?limit=3', { headers: { 'If-None-Match': etag } });
  assert.equal(changed.status, 200, 'changed data must be sent, not 304-ed');
  assert.notEqual(changed.headers.get('etag'), etag, 'changed data gets a new ETag');
  assert.match(changed.raw, /Renamed After Cache/);

  // A weak validator for the same bytes is also acceptable.
  const weak = await api('/storefronts?limit=3', { headers: { 'If-None-Match': 'W/' + changed.headers.get('etag') } });
  assert.equal(weak.status, 304);
});

test('egress: list reads never leak password_hash (sendList bypasses res.json)', async () => {
  // res.json is globally wrapped with scrubSensitive, but sendList writes the
  // body itself, so it has to apply the scrub — this guards that.
  const users = await api('/users?limit=50');
  assert.equal(users.status, 200);
  assert.doesNotMatch(users.raw, /password_hash/, 'no bcrypt hash in a public list');

  const asAdmin = await api('/users?limit=50', { headers: adminAuth() });
  assert.equal(asAdmin.status, 200);
  assert.doesNotMatch(asAdmin.raw, /password_hash/, 'not even for an admin list');

  // The fixture really does carry one, so the assertions above mean something.
  const row = dataStore.getStore().users.find(u => String(u.id) === ADMIN_ID);
  assert.ok(row.password_hash, 'the fixture must hold a hash for this test to be meaningful');
});

// The database-side bound only engages on the Supabase path, so drive that path
// with a minimal PostgREST stand-in. It answers /rest/v1/stores with JSON and
// records the `Range` header supabase-js sent, which is what proves the page
// offset is applied once and only once.
test('egress: the stores query is bounded inside the database, and pages only once', async () => {
  const http = require('node:http');

  const CATALOGUE = Array.from({ length: 6 }, (_, i) => ({
    id: 'db-store-' + (i + 1),
    vendor_id: 'db-vendor-' + (i + 1),
    name: 'DB Store ' + (i + 1),
    slug: 'db-store-' + (i + 1),
    storefront_status: 'active',
    extra: {}
  }));

  // supabase-js asks for a window with `offset`/`limit` query params (it does
  // not send a Range header), and PostgREST honours them. The stub honours them
  // too, so a query that skipped the page twice would come back empty.
  const queries = [];
  const stub = http.createServer((req, res) => {
    const url = String(req.url || '');
    queries.push(url);
    const qs = new URLSearchParams(url.split('?')[1] || '');
    const offset = parseInt(qs.get('offset') || '0', 10) || 0;
    const limit = parseInt(qs.get('limit') || '', 10) || CATALOGUE.length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(CATALOGUE.slice(offset, offset + limit)));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const stubPort = stub.address().port;

  const localStore = dataStore.getStore();
  const savedLocalStores = localStore.stores;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_KEY;

  try {
    process.env.SUPABASE_URL = `http://127.0.0.1:${stubPort}`;
    process.env.SUPABASE_KEY = 'stub-anon-key';

    // A range is only sound when the local fallback holds no `stores` rows.
    localStore.stores = [];

    const page1 = await api('/storefronts?limit=2');
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.data.data.map(s => s.id), ['db-store-1', 'db-store-2']);
    assert.match(queries[queries.length - 1], /offset=0/, 'page 1 starts at row 0');
    assert.match(queries[queries.length - 1], /limit=2/, 'page 1 fetches only 2 rows');

    const page2 = await api('/storefronts?limit=2&page=2');
    assert.equal(page2.status, 200);
    assert.deepEqual(page2.data.data.map(s => s.id), ['db-store-3', 'db-store-4'],
      'page 2 is the second pair, not nothing');
    // The fetch is capped from row 0 and the page is applied afterwards by the
    // slice, so the offset is applied exactly once. Pushing the page offset into
    // the query as well would ask the database for rows 2-3 and then slice the
    // two rows it got back from index 2 — i.e. an empty page.
    assert.match(queries[queries.length - 1], /offset=0/, 'the query never skips the page itself');
    assert.match(queries[queries.length - 1], /limit=4/, 'the fetch is capped at the end of page 2');

    // With a local-only store present, merging could promote a row into the
    // requested page, so the query must NOT be bounded.
    localStore.stores = savedLocalStores;
    await api('/storefronts?limit=2');
    assert.doesNotMatch(queries[queries.length - 1], /limit=/,
      'a non-empty local fallback must disable the database-side bound');
  } finally {
    localStore.stores = savedLocalStores;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = savedKey;
    await new Promise(resolve => stub.close(resolve));
  }
});

test('otp test mode: code is returned with the flag and 503 without it', async () => {
  // The admin fixture has no phone unless we add one; request-otp requires it.
  const store = dataStore.getStore();
  const admin = store.users.find(u => u.id === ADMIN_ID);
  const savedPhone = admin.phone;
  admin.phone = '+233201234567';
  const savedMode = process.env.OTP_TEST_MODE;
  const savedTermii = process.env.TERMII_API_KEY;
  try {
    // 1. Without the flag and without a provider → the honest 503.
    delete process.env.OTP_TEST_MODE;
    delete process.env.TERMII_API_KEY;
    const refused = await api('/auth/request-otp', { method: 'POST', headers: adminAuth(), body: {} });
    assert.equal(refused.status, 503, JSON.stringify(refused.data));
    assert.ok(!refused.data.test_code, 'no code may leak without the flag');

    // 2. With OTP_TEST_MODE=1 → code returned, channel test-mode, and the
    //    code actually verifies the account end-to-end.
    process.env.OTP_TEST_MODE = '1';
    const issued = await api('/auth/request-otp', { method: 'POST', headers: adminAuth(), body: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.channel, 'test-mode');
    assert.ok(/^\d{6}$/.test(issued.data.test_code || ''), 'a 6-digit test_code is returned');

    const verified = await api('/auth/verify-phone', { method: 'POST', headers: adminAuth(), body: { code: issued.data.test_code } });
    assert.equal(verified.status, 200, JSON.stringify(verified.data));
    assert.equal(verified.data.is_verified, true);
  } finally {
    admin.phone = savedPhone;
    if (savedMode === undefined) delete process.env.OTP_TEST_MODE; else process.env.OTP_TEST_MODE = savedMode;
    if (savedTermii === undefined) delete process.env.TERMII_API_KEY; else process.env.TERMII_API_KEY = savedTermii;
  }
});