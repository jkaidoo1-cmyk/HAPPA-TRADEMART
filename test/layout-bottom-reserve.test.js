'use strict';
// Layout regression: the bottom nav is `position: fixed` and overlays the last
// var(--bottom-h) of the viewport. #main-content reserves that height as
// padding-bottom, but a scroller's padding only adds reachable space while its
// content still fits inside the content box — every long dashboard tab
// overflows it, so the padding region is swallowed and the final card/button on
// the tab (the storefront tab's "Save Settings" was the report) stayed behind
// the nav with no way to scroll it into view.
//
// The reserve therefore has to exist twice, from one source of truth:
//   1. #main-content pads by --bottom-reserve (short pages), and
//   2. content that owns the end of a tab adds the same value to its own
//      padding-bottom (.dashboard-wrap), which grows past the swallowed padding.
// updateNavForUser() clears the variable when the nav is hidden (admins and
// storefront views) so no phantom gap is left behind.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rawCss = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf-8');
// Comments carry braces-free prose but would otherwise glue onto the selector
// captured before a rule, so drop them before parsing.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration block in the stylesheet, comment-stripped. Media-query
// headers end in `{` so they never leak into a captured selector.
function declarationBlocks(source) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(source))) {
    blocks.push({
      selector: match[1].trim().replace(/\s+/g, ' '),
      body: match[2],
    });
  }
  return blocks;
}

const blocks = declarationBlocks(css);

test('#main-content reserves the bottom nav in a --bottom-reserve property', () => {
  const mainRules = blocks.filter(b => b.selector === '#main-content');
  assert.ok(mainRules.length > 0, '#main-content rule is missing');
  assert.ok(
    mainRules.some(b => /--bottom-reserve\s*:[^;]*var\(--bottom-h\)/.test(b.body)),
    '#main-content must define --bottom-reserve from var(--bottom-h) — one source of truth for the nav height'
  );
});

test('#main-content pads by the reserve it defines', () => {
  const offenders = blocks
    .filter(b => b.selector === '#main-content')
    .filter(b => /(?:^|;|\s)padding(?:-bottom)?\s*:/.test(b.body))
    .filter(b => !/padding-bottom\s*:\s*var\(--bottom-reserve\)/.test(b.body) &&
                 !/padding\s*:[^;]*var\(--bottom-reserve\)/.test(b.body))
    .map(b => b.body.trim().split(';')[0]);

  assert.deepEqual(
    offenders,
    [],
    'these #main-content rules set padding without the bottom-nav reserve: ' + offenders.join(' | ')
  );
});

test('dashboard content reserves the bottom nav inside its own flow', () => {
  const wraps = blocks.filter(b => b.selector === '.dashboard-wrap');
  assert.ok(wraps.length >= 2, 'expected a base and a desktop .dashboard-wrap rule');

  const offenders = wraps
    .filter(b => /(?:^|;|\s)padding\s*:/.test(b.body))
    .filter(b => !/padding-bottom\s*:\s*calc\([^;]*var\(--bottom-reserve/.test(b.body))
    .map(b => b.body.trim());

  assert.deepEqual(
    offenders,
    [],
    'a `padding` shorthand on .dashboard-wrap overrides the reserve, so the last ' +
      'card on a dashboard tab ends up behind the fixed bottom nav: ' + offenders.join(' | ')
  );
});

test('hiding the bottom nav clears the reserve', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8');
  const fn = app.slice(app.indexOf('function updateNavForUser'));
  assert.ok(fn.length > 0, 'updateNavForUser() is missing from js/app.js');

  assert.ok(
    /setProperty\(\s*'--bottom-reserve'\s*,\s*'0px'\s*\)/.test(fn),
    "updateNavForUser() must set --bottom-reserve to 0px when the nav is hidden"
  );
  assert.ok(
    /removeProperty\(\s*'--bottom-reserve'\s*\)/.test(fn),
    'updateNavForUser() must restore --bottom-reserve when the nav is shown again'
  );
});

test('the storefront editor keeps a save action once its own header card is gone', () => {
  const vendor = fs.readFileSync(path.join(ROOT, 'js', 'vendor.js'), 'utf-8');
  assert.ok(
    /onclick="window\.saveVendorStoreSettings\('\$\{myStore\.id\}'\)"/.test(vendor),
    'the storefront tab must still expose a Save Settings action of its own'
  );
  assert.ok(/Save Settings/.test(vendor), 'the Save Settings label is missing');
});
