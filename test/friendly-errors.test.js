'use strict';
// What a person reads when something fails.
//
// Two failures used to be indistinguishable on screen: "you typed the wrong
// password" and "the database is down", "your price is stale" and "the server
// rejected the save: HTTP 400: Unknown resource". The technical half came from
// window.lastApiError / a response's `error` field being pasted into a toast
// verbatim, so a buyer was told about the backend instead of about their order.
//
// Two rules are asserted here:
//
//   1. friendlyApiError() decides what a person reads: transport and backend
//      vocabulary becomes a plain sentence, while anything our own server said
//      in plain language passes through (stock, balance and coupon copy is
//      already specific and useful).
//   2. No surface reports a failed request by printing the raw error again.
//      A regression is invisible in tests and only shows up as a customer
//      reading "HTTP 500" on their phone.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const CLIENT_FILES = fs
  .readdirSync(path.join(ROOT, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => `js/${f}`);

// ── Load the real helper out of the browser script ──────────────────────────
const utilsSrc = read('js/utils.js');
const FRIENDLY_START = utilsSrc.indexOf('function friendlyApiError');
const FRIENDLY_END = utilsSrc.indexOf('window.friendlyApiError');

assert.ok(FRIENDLY_START > -1 && FRIENDLY_END > FRIENDLY_START, 'friendlyApiError() is missing from js/utils.js');

const friendlyApiError = new Function(
  'console',
  utilsSrc.slice(FRIENDLY_START, FRIENDLY_END) + '\nreturn friendlyApiError;'
)({ warn() {}, log() {} });

test('friendlyApiError turns transport and backend noise into plain sentences', () => {
  const cases = [
    // [raw error, fallback, must NOT appear in the result]
    ['HTTP 500: Internal Server Error', null, /HTTP|500|Internal/],
    ['HTTP 502: Bad gateway', null, /502|gateway/],
    ['Server rejected the save: HTTP 400: Unknown resource', null, /Server rejected|Unknown resource|400/],
    ['Failed to fetch', null, /fetch/i],
    ['NetworkError when attempting to fetch resource.', null, /NetworkError/],
    ['TypeError: Cannot read properties of undefined (reading "id")', null, /TypeError|undefined|read properties/],
    ['error: relation "public.users" does not exist', null, /relation|public\.users|does not exist/],
    ['invalid input syntax for type uuid', null, /uuid|syntax/],
    ['PostgresError: duplicate key value violates unique constraint', null, /Postgres|constraint|duplicate key/],
    ['{"error":"boom"}', null, /\{|\}/],
    ['Unexpected token < in JSON at position 0', null, /JSON|token|position/],
    ['null', null, null],
    ['', null, null],
    [undefined, null, null],
  ];

  for (const [raw, fallback, forbidden] of cases) {
    const out = friendlyApiError(raw, fallback);
    assert.equal(typeof out, 'string');
    assert.ok(out.trim().length > 0, `empty message for ${JSON.stringify(raw)}`);
    if (forbidden) {
      assert.ok(
        !forbidden.test(out),
        `"${out}" (from ${JSON.stringify(raw)}) still leaks backend detail ${forbidden}`
      );
    }
  }
});

test('friendlyApiError keeps the sentences our own server writes', () => {
  // These are the ones worth keeping: they name the real problem precisely.
  const passthrough = [
    'Only 2 left in stock.',
    'Your wallet balance is too low for this order.',
    'That coupon has expired.',
    'The subscription fee is now GHS 10.00 for 1 month. Please check the new fee and pay again.',
  ];
  for (const msg of passthrough) {
    assert.equal(friendlyApiError(msg, 'ignored'), msg);
  }
});

test('friendlyApiError answers the questions a user actually has', () => {
  const offline = friendlyApiError('Failed to fetch', 'x');
  assert.match(offline, /connection|offline/i, 'an unreachable backend must talk about the connection');

  const session = friendlyApiError('HTTP 401: Unauthorized', 'x');
  assert.match(session, /sign in again/i, 'a dead session must tell the user to sign in again');

  const forbidden = friendlyApiError('HTTP 403: Forbidden', 'x');
  assert.match(forbidden, /permission/i);

  const server = friendlyApiError('HTTP 500: boom', 'x');
  assert.match(server, /our end|try again/i, 'a server fault must not blame the user');

  const missing = friendlyApiError('HTTP 404: Not found', 'x');
  assert.match(missing, /no longer available|refresh/i);

  // The caller's fallback is used when there is nothing usable at all.
  assert.equal(friendlyApiError('', 'Order failed. Please try again.'), 'Order failed. Please try again.');
});

test('showApiErrorToast is the single wrapper every surface can call', () => {
  assert.match(utilsSrc, /function\s+showApiErrorToast\s*\(/);
  const body = utilsSrc.slice(utilsSrc.indexOf('function showApiErrorToast'), utilsSrc.indexOf('window.showApiErrorToast'));
  assert.match(body, /friendlyApiError\(/, 'showApiErrorToast must translate through friendlyApiError()');
  assert.match(body, /showToast\(/, 'showApiErrorToast must render a toast');
  assert.match(body, /'error'/, 'a failed request is an error toast');
});

test('no surface prints a raw error into a toast', () => {
  for (const file of CLIENT_FILES) {
    const src = read(file);
    const lines = src.split('\n');

    lines.forEach((line, i) => {
      if (!line.includes('showToast(')) return;
      assert.ok(
        !/lastApiError/.test(line),
        `${file}:${i + 1} toasts window.lastApiError verbatim — use showApiErrorToast()`
      );
      assert.ok(
        !/\.message\b/.test(line),
        `${file}:${i + 1} toasts an Error message verbatim — use showApiErrorToast()`
      );
      assert.ok(
        !/\.error\b/.test(line),
        `${file}:${i + 1} toasts a response error verbatim — use showApiErrorToast()`
      );
    });
  }
});

test('the surfaces that report failed requests translate them', () => {
  // Each of these had a raw error path (upload, payment, delete, save). They all
  // have to funnel through the translator, not just most of them.
  const surfaces = [
    ['js/marketplace.js', 'storefront product save/delete'],
    ['js/vendor.js', 'product upload, store purchase, storefront subscription'],
    ['js/wallet.js', 'deposit and withdrawal'],
    ['js/checkout.js', 'placing an order'],
    ['js/rendor.js', 'rendor subscription payment'],
    ['js/admin.js', 'user activation, ad campaigns'],
    ['js/admin-profiles.js', 'admin product/user/store edits'],
    ['js/buyer.js', 'profile save'],
    ['js/optimistic_ui.js', 'every optimistic request'],
    ['js/app.js', 'account deletion'],
  ];

  for (const [file, label] of surfaces) {
    assert.ok(
      read(file).includes('showApiErrorToast('),
      `${file} (${label}) no longer reports failures through showApiErrorToast()`
    );
  }
});

test('user-facing copy never talks about our infrastructure', () => {
  const infra = /\b(server|supabase|database|backend|endpoint|localhost)\b/i;
  for (const file of CLIENT_FILES) {
    const src = read(file);
    const matches = [...src.matchAll(/showToast\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)];
    for (const m of matches) {
      assert.ok(
        !infra.test(m[2]),
        `${file} shows the user infrastructure wording: "${m[2].slice(0, 90)}"`
      );
    }
  }
});
