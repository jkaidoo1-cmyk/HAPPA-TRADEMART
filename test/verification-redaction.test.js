'use strict';
// Verification documents (Ghana Card, proof of sales, link-sharing screenshot)
// are uploaded so an admin can review them ONCE. Before this guard they stayed
// on the user record forever, which meant that anyone who got into the vendor's
// account or the admin panel could download a photo of the vendor's government
// ID — from the vendor's own dashboard, from the admin profile page, or from a
// list response.
//
// Two protections are asserted here:
//
//   1. The write that approves the ID (`id_verified: true`) wipes the photos
//      from the record, including the `extra` mirror used by slim schemas.
//   2. The read path refuses to serve them for an already-verified user, which
//      covers records approved before the wipe rule existed.
//
// This drives api/index.js rather than server.js because Vercel routes
// /api/(.*) there — the same split test/egress.test.js uses.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// server.js overrides the environment from .env on boot, so the parent process
// has to sign with the same secret for a token to be accepted there.
(function resolveFromEnvFile() {
  const envFile = path.join(__dirname, '..', '.env');
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
if (!process.env.SESSION_SECRET) {
  try {
    const secret = fs.readFileSync(path.join(__dirname, '..', '.session-secret'), 'utf-8').trim();
    if (secret) process.env.SESSION_SECRET = secret;
  } catch (e) {}
}
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'verification-redaction-test-secret';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const dataStore = require(path.join('..', 'api', 'data-store'));
// Neutralise persistence before api/index.js captures the module: this suite
// must never write to the checked-in db.json.
dataStore.saveToFile = () => true;

const app = require(path.join('..', 'api', 'index.js'));
const session = require('../lib/session');

// A short, unmistakable marker stands in for the base64 photo bytes.
const DOC = 'data:image/jpeg;base64,VERIFICATION-PHOTO-MUST-NOT-LEAK';
const DOC_FIELDS = ['id_image', 'proof_sales_1', 'proof_sales_2', 'proof_sales_3', 'proof_share'];

const VENDOR_ID = 'vr-vendor-1';
const ADMIN_ID = 'vr-admin-1';
const LEGACY_ID = 'vr-legacy-1'; // approved before the wipe rule, photos still on disk

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
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
  return { status: res.status, data, raw };
}

function auth(userId, role) {
  return { Authorization: `Bearer ${session.createSessionToken(userId, role)}` };
}

function storedUser(id) {
  return (dataStore.getStore().users || []).find(u => String(u.id) === String(id));
}

function docValue(user) {
  return DOC_FIELDS.map(f => user && user[f]).find(v => typeof v === 'string' && v.includes('VERIFICATION-PHOTO'))
    || null;
}

function extraOf(user) {
  const extra = user && user.extra;
  if (!extra) return {};
  if (typeof extra === 'string') { try { return JSON.parse(extra); } catch (e) { return {}; } }
  return extra;
}

before(async () => {
  const store = dataStore.getStore();
  store.users = [
    {
      id: VENDOR_ID, name: 'Verify Vendor', email: 'vr-vendor@test.com', role: 'vendor',
      status: 'active', id_verified: false, is_verified: true,
      password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901',
      id_image: DOC, proof_sales_1: DOC, proof_sales_2: DOC, proof_sales_3: DOC, proof_share: DOC,
    },
    {
      id: ADMIN_ID, name: 'Verify Admin', email: 'vr-admin@test.com', role: 'admin',
      status: 'active', id_verified: false,
      password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901',
    },
    {
      // Approved before the wipe rule shipped: id_verified is true but the
      // photos are still in the row (and mirrored into `extra`).
      id: LEGACY_ID, name: 'Legacy Vendor', email: 'vr-legacy@test.com', role: 'vendor',
      status: 'active', id_verified: true, is_verified: true,
      password_hash: '$2b$10$0123456789012345678901234567890123456789012345678901',
      id_image: DOC, proof_sales_1: DOC, proof_share: DOC,
      extra: { id_image: DOC, proof_share: DOC },
    },
  ];

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  await new Promise(resolve => { server = app.listen(port, '127.0.0.1', resolve); });
});

after(() => {
  if (server) { try { server.close(); } catch (e) {} server = null; }
});

test('an unverified vendor can see the documents they just uploaded', async () => {
  // The admin needs to review them, and the vendor needs to see what is pending,
  // so this state must keep working — the redaction is only for after approval.
  const own = await api(`/users/${VENDOR_ID}`, { headers: auth(VENDOR_ID, 'vendor') });
  assert.equal(own.status, 200, own.raw);
  assert.equal(own.data.id_image, DOC);
  assert.equal(own.data.proof_share, DOC);

  const asAdmin = await api(`/users/${VENDOR_ID}`, { headers: auth(ADMIN_ID, 'admin') });
  assert.equal(asAdmin.status, 200, asAdmin.raw);
  assert.equal(asAdmin.data.id_image, DOC);
});

test('a vendor cannot mark their own ID verified', async () => {
  const res = await api(`/users/${VENDOR_ID}`, {
    method: 'PATCH', headers: auth(VENDOR_ID, 'vendor'), body: { id_verified: true },
  });
  assert.equal(res.status, 403, res.raw);
  assert.equal(storedUser(VENDOR_ID).id_verified, false);
});

test('approving the ID destroys the uploaded documents on the record', async () => {
  const res = await api(`/users/${VENDOR_ID}`, {
    method: 'PATCH', headers: auth(ADMIN_ID, 'admin'), body: { id_verified: true },
  });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.data.id_verified, true);
  assert.equal(docValue(res.data), null, 'the approval response must not echo the photos back');

  const row = storedUser(VENDOR_ID);
  assert.equal(row.id_verified, true);
  assert.equal(docValue(row), null, 'the stored row must no longer hold any document');

  const extra = extraOf(row);
  assert.equal(docValue(extra), null, 'the `extra` mirror must be wiped too');
});

test('a verified vendor is never served their documents again', async () => {
  const own = await api(`/users/${VENDOR_ID}`, { headers: auth(VENDOR_ID, 'vendor') });
  assert.equal(own.status, 200);
  assert.doesNotMatch(own.raw, /VERIFICATION-PHOTO/);

  const asAdmin = await api(`/users/${VENDOR_ID}`, { headers: auth(ADMIN_ID, 'admin') });
  assert.doesNotMatch(asAdmin.raw, /VERIFICATION-PHOTO/);

  const list = await api('/users?limit=200', { headers: auth(ADMIN_ID, 'admin') });
  assert.equal(list.status, 200);
  assert.doesNotMatch(list.raw, /VERIFICATION-PHOTO/,
    'the list path applies the scrub explicitly (sendList bypasses res.json)');
});

test('a record approved before the wipe rule still never serves its documents', async () => {
  // The photos are physically on the record — only the read-side guard stands
  // between them and the admin panel.
  assert.equal(storedUser(LEGACY_ID).id_image, DOC, 'fixture really does hold the photo');

  const asAdmin = await api(`/users/${LEGACY_ID}`, { headers: auth(ADMIN_ID, 'admin') });
  assert.equal(asAdmin.status, 200);
  assert.doesNotMatch(asAdmin.raw, /VERIFICATION-PHOTO/);

  assert.equal(asAdmin.data.id_image, undefined);
  assert.equal(asAdmin.data.proof_share, undefined);
  if (asAdmin.data.extra) {
    assert.equal(docValue(asAdmin.data.extra), null,
      'the nested `extra` copy is not a way around the guard');
  }

  const list = await api('/users?limit=200', { headers: auth(ADMIN_ID, 'admin') });
  assert.doesNotMatch(list.raw, /VERIFICATION-PHOTO/);
});

// The two backends drift easily (server.js is a separate express app). The
// browser talks to server.js in development, so the same rule is proven there
// too — against a real db.json, not an in-memory store.
test('server.js also destroys the documents when it approves an ID', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'happa-verify-'));
  const dbFile = path.join(tmpDir, 'db.json');
  fs.copyFileSync(path.join(ROOT, 'db.json'), dbFile);

  const fixture = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  for (const t of Object.keys(fixture)) {
    if (Array.isArray(fixture[t])) fixture[t] = fixture[t].filter(r => !String((r && r.id) || '').startsWith('vr2-'));
  }
  fixture.users = fixture.users || [];
  fixture.users.push(
    { id: 'vr2-vendor', name: 'Server Vendor', email: 'vr2-vendor@test.com', role: 'vendor', status: 'active', id_verified: false, id_image: DOC, proof_share: DOC },
    { id: 'vr2-admin', name: 'Server Admin', email: 'vr2-admin@test.com', role: 'admin', status: 'active' }
  );
  fs.writeFileSync(dbFile, JSON.stringify(fixture, null, 2));

  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), HAPPA_DB_FILE: dbFile, SESSION_SECRET: process.env.SESSION_SECRET }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const origin = `http://127.0.0.1:${port}/api`;
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('server.js did not start:\n' + log);
      try {
        const r = await fetch(origin + '/settings');
        if (r.ok) break;
      } catch (e) { /* not up yet */ }
      await new Promise(r => setTimeout(r, 150));
    }

    const approved = await fetch(origin + '/users/vr2-vendor', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.createSessionToken('vr2-admin', 'admin')}` },
      body: JSON.stringify({ id_verified: true }),
    });
    assert.equal(approved.status, 200, await approved.text());

    const row = JSON.parse(fs.readFileSync(dbFile, 'utf-8')).users.find(u => u.id === 'vr2-vendor');
    assert.equal(row.id_verified, true);
    assert.equal(docValue(row), null, 'the photo must be deleted from db.json, not just hidden');
    assert.equal(docValue(extraOf(row)), null);

    const read = await fetch(origin + '/users/vr2-vendor', {
      headers: { Authorization: `Bearer ${session.createSessionToken('vr2-vendor', 'vendor')}` },
    });
    assert.equal(read.status, 200);
    assert.doesNotMatch(await read.text(), /VERIFICATION-PHOTO/);
  } finally {
    try { child.kill('SIGKILL'); } catch (e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
});
