'use strict';
// One price rule for the whole app.
//
// The reported bug: a product listed at GHS 55 was displayed as GHS 0. Two
// different mistakes produced that number, and both are locked down here.
//
//   1. formatPrice did `Number(price)`, and `Number(null)` is 0 — so a row that
//      carried no price at all was rendered as a confident "GHS 0.00", which
//      the store-detail editor then prefilled into its form and saved back as
//      a real 0. A price of 0 and no price must never look the same.
//   2. `(p.price || 0).toFixed(2)` on a price that arrived as the STRING "55"
//      (Postgres serialises `numeric` as text) THREW — '55'.toFixed is not a
//      function — which broke the whole product list around it.
//
// The four helpers below are the only sanctioned way to touch a price:
//   priceNumber     — arithmetic/filters; null when there is no usable number
//   priceText       — display with a "Price unavailable" fallback
//   priceAmount     — display inside a labelled row ("Price: GHS 55" or "—")
//   priceInputValue — form prefill; EMPTY for a missing price, never "0.00"
//   discountPercent — a percentage only when both sides are real numbers
//
// A source sweep at the end fails the suite if any client file goes back to
// formatting a price straight off the raw field.

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

// ── Load the real helpers out of the browser script ─────────────────────────
const utilsSrc = read('js/utils.js');
const START = utilsSrc.indexOf('// ── Price display helper');
const END = utilsSrc.indexOf('window.priceInputValue = priceInputValue;');

assert.ok(START > -1 && END > START, 'the price helpers are missing from js/utils.js');

const win = {};
const helpers = new Function(
  'window',
  utilsSrc.slice(START, END) + '\nwindow.priceInputValue = priceInputValue;' +
    '\nreturn { formatPrice, priceNumber, priceText, priceAmount, discountPercent, priceInputValue };'
)(win);

const { formatPrice, priceNumber, priceText, priceAmount, discountPercent, priceInputValue } = helpers;

test('priceNumber reads every shape a price arrives in, and never invents 0', () => {
  const cases = [
    [55, 55],
    ['55', 55],
    ['55.00', 55],
    ['GHS 55', 55],
    ['GHS 1,200.50', 1200.5],
    [0, 0],
    ['0', 0],
    [0.5, 0.5],
    // No usable number: null, never 0.
    [null, null],
    [undefined, null],
    ['', null],
    ['   ', null],
    ['abc', null],
    [NaN, null],
    [Infinity, null],
    [-5, null],
    ['-5', null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      priceNumber(input),
      expected,
      `priceNumber(${JSON.stringify(input)}) should be ${expected}`
    );
  }
});

test('a missing price is never displayed as GHS 0', () => {
  // The exact regression: no price must not read as free.
  assert.equal(priceText(null), 'Price unavailable');
  assert.equal(priceText(undefined), 'Price unavailable');
  assert.equal(priceText(''), 'Price unavailable');
  assert.equal(priceText('abc'), 'Price unavailable');
  assert.equal(formatPrice(null), 'Price unavailable');
  assert.equal(formatPrice(undefined), 'Price unavailable');
  // …while a genuine 0 still shows as 0 (a deliberate free/zero listing).
  assert.equal(priceText(0), 'GHS 0');
  assert.equal(formatPrice('0'), 'GHS 0');
});

test('a string price displays as the number, not as a broken field', () => {
  assert.equal(priceText('55'), 'GHS 55');
  assert.equal(priceText(55), 'GHS 55');
  assert.equal(priceText('GHS 55'), 'GHS 55');
  assert.equal(formatPrice('55'), 'GHS 55', 'formatPrice must delegate to the one rule');
});

test('formatPrice and priceText agree on every shape', () => {
  for (const input of [null, undefined, '', 'abc', 0, '0', 55, '55', 'GHS 1,200.50', NaN, -5]) {
    assert.equal(
      formatPrice(input),
      priceText(input),
      `two price rules reappeared for ${JSON.stringify(input)}`
    );
  }
});

test('priceAmount keeps a labelled row honest', () => {
  assert.equal(priceAmount(55), 'GHS 55');
  assert.equal(priceAmount('55'), 'GHS 55');
  assert.equal(priceAmount(0), 'GHS 0');
  assert.equal(priceAmount(null), '—');
  assert.equal(priceAmount(''), '—');
  assert.equal(priceAmount('abc'), '—');
});

test('priceInputValue leaves an absent price EMPTY so a form cannot save 0', () => {
  assert.equal(priceInputValue(null), '');
  assert.equal(priceInputValue(undefined), '');
  assert.equal(priceInputValue(''), '');
  assert.equal(priceInputValue('abc'), '');
  assert.equal(priceInputValue(55), '55.00');
  assert.equal(priceInputValue('55'), '55.00');
  assert.equal(priceInputValue(0), '0.00');
});

test('discountPercent only speaks when both prices are real numbers', () => {
  assert.equal(discountPercent('100', '55'), 45, 'string prices must still compute a real discount');
  assert.equal(discountPercent(100, 55), 45);
  assert.equal(discountPercent('200', '150'), 25);
  // A decimal price still lands on a sane percentage (floating point can move
  // the rounded value by one).
  const decimal = discountPercent('100', '55.50');
  assert.ok(decimal >= 44 && decimal <= 45, `unexpected decimal discount ${decimal}`);
  assert.equal(discountPercent('100', '-5'), null, 'a negative price is not a discount');
  // No discount to show.
  assert.equal(discountPercent(100, 100), null);
  assert.equal(discountPercent('100', '150'), null);
  assert.equal(discountPercent(0, 55), null);
  // Nothing to compute from — never NaN.
  assert.equal(discountPercent(null, '55'), null);
  assert.equal(discountPercent('100', null), null);
  assert.equal(discountPercent(undefined, undefined), null);
});

// ── Source sweep ────────────────────────────────────────────────────────────
// Comments explain these very mistakes, so whole-line comments are dropped
// before scanning. Deliberately line-based: some of these files embed HTML and
// CSS inside template literals, where a naive block-comment stripper pairs an
// unmatched `/*` with a much later `*/` and silently deletes thousands of
// lines of real code (confirmed in js/vendor.js) — every assertion below would
// then pass by scanning nothing.
function stripComments(src) {
  return src
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .filter(line => !/^\s*\/\*.*\*\/\s*$/.test(line))
    .join('\n');
}

const RAW_PRICE_PATTERNS = [
  // `x.price || 0).toFixed(…)` — the identifier must END in "price", so the
  // wallet/fee amounts that legitimately default to 0 are not flagged.
  [/[\w.$?\[\]]*price\s*\|\|\s*0\s*\)\s*\.toFixed/i, 'defaults a price to 0 before formatting it'],
  [/Number\([^()]*price[^()]*\)\s*\.toFixed/, 'Number(price).toFixed prints "GHS NaN" for a missing price'],
  [/parseFloat\([^()]*price[^()]*\)\s*\.toFixed/, 'parseFloat(price).toFixed prints "GHS NaN" for a missing price'],
  [/GHS\s*\$\{\s*[a-zA-Z_$][\w.$?\[\]]*price\s*\}/, 'interpolates the raw price field into the markup'],
  [/original_price\s*>\s*[a-zA-Z_$][\w.]*price/, 'compares raw price fields (false on strings, NaN when divided)'],
];

test('no client file formats a price straight off the raw field', () => {
  for (const file of CLIENT_FILES) {
    const src = stripComments(read(file));
    for (const [pattern, why] of RAW_PRICE_PATTERNS) {
      const hit = src.match(pattern);
      assert.equal(
        hit,
        null,
        `${file} ${why}: ${hit ? hit[0] : ''}`
      );
    }
  }
});

test('every surface that shows a price goes through a helper', () => {
  const MUST_USE_HELPER = [
    'js/app.js',
    'js/marketplace.js',
    'js/vendor.js',
    'js/cart.js',
    'js/checkout.js',
    'js/orders.js',
    'js/admin.js',
    'js/admin-profiles.js',
    'js/ads.js',
    'js/search.js',
    'js/rendor.js',
  ];
  for (const file of MUST_USE_HELPER) {
    const src = read(file);
    assert.match(
      src,
      /priceText\(|priceAmount\(|priceInputValue\(|priceNumber\(|formatPrice\(|discountPercent\(/,
      `${file} does not use any of the price helpers`
    );
  }
});

test('the client bundle exposes the price helpers as globals', () => {
  for (const name of ['formatPrice', 'priceNumber', 'priceText', 'priceAmount', 'discountPercent', 'priceInputValue']) {
    assert.match(
      utilsSrc,
      new RegExp(`window\\.${name}\\s*=`),
      `window.${name} is not exported — a lazily-loaded bundle could miss it`
    );
    assert.equal(typeof win[name], 'function', `window.${name} was not assigned when the script ran`);
  }
});
