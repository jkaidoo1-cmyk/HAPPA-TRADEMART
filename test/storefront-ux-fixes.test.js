'use strict';
// Four storefront UX regressions, pinned here:
//
//   1. The wishlist heart never changed when clicked. Two toggleWishlist()
//      definitions existed — a no-op stub in marketplace.js and the real one in
//      buyer.js — so which ran depended on script order, and neither repainted
//      the icon. There is now one implementation (js/utils.js) that writes
//      localStorage AND repaints every rendered heart.
//   2. Reloading the vendor dashboard on the Storefront tab showed an empty
//      panel until the tab was clicked again. Only the Overview tab-content
//      carried the remembered `active` class, so every other tab rendered
//      display:none; clicking re-ran switchTab and revealed it.
//   3. The storefront editor's live preview was inline and shrank to an
//      unreadable mock on a phone. It is now a pull-out side panel there.
//   4. The storefront footer buried the social icons in the About column; they
//      now sit at the bottom of the footer, above the copyright line.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

const vendor = read(path.join('js', 'vendor.js'));
const marketplace = read(path.join('js', 'marketplace.js'));
const buyer = read(path.join('js', 'buyer.js'));
const utils = read(path.join('js', 'utils.js'));
const css = read(path.join('css', 'style.css'));

// ── A tiny DOM stand-in, just enough to run the real syncWishlistIcons() ──────
function classList(initial = []) {
  const set = new Set(initial);
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
  };
}

function fakeDom(productIds) {
  const btns = productIds.map(id => {
    const icon = { classList: classList(['far', 'fa-heart']) };
    return {
      dataset: { wishlistId: String(id) },
      classList: classList(),
      attrs: {},
      icon,
      setAttribute(name, value) { this.attrs[name] = String(value); },
      querySelector(sel) { return sel === 'i' ? this.icon : null; },
    };
  });
  const stat = { textContent: '' };
  return {
    btns,
    stat,
    document: {
      querySelectorAll: sel => (sel === '[data-wishlist-id]' ? btns : []),
      getElementById: id => (id === 'wishlist-stat-count' ? stat : null),
    },
  };
}

// Run the shipped wishlist helpers against a fake storage + DOM.
function loadWishlistModule(dom) {
  const start = utils.indexOf("const WISHLIST_KEY = 'happa_wishlist';");
  const endMarker = 'window.toggleWishlist = toggleWishlist;';
  const end = utils.indexOf(endMarker);
  assert.ok(start !== -1 && end !== -1, 'the wishlist helpers are missing from js/utils.js');

  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const toasts = [];
  const fakeWindow = {};

  const body = utils.slice(start, end + endMarker.length);
  const factory = new Function(
    'window', 'document', 'localStorage', 'showToast',
    body + '\nreturn { wishlistIds, isInWishlist, syncWishlistIcons, toggleWishlist };'
  );
  const mod = factory(fakeWindow, dom.document, localStorage, (msg, kind) => toasts.push([msg, kind]));
  return { mod, store, toasts, fakeWindow };
}

test('the wishlist has exactly one implementation, shared by every page', () => {
  assert.ok(
    utils.includes('window.toggleWishlist = toggleWishlist;'),
    'js/utils.js must expose the single toggleWishlist()'
  );
  assert.ok(
    !/^\s*function toggleWishlist\s*\(/m.test(marketplace),
    'the no-op stub in js/marketplace.js must be gone — it shadowed the real one'
  );
  assert.ok(
    !/window\.toggleWishlist\s*=/.test(buyer),
    'js/buyer.js must not define a second toggleWishlist()'
  );
  assert.ok(
    /data-wishlist-id="\$\{escHtml\(p\.id\)\}"/.test(marketplace),
    'the product-detail heart must carry data-wishlist-id so the icon can be repainted'
  );
});

test('clicking the heart stores the id and flips the icon', () => {
  const dom = fakeDom(['p1', 'p2']);
  const { mod, store, toasts } = loadWishlistModule(dom);
  const btn = dom.btns[0];

  assert.equal(mod.isInWishlist('p1'), false, 'nothing is saved yet');
  assert.ok(btn.icon.classList.contains('far'), 'the heart starts as the outline glyph');

  mod.toggleWishlist('p1');

  assert.equal(store['happa_wishlist'], '["p1"]', 'the id must be persisted');
  assert.ok(btn.icon.classList.contains('fas'), 'the heart must switch to the solid glyph');
  assert.ok(!btn.icon.classList.contains('far'), 'the outline glyph must be removed');
  assert.ok(btn.classList.contains('is-wished'), 'the saved colour class must be applied');
  assert.equal(btn.attrs['aria-pressed'], 'true', 'aria-pressed must reflect the saved state');
  assert.equal(btn.attrs.title, 'Remove from wishlist', 'the tooltip must follow the state');
  assert.equal(dom.stat.textContent, 1, 'the wishlist counter must update');
  assert.deepEqual(toasts, [['Added to wishlist! 💖', 'success']], 'the toast must confirm the add');

  // Clicking again reverses everything.
  mod.toggleWishlist('p1');
  assert.equal(store['happa_wishlist'], '[]', 'the id must be removed');
  assert.ok(btn.icon.classList.contains('far'), 'the heart must go back to the outline glyph');
  assert.ok(!btn.classList.contains('is-wished'), 'the saved colour class must be removed');
  assert.equal(btn.attrs.title, 'Save to wishlist', 'the tooltip must go back too');
  assert.equal(dom.stat.textContent, 0, 'the counter must drop back to zero');

  // A different product is unaffected.
  assert.ok(dom.btns[1].icon.classList.contains('far'), 'the other card must not change');
});

test('a previously saved item repaints as a filled heart', () => {
  const dom = fakeDom(['p1', 'p2']);
  const { mod, store } = loadWishlistModule(dom);
  store['happa_wishlist'] = JSON.stringify(['p2']);

  mod.syncWishlistIcons();

  assert.ok(dom.btns[1].icon.classList.contains('fas'), 'the saved product must show a filled heart');
  assert.ok(dom.btns[0].icon.classList.contains('far'), 'the unsaved product must stay an outline');
  assert.equal(dom.stat.textContent, 1, 'the counter must match storage');

  // Stored ids are compared as strings, so a numeric id still matches.
  assert.equal(mod.isInWishlist('p2'), true);
  assert.equal(mod.isInWishlist(2), false);
});

test('the product detail page paints the heart from storage', () => {
  assert.ok(
    /const wished = isInWishlist\(p\.id\);/.test(marketplace),
    'renderProductDetail() must read the saved state before rendering the heart'
  );
  assert.ok(
    /class="\$\{wished \? 'fas' : 'far'\} fa-heart"/.test(marketplace),
    'the heart glyph must depend on the saved state'
  );
  assert.ok(
    /\.wishlist-btn\.is-wished\s*\{[^}]*color/.test(css),
    'the saved heart needs a colour rule in css/style.css'
  );
});

test('every vendor tab honours the remembered tab', () => {
  for (const id of ['vendor-overview', 'vendor-storefront', 'vendor-products', 'vendor-wallet', 'vendor-referral', 'vendor-verify']) {
    assert.ok(
      vendor.includes(`<div class="tab-content \${activeTabId === '${id}' ? 'active' : ''}" id="${id}">`),
      `#${id} must be marked active when it is the remembered tab, or a reload renders it empty`
    );
  }
  assert.ok(
    !/class="tab-content" id="vendor-/.test(vendor),
    'no conditionally-unmarked vendor tab-content may remain'
  );
  // The wallet tab's transaction list is built by its click handler, which a
  // render-restored tab never runs — so the render pass must hydrate it.
  assert.ok(
    /if \(activeTabId === 'vendor-wallet'\) \{\s*try \{ renderWalletHistory\('vendor-txn-list'\); \}/.test(vendor),
    'restoring the Wallet tab must hydrate its transaction list'
  );
});

test('the live preview is a pull-out side panel on mobile', () => {
  const styleStart = vendor.indexOf('.sf-preview-panel{');
  const styleEnd = vendor.indexOf('</style>', styleStart);
  assert.ok(styleStart !== -1 && styleEnd > styleStart, 'the .sf-preview-* styles are missing');
  const styles = vendor.slice(styleStart, styleEnd);

  for (const id of ['sf-preview-panel', 'sf-preview-handle', 'sf-preview-backdrop']) {
    assert.ok(vendor.includes(`id="${id}"`), `#${id} markup is missing from the editor`);
  }
  assert.ok(
    vendor.includes('window.sfTogglePreview = function'),
    'a toggle handler is needed to pull the panel out'
  );
  assert.ok(
    vendor.includes("onclick=\"window.sfTogglePreview()\""),
    'the handle must open the panel'
  );

  // Collapse the author's indentation but keep descendant spaces (those matter
  // for `body.sf-preview-open .sf-preview-handle`).
  const squash = s => s.replace(/\s+/g, ' ').replace(/\s*([{};,])\s*/g, '$1');

  // Off-canvas by default on narrow screens, slid in by the .open class.
  assert.ok(
    /@media \(max-width:1023px\)\{/.test(styles),
    'the drawer rules must be scoped to narrow screens so desktop keeps the inline preview'
  );
  assert.ok(
    squash(styles).includes('.sf-preview-panel.open{transform:translateX(0)}'),
    'the open panel must slide to translateX(0)'
  );
  assert.ok(
    /\.sf-preview-panel\{[^}]*transform:translateX\(105%\)/.test(styles),
    'the panel must start off-canvas'
  );
  assert.ok(
    squash(styles).includes('.sf-preview-handle,.sf-preview-backdrop,.sf-preview-close{display:none}'),
    'the handle, backdrop and close button must be hidden on desktop'
  );
  assert.ok(
    squash(styles).includes('body.sf-preview-open .sf-preview-handle{opacity:0;pointer-events:none}'),
    'the handle must hide while the drawer is open'
  );
  // The pull tab is a white chip with an orange outline, not a solid orange
  // block competing with the Save button.
  const handle = styles.match(/\.sf-preview-handle\{[^}]*\}/);
  assert.ok(handle, 'the .sf-preview-handle rule is missing');
  assert.ok(
    squash(handle[0]).includes('background:#fff'),
    'the pull tab must have a white background'
  );
  assert.ok(
    /border:1\.5px solid var\(--primary\);border-right:0/.test(squash(handle[0])),
    'the pull tab must carry an orange border'
  );
  assert.ok(
    squash(handle[0]).includes('color:var(--primary)'),
    'the pull tab label and icon must be orange'
  );
  assert.ok(
    styles.includes('var(--nav-h)') && styles.includes('var(--bottom-h)'),
    'the drawer must sit between the fixed top nav and the bottom nav'
  );
  // Leaving the storefront tab must not leave the overlay on top of another tab.
  const switchTab = vendor.slice(vendor.indexOf('function switchTab('));
  assert.ok(
    /sfTogglePreview\(false\)/.test(switchTab.slice(0, 2000)),
    'switchTab() must close the preview drawer'
  );
});

test('the live preview shows the footer fields the editor collects', () => {
  const fnStart = vendor.indexOf('window.updateStorefrontPreview = function()');
  const fnEnd = vendor.indexOf('window.handleStoreNameChange', fnStart);
  assert.ok(fnStart !== -1 && fnEnd > fnStart, 'updateStorefrontPreview() is missing');
  const preview = vendor.slice(fnStart, fnEnd);

  // Every footer field the editor saves has to be read by the preview…
  for (const id of ['store-description', 'store-hours', 'store-shipping-policy', 'store-return-policy', 'store-whatsapp', 'store-instagram', 'store-tiktok']) {
    assert.ok(
      preview.includes(`document.getElementById('${id}')`),
      `the preview must read #${id} — a field the editor saves cannot preview blank`
    );
  }

  // …and actually rendered. Reading a value into a variable that never reaches
  // the markup is exactly how hours/shipping/returns went missing before.
  const footer = preview.slice(preview.indexOf('const footerHTML ='));
  assert.ok(footer.length > 0, 'the preview footer markup is missing');
  for (const token of ['${escHtml(desc)}', '${escHtml(hours)}', '${escHtml(shipping)}', '${escHtml(returns)}']) {
    assert.ok(footer.includes(token), `the preview footer must render ${token}`);
  }
  for (const kind of ['whatsapp', 'instagram', 'tiktok']) {
    assert.ok(
      preview.includes(`socialHref('${kind}', ${kind})`),
      `the preview footer must build the ${kind} link through socialHref()`
    );
  }

  // The social row belongs at the bottom of the footer, above the copyright,
  // matching the real storefront footer.
  const socialAt = footer.indexOf('${prevSocialHTML}');
  const copyrightAt = footer.indexOf('Powered by HAPPA TRADEMART');
  assert.ok(socialAt !== -1, 'the preview footer must render the social row');
  assert.ok(socialAt < copyrightAt, 'the preview socials must sit above the copyright line');
});

test('the footer social icons sit at the bottom of the storefront footer', () => {
  const gridEnd = marketplace.indexOf('<!-- Social icons live at the very bottom');
  const socialAt = marketplace.indexOf('${socialLinksHTML}', gridEnd === -1 ? 0 : gridEnd);
  const copyrightAt = marketplace.lastIndexOf('Powered by HAPPA TRADEMART');

  assert.ok(gridEnd !== -1, 'the bottom social row is missing from the storefront footer');
  assert.ok(socialAt > gridEnd, 'socialLinksHTML must be rendered after the footer grid');
  assert.ok(
    socialAt < copyrightAt,
    'the icons must sit above the copyright line, at the bottom of the footer'
  );
  // …and no longer inside the About column.
  assert.ok(
    !/\$\{escHtml\(description\)\}<\/p>\s*\n\s*\$\{socialLinksHTML\}/.test(marketplace),
    'the social row must no longer be nested under the About paragraph'
  );
  // There is exactly one social row, so the icons cannot render twice.
  assert.equal(
    marketplace.split('${socialLinksHTML}').length - 1,
    1,
    'socialLinksHTML must be interpolated exactly once'
  );
  const row = marketplace.slice(marketplace.indexOf('sf-footer-socials-row'));
  assert.ok(
    /justify-content:center/.test(row.slice(0, 200)),
    'the bottom social row must be centred'
  );
});
