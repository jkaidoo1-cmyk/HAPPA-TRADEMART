'use strict';
// Order codes are tappable to copy — contract guards.
//
// An order code is the one string a buyer, vendor and support agent read back
// to each other, and it is rendered next to a status badge rather than in an
// input, so it has to be tappable. Two things about that are easy to break
// without noticing, and both are asserted here:
//
//   1. The click listener must be registered in the CAPTURE phase. Chips are
//      rendered inside cards whose inline onclick opens the order detail; a
//      bubble-phase listener on document runs *after* that card handler, so the
//      modal would open every time someone tried to copy a code.
//   2. Every surface that prints a code must render it through orderCodeChip().
//      A regression here is invisible in tests and only shows up as "the code
//      does not copy" on a phone, on one screen out of a dozen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const utilsSrc = read('js/utils.js');

test('orderCodeChip builds a tappable chip that escapes the code', () => {
  assert.match(
    utilsSrc,
    /function\s+orderCodeChip\s*\(/,
    'orderCodeChip() is missing from js/utils.js'
  );

  const body = utilsSrc.slice(
    utilsSrc.indexOf('function orderCodeChip'),
    utilsSrc.indexOf('function markChipCopied')
  );
  assert.ok(body.length > 0, 'could not isolate the orderCodeChip() body');

  // The code lands in an attribute and in the visible label, so both must go
  // through escHtml — a code is server data and must never be raw markup.
  assert.match(
    body,
    /data-copy-order="\$\{escHtml\(value\)\}"/,
    'the chip must put the code in data-copy-order through escHtml()'
  );
  assert.match(
    body,
    /role="button"/,
    'the chip must expose role="button" so it is reachable and announced as tappable'
  );
  assert.match(
    body,
    /tabindex="0"/,
    'the chip must be keyboard reachable'
  );
});

test('the copy handler runs in the capture phase', () => {
  const clickHandlers = [...utilsSrc.matchAll(
    /document\.addEventListener\(\s*'click'\s*,\s*\(ev\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*(true|false)\s*\)/g
  )];
  const copyHandler = clickHandlers.find(m => m[1].includes('copyOrderCodeFromChip'));

  assert.ok(
    copyHandler,
    'the delegated order-code copy click handler is missing from js/utils.js'
  );
  assert.match(
    copyHandler[1],
    /nearestCopyChip|\[data-copy-order\]/,
  );
  assert.equal(
    copyHandler[2],
    'true',
    'the copy handler must use the CAPTURE phase — in the bubble phase the ' +
    "enclosing card's inline onclick has already opened the order modal"
  );
  assert.match(
    copyHandler[1],
    /stopPropagation\(\)/,
    'the copy handler must stop the click so it never reaches the enclosing card'
  );
});

test('every order-code surface renders through orderCodeChip()', () => {
  const surfaces = [
    ['js/orders.js', 'buyer package card'],
    ['js/orders.js', 'order detail modal title'],
    ['js/orders.js', 'admin package card'],
    ['js/orders.js', 'vendor delivery card'],
    ['js/cart.js', 'cart order list'],
    ['js/cart.js', 'cart tracking result'],
    ['js/marketplace.js', 'storefront order tracking'],
    ['js/search.js', 'global search track card'],
    ['js/checkout.js', 'order-placed confirmation'],
    ['js/vendor.js', 'vendor order row'],
    ['js/admin.js', 'vendor rejection log'],
    ['js/admin-profiles.js', 'admin vendor orders'],
  ];

  for (const [file, label] of surfaces) {
    const src = read(file);
    assert.ok(
      src.includes('orderCodeChip('),
      `${file} (${label}) no longer renders its order code through orderCodeChip()`
    );
  }
});

test('no order code is interpolated straight into markup', () => {
  // The old shape was `<span class="package-code">…${pkg.package_code}…</span>`,
  // which is not tappable. Once a code goes through orderCodeChip() the raw
  // interpolation disappears, so finding one again means a surface regressed.
  const files = [
    'js/orders.js', 'js/cart.js', 'js/marketplace.js', 'js/search.js',
    'js/checkout.js', 'js/vendor.js', 'js/admin.js', 'js/admin-profiles.js',
  ];
  const rawCode = /class="package-code"[^>]*>\s*<i[^>]*><\/i>\$\{/;

  for (const file of files) {
    assert.ok(
      !rawCode.test(read(file)),
      `${file} renders a bare, non-tappable package-code span again`
    );
  }
});
