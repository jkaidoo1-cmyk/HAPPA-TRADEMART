'use strict';
// Guards for four findings from the October 2026 audit.
//
//   1. `showToast()` wrote its message into innerHTML. Toasts routinely carry a
//      product / store / user name straight from the database, so an anonymous
//      POST /api/products storing `<img src=x onerror=...>` as a product name
//      executed script in any visitor's session when they added it to the cart
//      (the session token lives in localStorage, so that is account takeover).
//      The message is now assigned as text.
//   2. api/index.js never set `trust proxy`, so behind Vercel every caller
//      shared ONE rate-limit key: five wrong passwords from anywhere returned
//      429 to the whole platform for 15 minutes, and express-rate-limit logged
//      ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. server.js had always set it.
//   3. Production HTML carried no Content-Security-Policy at all — vercel.json
//      set the other security headers but not this one, and index.html has no
//      meta fallback. Local dev was stricter than production.
//   4. `saveDb()` / `saveToFile()` rewrote the whole JSON database in place, so
//      an interrupted write truncated it.
//
// 1, 3 and 4 are asserted against the source (a browser sink and a host config
// cannot be exercised here); 2 is driven over HTTP against api/index.js, which
// is the file that actually serves production.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8');
const vercelSrc = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf-8');
const dataStoreSrc = fs.readFileSync(path.join(ROOT, 'api', 'data-store.js'), 'utf-8');

// ── 1. Toasts render text, never markup ────────────────────────────────────
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found — the pattern it is read with has drifted`);
  return src.slice(start, start + 1400);
}

const toastBody = fnBody(appSrc, 'function showToast(');

test('showToast writes the message as text, not as markup', () => {
  assert.doesNotMatch(
    toastBody,
    /\$\{msg\}/,
    'showToast must not interpolate the message into innerHTML — that is the XSS sink'
  );
  assert.match(
    toastBody,
    /textContent\s*=\s*String\(msg/,
    'showToast should assign the message via textContent so the DOM escapes it'
  );
});

test('no showToast caller passes markup as the message', () => {
  const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
  const offenders = [];
  for (const file of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf-8');
    for (const m of src.matchAll(/showToast\(\s*`([^`]*)`/g)) {
      // A tag-looking sequence in a toast message would now render literally;
      // catch the accidental case where a caller relied on innerHTML.
      if (/<[a-z][\s\S]*>/i.test(m[1])) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], 'these toasts pass HTML markup: ' + offenders.join(' | '));
});

// ── 1b. Order cards render item names as text ─────────────────────────────
// The same vendor-controlled (in fact anonymously writable) product name
// reached three more innerHTML templates through itemDisplayName(), which only
// trims — it does not escape. search.js had always wrapped it in escHtml.
test('every itemDisplayName() used in markup is escaped', () => {
  const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
  const offenders = [];
  for (const file of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf-8');
    src.split('\n').forEach((line, n) => {
      // Only an interpolation directly into markup is a sink. A bare
      // `const title = itemDisplayName(...)` is fine — what matters is whether
      // the value is escaped where it is finally written.
      if (!line.includes('${') || !line.includes('itemDisplayName(')) return;
      if (/escHtml\(\s*itemDisplayName\(/.test(line)) return;
      offenders.push(`${file}:${n + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'these render an unescaped item name: ' + offenders.join(' | '));
});

// ── 2. Login throttling is per-visitor on the production backend ───────────
process.env.SESSION_SECRET = 'security-posture-test-secret-not-real';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_KEY;

const dataStore = require(path.join(ROOT, 'api', 'data-store.js'));
// Neutralise the file write before api/index.js captures the module, so this
// suite can never mutate the repo's checked-in db.json.
dataStore.saveToFile = () => true;

const app = require(path.join(ROOT, 'api', 'index.js'));

let server = null;
let base = '';

before(async () => {
  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
  server = await new Promise(resolve => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

function login(xff, email) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
    body: JSON.stringify({ email, password: 'definitely-wrong-password' })
  }).then(r => r.status);
}

test('distinct visitors are throttled independently (no global login lockout)', async () => {
  const codes = [];
  for (let i = 1; i <= 8; i++) codes.push(await login(`203.0.113.${i}`, `audit-${i}@example.com`));
  assert.ok(
    codes.every(c => c === 401),
    'five failed logins from one visitor must not 429 everyone else — got ' + codes.join(',')
  );
});

test('the per-visitor login limiter still bites', async () => {
  const codes = [];
  for (let i = 1; i <= 6; i++) codes.push(await login('198.51.100.7', `burst-${i}@example.com`));
  assert.equal(codes[0], 401, 'the first attempt should be a normal credential failure');
  assert.equal(codes[codes.length - 1], 429, 'repeated failures from one visitor must be throttled');
});

test('api/index.js trusts the proxy so req.ip is the visitor', () => {
  const apiSrc = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf-8');
  assert.match(apiSrc, /app\.set\(\s*'trust proxy'\s*,\s*1\s*\)/, 'api/index.js must set trust proxy');
  assert.match(serverSrc, /app\.set\(\s*'trust proxy'\s*,\s*1\s*\)/, 'server.js must set trust proxy');
});

// ── 3. Production responses carry a CSP ────────────────────────────────────
test('vercel.json sends a Content-Security-Policy for every path', () => {
  assert.match(vercelSrc, /"Content-Security-Policy"/, 'no CSP header is declared for the deployment');
  assert.match(vercelSrc, /script-src 'self' 'unsafe-inline'/, 'the CSP must still allow the inline handlers the SPA uses');
  assert.match(serverSrc, /Content-Security-Policy/, 'server.js must keep its CSP');
});

// ── 4. Database writes are atomic ──────────────────────────────────────────
test('the JSON store is written via a temp file and rename', () => {
  assert.match(fnBody(serverSrc, 'function saveDb('), /renameSync/, 'saveDb must rename a temp file into place');
  assert.match(dataStoreSrc, /renameSync/, 'api/data-store.js saveToFile must rename a temp file into place');
});
