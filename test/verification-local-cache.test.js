'use strict';
// The browser half of the verification-document rule.
//
// test/verification-redaction.test.js proves the server never serves a verified
// user's ID photos. That is not enough on its own: a device that cached the
// account BEFORE the admin approved it still holds the base64 photos in
// localStorage — the session snapshot, the offline `users` table and the
// admin's loaded user list. Hiding them on read would leave the bytes on disk,
// readable from devtools on a shared or stolen device, so js/utils.js rewrites
// those keys on boot (purgeVerifiedDocsFromStorage).
//
// js/utils.js is a browser script, so it is executed here in a vm with the
// few globals it touches at load time stubbed out. That means these assertions
// exercise the real functions rather than pattern-matching their source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const DOC = 'data:image/jpeg;base64,VERIFICATION-PHOTO-MUST-NOT-LEAK';

function makeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

// Evaluates js/utils.js and hands back its top-level bindings plus the storage
// it wrote through. `sandbox.localStorage` is injected by the caller so a test
// can inspect exactly what was persisted.
function loadUtils(storage) {
  const noop = () => {};
  const sandbox = {
    localStorage: storage,
    console,
    setTimeout,
    clearTimeout,
    window: { addEventListener: noop, location: { href: '' }, matchMedia: () => ({ matches: false }) },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, body: {} },
    navigator: { userAgent: 'node-test' },
    fetch: () => Promise.reject(new Error('no network in this test')),
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('js/utils.js'), sandbox, { filename: 'js/utils.js' });
  return sandbox;
}

test('a verified record loses its documents, an unverified one keeps them', () => {
  const sandbox = loadUtils(makeStorage());
  const strip = sandbox.stripVerifyDocs;

  const verified = {
    id: 'u1', id_verified: true, name: 'Verified',
    id_image: DOC, proof_sales_1: DOC, proof_sales_3: DOC, proof_share: DOC,
    extra: { id_image: DOC, proof_share: DOC, rendor_sub_active: false },
  };
  strip(verified);
  for (const f of ['id_image', 'proof_sales_1', 'proof_sales_3', 'proof_share']) {
    assert.equal(verified[f], undefined, `${f} must be deleted from a verified record`);
  }
  assert.equal(verified.extra.id_image, undefined, 'the `extra` mirror must be purged too');
  assert.equal(verified.extra.proof_share, undefined);
  assert.equal(verified.extra.rendor_sub_active, false, 'unrelated extras survive');
  assert.equal(verified.name, 'Verified', 'the rest of the record survives');

  // Pending review still needs the photos, so the guard must not touch it.
  const pending = { id: 'u2', id_verified: false, id_image: DOC, proof_share: DOC };
  strip(pending);
  assert.equal(pending.id_image, DOC);
  assert.equal(pending.proof_share, DOC);
});

test('stripVerifyDocsIn copies instead of mutating the caller\'s rows', () => {
  const sandbox = loadUtils(makeStorage());
  const rows = [
    { id: 'a', id_verified: true, id_image: DOC, extra: { id_image: DOC } },
    { id: 'b', id_verified: false, id_image: DOC },
  ];
  const cleaned = sandbox.stripVerifyDocsIn(rows);

  assert.equal(rows[0].id_image, DOC, 'the source array must be untouched');
  assert.equal(rows[0].extra.id_image, DOC);
  assert.equal(cleaned[0].id_image, undefined);
  assert.equal(cleaned[0].extra.id_image, undefined);
  assert.notEqual(cleaned[0], rows[0]);
  // The pending row is passed through as-is and still shows its documents.
  assert.equal(cleaned[1].id_image, DOC);
});

test('boot purge rewrites pre-approval caches so the bytes leave localStorage', () => {
  const stale = JSON.stringify({
    id: 'u1', id_verified: true, role: 'vendor',
    id_image: DOC, proof_share: DOC, extra: { id_image: DOC },
  });
  const storage = makeStorage({
    happa_session: stale,
    // localDbKey('users') / the admin's user list — same shape, array form.
    happa_db_users: JSON.stringify([{ id: 'u1', id_verified: true, id_image: DOC }, { id: 'u2', id_verified: true }]),
    happa_all_users: JSON.stringify([{ id: 'u1', id_verified: true, id_image: DOC, extra: { proof_share: DOC } }]),
    happa_cart: JSON.stringify([{ id: 'p1', qty: 1 }]),
  });

  const sandbox = loadUtils(storage);
  const purged = sandbox.purgeVerifiedDocsFromStorage();

  assert.equal(purged, 3, 'all three user caches must be rewritten');
  for (const key of ['happa_session', 'happa_db_users', 'happa_all_users']) {
    const raw = storage.getItem(key);
    assert.ok(!raw.includes('VERIFICATION-PHOTO'), `${key} still holds the photo bytes`);
  }

  const session = JSON.parse(storage.getItem('happa_session'));
  assert.equal(session.id_verified, true, 'the record itself survives the purge');
  assert.equal(session.id, 'u1');
  assert.equal(session.extra.id_image, undefined, 'the nested copy is gone, not just the top level');

  assert.equal(storage.getItem('happa_cart'), JSON.stringify([{ id: 'p1', qty: 1 }]),
    'unrelated storage is left alone');
});

test('boot purge leaves unverified accounts and malformed entries intact', () => {
  const pendingSession = JSON.stringify({ id: 'u2', id_verified: false, id_image: DOC });
  const storage = makeStorage({
    happa_session: pendingSession,
    happa_all_users: 'not json at all',
  });
  const sandbox = loadUtils(storage);

  assert.equal(sandbox.purgeVerifiedDocsFromStorage(), 0, 'nothing to purge');
  assert.equal(storage.getItem('happa_session'), pendingSession,
    'an account still awaiting review keeps the files it submitted');
  assert.equal(storage.getItem('happa_all_users'), 'not json at all',
    'a corrupt entry must not throw or be overwritten');
});

test('the app wires the purge into session load and every user cache write', () => {
  const app = read('js/app.js');

  assert.match(app, /purgeVerifiedDocsFromStorage\(\)/,
    'loadSession must rewrite stale caches on boot');
  const loadBody = app.slice(app.indexOf('function loadSession'), app.indexOf('function loadSession') + 1200);
  assert.ok(loadBody.includes('purgeVerifiedDocsFromStorage()'),
    'the purge must run from loadSession, not some later page render');

  assert.match(app, /localStorage\.setItem\('happa_session', JSON\.stringify\(stripVerifyDocs\(/,
    'saveSessions must strip documents before persisting the session');
  assert.match(app, /table === 'users' \? stripVerifyDocsIn\(/,
    'saveLocalTable must strip documents from the cached users table');

  const adminProfiles = read('js/admin-profiles.js');
  assert.match(adminProfiles, /localStorage\.setItem\('happa_all_users', JSON\.stringify\(stripVerifyDocsIn\(/,
    'the admin user-list cache must be scrubbed when written');
});

test('a verified vendor or rendor no longer gets a Verify tab or its upload UI', () => {
  const vendor = read('js/vendor.js');
  assert.match(vendor, /const vendorVerifyDone = u\.id_verified && u\.is_verified;/,
    'the vendor dashboard must compute the verification-complete state');
  assert.match(vendor, /\$\{!vendorVerifyDone \? `<div class="tab-btn[^`]*vendor-verify/,
    'the vendor Verify tab button must be conditional on the verified state');
  assert.match(vendor, /\$\{!vendorVerifyDone \? `\r?\n<div class="tab-content \$\{activeTabId === 'vendor-verify'[^`]*id="vendor-verify">/,
    'the vendor Verify tab content must be conditional on the verified state');
  assert.match(vendor, /_persistedTab === 'vendor-verify' && vendorVerifyDone \? 'vendor-overview'/,
    'a remembered Verify tab must fall back to Overview instead of rendering nothing');

  const rendor = read('js/rendor.js');
  assert.match(rendor, /const rendorVerifyDone = u\.id_verified;/);
  assert.match(rendor, /\$\{!rendorVerifyDone \? `<div class="tab-btn[^`]*rendor-verify/,
    'the rendor Verify tab button must be conditional on the verified state');
  assert.match(rendor, /_persistedTab === 'rendor-verify' && rendorVerifyDone \? 'rendor-overview'/);
});

test('the admin profile stops showing the documents and says why', () => {
  const profiles = read('js/admin-profiles.js');
  const notice = /ID verified — the submitted documents have been permanently redacted from the platform and are no longer displayed\./;
  assert.equal((profiles.match(new RegExp(notice.source, 'g')) || []).length, 2,
    'both the vendor and rendor admin profiles must show the redaction notice');

  // The image tags must sit in the `else` branch of `u.id_verified`, so they
  // cannot render for an approved account even if a stale row still has them.
  for (const anchor of ['function adminOpenVendorProfile', 'function adminOpenRendorProfile']) {
    const start = profiles.indexOf(anchor);
    assert.ok(start !== -1, `${anchor} not found`);
    const body = profiles.slice(start, start + 9000);
    const guard = body.indexOf('${u.id_verified ?');
    const idImg = body.indexOf('src="${u.id_image}"');
    assert.ok(guard !== -1 && idImg > guard,
      `${anchor} must gate the ID image behind !u.id_verified`);
  }
});
