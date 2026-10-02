'use strict';
// Product-image pipeline invariants.
//
// A portrait photo scaled to FIT inside a square canvas leaves white bars on
// the left and right — and those bars are saved as real pixels, so no amount of
// CSS can remove them. That is exactly the bug that reached a live listing: the
// card showed a portrait photo floating on a white canvas. `squareImage` scales
// to COVER and crops, so the stored file is edge-to-edge content; this suite
// locks that in, because switching the scale back from Math.max to Math.min
// reintroduces the defect silently.
//
// js/utils.js is browser-only (it needs document/Image/FileReader), so unlike
// the other suites this one asserts on the source text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const utilsSrc = fs.readFileSync(path.join(ROOT, 'js', 'utils.js'), 'utf-8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8');
const marketSrc = fs.readFileSync(path.join(ROOT, 'js', 'marketplace.js'), 'utf-8');

const squareImageBody = (() => {
  const start = utilsSrc.indexOf('async function squareImage');
  assert.ok(start !== -1, 'squareImage is missing from js/utils.js');
  const end = utilsSrc.indexOf('\nfunction ', start + 10);
  return utilsSrc.slice(start, end === -1 ? undefined : end);
})();

test('squareImage scales to COVER so uploads never carry baked-in white bars', () => {
  assert.match(
    squareImageBody,
    /Math\.max\(\s*size\s*\/\s*img\.width\s*,\s*size\s*\/\s*img\.height\s*\)/,
    'squareImage must scale by Math.max(size/width, size/height) — the "cover" ' +
    'factor. Using Math.min (contain) letterboxes the photo onto a white canvas ' +
    'and bakes the bars into the saved jpeg where CSS can never remove them.'
  );
});

test('squareImage does not use the letterbox (contain) scale factor', () => {
  assert.doesNotMatch(
    squareImageBody,
    /Math\.min\(\s*size\s*\/\s*img\.width\s*,\s*size\s*\/\s*img\.height\s*\)/,
    'a contain scale factor reintroduces the white bars'
  );
});

test('squareImage draws the cover-crop centred and negative-offset', () => {
  // Cover means the drawn box is >= the canvas, so the centred offset must be
  // allowed to go negative (it crops both sides evenly) rather than clamped.
  assert.match(squareImageBody, /drawImage\(/, 'squareImage should draw the image');
  assert.match(
    squareImageBody,
    /\(\s*size\s*-\s*w\s*\)\s*\/\s*2/,
    'the cover draw must be centred on the canvas'
  );
});

test('fitProductImage stays wired into the product card images', () => {
  assert.match(utilsSrc, /function fitProductImage/, 'fitProductImage is missing from js/utils.js');
  // The display-time repair is the safety net for images already saved by an
  // older build, so the card templates must keep calling it on load.
  assert.match(appSrc, /onload="fitProductImage\(this\)"/, 'the product card must call fitProductImage on load');
  assert.match(marketSrc, /onload="fitProductImage\(this\)"/, 'the storefront/detail images must call fitProductImage on load');
});

test('no product image is rendered stretched with object-fit: fill', () => {
  // `fill` distorts the photo (and used to look like letterboxing); product
  // images are cover-cropped so they fill their slot without distortion.
  assert.doesNotMatch(
    appSrc,
    /product-img[^>]*object-fit:\s*fill/,
    'product cards must cover-crop, not stretch'
  );
});
