'use strict';
// Layout regression: the top nav is fixed and #main-content carries the single
// nav offset (margin-top: var(--nav-h)) — it is the app's scroll container.
// Every `position: sticky` element lives INSIDE that container, so a sticky
// `top` that also adds var(--nav-h) counts the nav twice: the element parks a
// nav-height below the scrollport's top edge and a blank strip opens between
// the nav and the page. That strip showed even at rest on the admin profile
// pages (whose sticky header is the first child) and appeared while scrolling
// on the filter bar, the rendor tabs and the public profile contact card.
//
// Viewport-anchored chrome (e.g. #vendor-tabs) must use `position: fixed`,
// never sticky — sticky `top` is measured from the scrollport, not the window.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rawCss = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf-8');
// Comments carry braces-free prose but would otherwise glue onto the selector
// captured before a rule, so drop them before parsing.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration block in the stylesheet, comment-stripped.
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

// Matches a `top` declaration whose value re-adds the nav height.
const NAV_OFFSET_TOP = /\btop\s*:\s*(?:calc\([^;]*--nav-h|var\(--nav-h)[^;]*/;

test('no sticky element offsets itself by the nav height', () => {
  const offenders = declarationBlocks(css)
    .filter(b => /position\s*:\s*sticky/.test(b.body) && NAV_OFFSET_TOP.test(b.body))
    .map(b => b.selector);

  assert.deepEqual(
    offenders,
    [],
    'sticky `top` is relative to #main-content (already below the fixed nav), so ' +
      'these rules double-count the nav and leave a blank strip: ' + offenders.join(' | ')
  );
});

test('#main-content carries the nav offset exactly once', () => {
  const blocks = declarationBlocks(css);
  const mainRules = blocks.filter(b => b.selector === '#main-content');
  assert.ok(mainRules.length > 0, '#main-content rule is missing');
  assert.ok(
    mainRules.some(b => /margin-top\s*:\s*var\(--nav-h\)/.test(b.body)),
    '#main-content must carry the single nav offset (margin-top: var(--nav-h))'
  );
});

test('page containers never re-apply the nav offset', () => {
  const offenders = declarationBlocks(css)
    .filter(b => /^\.page(?:\.active)?$/.test(b.selector))
    .filter(b => /(?:margin-top|padding-top)\s*:\s*var\(--nav-h\)/.test(b.body))
    .map(b => b.selector);

  assert.deepEqual(offenders, [], 'these page rules duplicate the #main-content nav offset: ' + offenders.join(' | '));
});
