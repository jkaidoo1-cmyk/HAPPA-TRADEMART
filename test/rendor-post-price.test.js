'use strict';
// A rendor may publish a post without entering a price, or enter 0. Every card
// that shows that post must then show NO price tag at all — "From GHS 0.00"
// advertises a figure the rendor never set.
//
// The rule already exists as hasDisplayablePrice() in js/utils.js (the same gate
// products use), so this test locks three things down:
//   1. the gate itself treats blank / 0 as "no price";
//   2. every post renderer asks it (a raw truthiness or `priceNumber(..) != null`
//      check lets 0, "0" and "0.00" through);
//   3. the rendered dashboard card really prints no GHS text for those values,
//      run through the real helpers, not stubs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const { DECLARATIONS } = require('./price-helpers.fixture');

const BLANK = [null, undefined, '', 0, '0', '0.00', -5];

test('the display gate treats a blank or zero price as no price', () => {
  const fn = new Function(`${DECLARATIONS}\nreturn hasDisplayablePrice;`)();
  for (const value of BLANK) {
    assert.equal(fn({ price: value }), false, `price ${JSON.stringify(value)} must show no tag`);
  }
  assert.equal(fn({ price: 55 }), true);
  assert.equal(fn({ price: '55' }), true);
  assert.equal(fn({}), false, 'a row without a price has no tag');
  assert.equal(fn(null), false);
});

// Run the real dashboard card against the real price helpers.
function renderDashboardCard(post) {
  const src = read('js/rendor.js');
  const start = src.indexOf('function rendorPostCardHTML(p) {');
  const end = src.indexOf('// ── Subscription tab', start);
  assert.ok(start > -1 && end > start, 'rendorPostCardHTML could not be located in js/rendor.js');
  const body = src.slice(start, end);
  const escHtml = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return new Function('escHtml', `${DECLARATIONS}\n${body}\nreturn rendorPostCardHTML;`)(escHtml)(post);
}

const BASE = {
  id: 'p1',
  title: 'Logo design',
  category: 'Design',
  description: 'Fast logos',
  status: 'active',
  rendor_id: 'r1',
  image_url: ''
};

test('the rendor dashboard card prints no price tag for a blank or zero price', () => {
  for (const price of BLANK) {
    const html = renderDashboardCard({ ...BASE, price });
    assert.ok(!/GHS/.test(html), `price ${JSON.stringify(price)} leaked a GHS tag`);
    assert.ok(!/From /.test(html), `price ${JSON.stringify(price)} leaked a price row`);
  }
});

test('the rendor dashboard card still prices a real post', () => {
  for (const price of [55, '55', 'GHS 55']) {
    const html = renderDashboardCard({ ...BASE, price });
    assert.match(html, /From GHS 55/, `price ${JSON.stringify(price)} lost its tag`);
  }
});

test('every post renderer asks the gate instead of the raw field', () => {
  const dashboard = read('js/rendor.js');
  assert.match(
    dashboard,
    /hasDisplayablePrice\(p\) \? `<div[^`]*>From \$\{priceText\(p\.price\)\}/,
    'rendorPostCardHTML does not gate its price tag'
  );

  const marketplace = read('js/marketplace.js');
  assert.match(marketplace, /const price\s+= hasDisplayablePrice\(post\)/,
    'the public post card does not gate its price tag');
  assert.match(marketplace, /const price = hasDisplayablePrice\(post\)/,
    'the profile post card does not gate its price tag');
  assert.ok(
    !/const price\s+= post\.price/.test(marketplace),
    'a post card decides from raw price truthiness (the string "0" slips through)'
  );
  assert.ok(
    !/priceNumber\((?:p|post)\.price\) != null/.test(marketplace),
    'a post card uses priceNumber != null (0 renders as a price)'
  );

  const search = read('js/search.js');
  assert.match(search, /hasDisplayablePrice\(p\) \? `From \$\{priceText\(p\.price\)\}` : escHtml\(p\.category/,
    'the search suggestion does not fall back to the category when there is no price');
  assert.ok(
    !/priceNumber\(p\.price\) != null/.test(search),
    'a search suggestion still prices a zero-price post'
  );
});

test('the share caption only quotes a price above zero', () => {
  const src = read('js/marketplace.js');
  const start = src.indexOf('function shareRendorPost(');
  const end = src.indexOf('\n}', start);
  assert.ok(start > -1, 'shareRendorPost is missing');
  const body = src.slice(start, end);
  assert.match(body, /priceVal > 0/, 'the share text would announce a free/zero price');
});
