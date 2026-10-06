'use strict';
// The storefront editor used to collect Facebook and YouTube links. It now
// collects WhatsApp, Instagram and TikTok:
//   • WhatsApp → the store's `whatsapp` column, projected as `whatsapp_number`,
//     because a wa.me link has to be built from a typed number
//   • Instagram → the store's `instagram` column, projected as `instagram_url`
//   • TikTok → the store's `extra` JSONB as `tiktok_url` (there is no tiktok
//     column, and the storefront save path maps a fixed set of keys onto the
//     store row — a key with no mapping is silently dropped before the write)
//
// These tests pin the editor fields, that storage mapping on BOTH backends
// (server.js and the deployed api/index.js), the footer icons, and the link
// normalisation vendors depend on (they type a number, a handle or a full URL
// into the same box).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

const vendor = read(path.join('js', 'vendor.js'));
const marketplace = read(path.join('js', 'marketplace.js'));
const utils = read(path.join('js', 'utils.js'));
const app = read(path.join('js', 'app.js'));
const backend = read('server.js');
const deployed = read(path.join('api', 'index.js'));

// Pull a top-level function straight out of the source so the test exercises
// the shipped implementation instead of a copy of it.
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start !== -1, `${name}() is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name}() body is unbalanced`);
}

const waMeHref = new Function(`${extractFunction(app, 'waMeHref')}; return waMeHref;`)();
const socialHref = new Function('waMeHref', `${extractFunction(utils, 'socialHref')}; return socialHref;`)(waMeHref);

test('the editor collects WhatsApp, Instagram and TikTok', () => {
  ['store-whatsapp', 'store-instagram', 'store-tiktok'].forEach(id => {
    assert.ok(vendor.includes(`id="${id}"`), `the social field #${id} is missing`);
  });
  assert.ok(!vendor.includes('id="store-facebook"'), 'the Facebook field should be gone');
  assert.ok(!vendor.includes('id="store-youtube"'), 'the YouTube field should be gone');
  assert.ok(vendor.includes('fab fa-tiktok'), 'the TikTok field needs its icon');
});

test('the editor writes WhatsApp, Instagram and TikTok', () => {
  assert.ok(/whatsapp_number:\s*whatsappUrl/.test(vendor), 'WhatsApp must persist as whatsapp_number');
  assert.ok(/instagram_url:\s*instagramUrl/.test(vendor), 'Instagram must keep its column');
  assert.ok(/tiktok_url:\s*tiktokUrl/.test(vendor), 'TikTok must persist as tiktok_url');
  assert.ok(
    !/facebook_url:\s*facebookUrl/.test(vendor) && !/youtube_url:\s*tiktokUrl/.test(vendor),
    'nothing should write the retired facebook_url / youtube_url fields'
  );
  // The store row has a `whatsapp` column of its own; the storefront page falls
  // back to it when a store has no storefronts row.
  assert.ok(/whatsapp:\s*whatsappUrl/.test(vendor), 'stores.whatsapp should mirror the number');
});

test('both backends store WhatsApp on the store row and TikTok in extra', () => {
  for (const [name, source] of [['server.js', backend], ['api/index.js', deployed]]) {
    assert.ok(
      /if \('whatsapp_number' in body\) storeUpdates\.whatsapp = body\.whatsapp_number;/.test(source),
      `${name} must map whatsapp_number onto the store's whatsapp column`
    );
    assert.ok(
      /if \('tiktok_url' in body\) extra(?:\.|Sf\.)tiktok_url = String\(body\.tiktok_url \|\| ''\)\.slice\(0, 300\);/.test(source),
      `${name} must mirror tiktok_url into the store's extra JSONB`
    );
    // …and project them back out, or the editor and storefront footer would
    // read empty values after a successful save.
    assert.ok(
      /whatsapp_number: (?:extraSf\.whatsapp_number \|\| )?st\.whatsapp \|\|/.test(source),
      `${name} must project the WhatsApp number back onto the storefront`
    );
    assert.ok(
      /tiktok_url: (?:extraSf\.tiktok_url \|\| )?st\.tiktok_url \|\| st\.extra\?\.tiktok_url \|\| ''/.test(source),
      `${name} must project the TikTok link back onto the storefront`
    );
  }
});

test('the storefront footer shows WhatsApp, Instagram and TikTok', () => {
  ['whatsapp', 'instagram', 'tiktok'].forEach(kind => {
    assert.ok(
      marketplace.includes(`socialHref('${kind}'`),
      `the footer must build the ${kind} link through socialHref()`
    );
  });
  assert.ok(!marketplace.includes('title="Facebook"'), 'the Facebook icon should be gone from the footer');
  assert.ok(!marketplace.includes('title="YouTube"'), 'the YouTube icon should be gone from the footer');
  assert.ok(marketplace.includes('title="TikTok"'), 'the TikTok icon is missing from the footer');
  assert.ok(utils.includes('window.socialHref = socialHref'), 'socialHref must be exposed to the app');
});

test('socialHref() turns a typed number or handle into a working link', () => {
  const cases = [
    // WhatsApp: numbers become wa.me links in every layout vendors type
    ['whatsapp', '024 000 0000', 'https://wa.me/0240000000'],
    ['whatsapp', '+233 24 000 0000', 'https://wa.me/233240000000'],
    ['whatsapp', '024-000-0000', 'https://wa.me/0240000000'],
    // …but a real link is never rewritten into digits
    ['whatsapp', 'https://wa.me/233240000000', 'https://wa.me/233240000000'],
    ['whatsapp', 'https://chat.whatsapp.com/AbCd12', 'https://chat.whatsapp.com/AbCd12'],
    ['whatsapp', 'chat.whatsapp.com/AbCd12', 'https://chat.whatsapp.com/AbCd12'],
    // Instagram / TikTok: handles and domains both work
    ['instagram', '@my.shop', 'https://instagram.com/my.shop'],
    ['instagram', 'myshop', 'https://instagram.com/myshop'],
    ['instagram', 'instagram.com/myshop', 'https://instagram.com/myshop'],
    ['tiktok', '@mystore', 'https://www.tiktok.com/@mystore'],
    ['tiktok', 'mystore', 'https://www.tiktok.com/@mystore'],
    ['tiktok', 'tiktok.com/@mystore', 'https://tiktok.com/@mystore'],
    ['tiktok', 'https://www.tiktok.com/@mystore', 'https://www.tiktok.com/@mystore'],
    // Nothing typed → no icon is rendered
    ['whatsapp', '', ''],
    ['tiktok', '', ''],
    ['whatsapp', '   ', ''],
  ];

  for (const [kind, typed, expected] of cases) {
    assert.equal(socialHref(kind, typed), expected, `socialHref('${kind}', '${typed}')`);
  }
});
