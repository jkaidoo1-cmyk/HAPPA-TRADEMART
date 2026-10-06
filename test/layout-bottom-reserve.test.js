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

test('the app shell is sized from the visible viewport, not the large one', () => {
  // The reserve only works if the scroller ends where the user can SEE. On a
  // phone, 100vh is the large viewport (URL bar hidden), so a shell sized with
  // it runs past the bottom of the screen while the URL bar is up: the last
  // stretch of #main-content — the entire bottom-nav reserve — sits in that
  // off-screen strip and the final card on a page (the home page's Services
  // card was the report) stays cut off behind the nav with no way to scroll to
  // it. 100dvh tracks the dynamic viewport, so the reserve always lands on the
  // visible bottom edge.
  const shellRules = {
    html: blocks.filter(b => b.selector === 'html'),
    body: blocks.filter(b => b.selector === 'body'),
    '#main-content': blocks.filter(b => b.selector === '#main-content'),
  };

  for (const [selector, rules] of Object.entries(shellRules)) {
    assert.ok(rules.length > 0, `${selector} rule is missing`);
    assert.ok(
      rules.some(r => /dvh/.test(r.body)),
      `${selector} must be sized with dvh — with vh the bottom of the shell is off-screen on mobile`
    );
    // The vh line has to come first so browsers without dvh still get a value.
    for (const rule of rules.filter(r => /dvh/.test(r.body))) {
      const vhAt = rule.body.indexOf('100vh');
      const dvhAt = rule.body.indexOf('100dvh');
      assert.ok(
        vhAt !== -1 && vhAt < dvhAt,
        `the 100vh fallback must be declared before 100dvh in the ${selector} rule`
      );
    }
  }

  // The storefront view is full-bleed: no navs, so it fills the visible area.
  const sfRule = blocks.find(b => /is-storefront-view #main-content/.test(b.selector));
  assert.ok(sfRule, 'the storefront-view #main-content rule is missing');
  assert.ok(/height\s*:\s*100vh\s*;\s*height\s*:\s*100dvh/.test(sfRule.body),
    'the storefront shell must set 100dvh with a 100vh fallback');
  assert.ok(/padding-bottom\s*:\s*0/.test(sfRule.body),
    'the storefront shell must clear the bottom-nav reserve');

  // …and showPage() must not re-lock the height with an inline 100vh.
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8');
  assert.ok(
    !/mainContent\.style\.height\s*=\s*'100vh'/.test(app),
    "showPage() must not pin #main-content to 100vh inline — it overrides the CSS dvh"
  );
});

test('full-height pages inside the shell use dvh too', () => {
  const files = [
    ['js/marketplace.js', fs.readFileSync(path.join(ROOT, 'js', 'marketplace.js'), 'utf-8')],
    ['js/auth.js', fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf-8')],
    ['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8')],
  ];
  for (const [name, src] of files) {
    const vhUses = src.match(/min-height:100vh/g) || [];
    const dvhUses = src.match(/min-height:100dvh/g) || [];
    assert.ok(vhUses.length > 0, `${name} should still carry a 100vh fallback`);
    assert.equal(
      dvhUses.length,
      vhUses.length,
      `${name}: every min-height:100vh needs a matching min-height:100dvh, or that page keeps a strip of unreachable space`
    );
  }
});

test('the storefront editor keeps a save action once its own header card is gone', () => {
  const vendor = fs.readFileSync(path.join(ROOT, 'js', 'vendor.js'), 'utf-8');
  assert.ok(
    /onclick="window\.saveVendorStoreSettings\('\$\{myStore\.id\}'\)"/.test(vendor),
    'the storefront tab must still expose a Save Settings action of its own'
  );
  assert.ok(/Save Settings/.test(vendor), 'the Save Settings label is missing');
});
