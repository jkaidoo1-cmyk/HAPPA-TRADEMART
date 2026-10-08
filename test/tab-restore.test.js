'use strict';
// A tab (or panel) that only fills in when you click it again.
//
// Two reported symptoms, one class of bug: the thing you were looking at came
// back EMPTY after a reload or a re-render, and only a second click on its tab
// brought it back.
//
//   1. The Storefront tab (and every other dashboard tab) was remembered in
//      memory only (`App.activeTab`), so a reload fell back to the first tab —
//      and for a tab whose body is built by its own onclick, nothing filled it
//      when the markup came back "active".
//   2. The mobile live-preview drawer kept its open state on `document.body`
//      (`sf-preview-open`) while a dashboard re-render replaced the drawer with
//      a fresh, closed one. The CSS hid the preview handle whenever that stale
//      flag was present, so the only control that could reopen the drawer was
//      invisible and unclickable — "empty until I click the tab again", because
//      switching tabs was the one thing that cleared the flag.
//
// The rules asserted here, so neither can come back:
//   • `switchTab` persists the active tab and the app restores it on boot.
//   • Every `.tab-content` carries an `active` conditional (a remembered tab
//     must be visible) and every lazily-built tab has a hydration loader equal
//     to the function its button runs.
//   • Overlay open-state lives on the overlay NODES, and the body flags are
//     cleared by `sfResetPreviewOverlays()` on every render/navigation; the
//     preview handle's hidden style is keyed on the handle's own class.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const utilsSrc = read('js/utils.js');
const vendorSrc = read('js/vendor.js');
const appSrc = read('js/app.js');

// Whole-line comments only. A naive block-comment stripper pairs an unmatched
// `/*` with a much later `*/` in files that embed HTML/CSS in template
// literals and deletes real code (confirmed in js/vendor.js) — which made the
// assertions below pass by scanning nothing.
function stripComments(src) {
  return src
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .filter(line => !/^\s*\/\*.*\*\/\s*$/.test(line))
    .join('\n');
}

// ── Minimal DOM doubles ─────────────────────────────────────────────────────
function classListMock(initial = []) {
  const set = new Set(initial);
  return {
    add(...cs) { cs.forEach(c => set.add(c)); },
    remove(...cs) { cs.forEach(c => set.delete(c)); },
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    contains(c) { return set.has(c); },
    _set: set,
  };
}

// ── switchTab: the tab a reload must come back to ───────────────────────────
const SWITCH_START = utilsSrc.indexOf('function switchTab(el, tabId) {');
const SWITCH_END = utilsSrc.indexOf('window.switchTab = switchTab;');
assert.ok(SWITCH_START > -1 && SWITCH_END > SWITCH_START, 'switchTab() is missing from js/utils.js');

function runSwitchTab(pageId, tabId) {
  const container = { querySelectorAll: () => [] };
  const target = { classList: classListMock(), closest: () => container };
  const doc = {
    getElementById: id => (id === tabId ? target : (id === 'main-content' ? container : null)),
    body: { classList: classListMock() },
  };
  const App = { currentPage: pageId, activeTab: {} };
  const writes = {};
  const localStorage = { setItem: (k, v) => { writes[k] = v; }, getItem: () => null };
  const win = { scrollTo() {}, sfResetPreviewOverlays() {}, addEventListener() {} };
  const switchTab = new Function(
    'document', 'App', 'localStorage', 'window', 'console',
    utilsSrc.slice(SWITCH_START, SWITCH_END) + '\nreturn switchTab;'
  )(doc, App, localStorage, win, { warn() {}, log() {} });

  switchTab(target, tabId);
  return { App, writes };
}

test('switchTab remembers the active tab across a reload', () => {
  const { App, writes } = runSwitchTab('vendor-dashboard', 'vendor-storefront');
  assert.equal(App.activeTab['vendor-dashboard'], 'vendor-storefront', 'the in-memory tab was not recorded');
  assert.ok(writes.happa_active_tab, 'the active tab was never persisted — a reload loses it');
  assert.deepEqual(JSON.parse(writes.happa_active_tab), { 'vendor-dashboard': 'vendor-storefront' });
});

test('the app restores the remembered tab at boot', () => {
  const src = stripComments(appSrc);
  const readLine = src.match(/JSON\.parse\(localStorage\.getItem\('happa_active_tab'\)/);
  assert.ok(readLine, 'app.js never reads happa_active_tab, so a reload starts on the first tab again');
  assert.match(src, /App\.activeTab\s*=\s*savedTabs/, 'the remembered tab is read but never applied');
});

// ── Every tab must be able to appear ────────────────────────────────────────
const DASHBOARDS = ['js/buyer.js', 'js/rendor.js', 'js/admin.js', 'js/vendor.js'];

test('no dashboard tab can be remembered yet remain invisible', () => {
  for (const file of DASHBOARDS) {
    const src = stripComments(read(file));
    const bare = src.match(/class="tab-content"/g) || [];
    assert.equal(
      bare.length,
      0,
      `${file} has ${bare.length} tab body(ies) with no "active" conditional — a restored tab renders as an empty page`
    );
    assert.match(src, /App\.activeTab/, `${file} does not read the remembered tab at all`);
  }
});

test('every dashboard tab is reachable from its own markup', () => {
  for (const file of DASHBOARDS) {
    const src = stripComments(read(file));
    const ids = [...src.matchAll(/class="tab-content \$\{[^}]*\}"\s+id="([\w-]+)"/g)].map(m => m[1]);
    assert.ok(ids.length > 0, `${file} has no remembered tab markup`);
    for (const id of ids) {
      assert.ok(
        new RegExp(`switchTab\\([^)]*'${id}'\\)`).test(src),
        `${file}: tab #${id} has no switchTab call, so nothing can ever open it`
      );
    }
  }
});

// ── Lazily-built tab bodies must be hydrated ────────────────────────────────
test('every lazily-built tab is hydrated with the loader its button calls', () => {
  const expected = {
    'js/vendor.js': [
      ['vendor-wallet', 'renderWalletHistory'],
    ],
    'js/buyer.js': [
      ['buyer-addresses', 'renderBuyerAddresses'],
      ['buyer-reviews', 'renderBuyerReviews'],
    ],
    'js/rendor.js': [
      ['rendor-subscription', 'renderRendorSubscription'],
      ['rendor-verify', 'renderRendorVerify'],
    ],
    'js/admin.js': [
      // The admin dashboard hydrates with its own if/else chain rather than the
      // shared helper, but every lazy tab must still be covered.
      ['admin-orders', 'refreshAdminOrdersList'],
      ['admin-rendors', 'loadAdminRendors'],
      ['admin-storefronts', 'renderAdminStorefronts'],
      ['admin-ads', 'loadAdminAds'],
      ['admin-referrals', 'loadAdminReferrals'],
      ['admin-support', 'loadAdminSupport'],
      ['admin-settings', 'loadAdminSettings'],
    ],
  };

  for (const [file, pairs] of Object.entries(expected)) {
    const src = stripComments(read(file));
    // Whitespace-normalised and regex-free on purpose: a RegExp built from the
    // tab's own name also matched the tab BUTTON line, so a removed hydration
    // call still "passed". What is asserted here is the call site itself.
    const flat = src.replace(/[\s]+/g, ' ');
    for (const [tabId, loader] of pairs) {
      if (file === 'js/admin.js') {
        // The admin dashboard hydrates with its own if/else chain.
        const chain = `else if (activeTabId === '${tabId}' && typeof ${loader} === 'function') { ${loader}();`;
        assert.ok(
          flat.includes(chain),
          `${file}: a restored #${tabId} is never hydrated — it will come back empty`
        );
      } else {
        const entry = `'${tabId}': () => ${loader}(`;
        assert.ok(
          flat.includes(entry),
          `${file}: a restored #${tabId} is never hydrated — it will come back empty`
        );
      }
      // …and the loader really is what the button runs, so the two cannot drift.
      assert.ok(
        flat.includes(`,'${tabId}');${loader}(`),
        `${file}: #${tabId} is hydrated with ${loader}() but its button calls something else`
      );
    }
    if (file !== 'js/admin.js') {
      assert.ok(
        flat.includes('hydrateActiveTab(activeTabId, {'),
        `${file} does not use the shared hydration helper`
      );
    }
  }
});

test('the shared hydration helper exists in the always-loaded bundle', () => {
  assert.match(utilsSrc, /function hydrateActiveTab\(tabId, loaders\)/, 'hydrateActiveTab() is missing');
  assert.match(utilsSrc, /window\.hydrateActiveTab\s*=\s*hydrateActiveTab/, 'hydrateActiveTab is not exported');
});

// ── The mobile preview drawer ───────────────────────────────────────────────
const PREVIEW_START = vendorSrc.indexOf('window.sfTogglePreview = function(open) {');
const PREVIEW_END = vendorSrc.indexOf('window.createStorefrontDraft = async function(');
assert.ok(PREVIEW_START > -1 && PREVIEW_END > PREVIEW_START, 'the preview toggle is missing from js/vendor.js');

const PREVIEW_SRC = vendorSrc.slice(PREVIEW_START, PREVIEW_END);

function makePreviewDom({ panelOpen = false, bodyClasses = [] } = {}) {
  const state = {
    panel: { classList: classListMock(panelOpen ? ['open'] : []) },
    backdrop: { classList: classListMock() },
    handle: {
      classList: classListMock(),
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
    },
    body: { classList: classListMock(bodyClasses) },
  };
  const doc = {
    getElementById: id => ({
      'sf-preview-panel': state.panel,
      'sf-preview-backdrop': state.backdrop,
      'sf-preview-handle': state.handle,
    }[id] || null),
    querySelectorAll: () => [],
    body: state.body,
  };
  const win = {
    paintCalls: 0,
    updateStorefrontPreview() { this.paintCalls++; },
  };
  const api = new Function(
    'window', 'document', 'console',
    PREVIEW_SRC + '\nreturn { sfTogglePreview: window.sfTogglePreview, sfResetPreviewOverlays: window.sfResetPreviewOverlays };'
  )(win, doc, { warn() {} });
  return { state, win, ...api };
}

test('the preview handle is hidden by its own state, never by a stale body flag', () => {
  const css = vendorSrc;
  assert.match(
    css,
    /\.sf-preview-handle\.is-open\{opacity:0;pointer-events:none\}/,
    'the handle must be hidden by its own class'
  );
  assert.ok(
    !/body\.sf-preview-open\s+\.sf-preview-handle/.test(css),
    'the handle is hidden by body.sf-preview-open again — a re-render will make it unclickable'
  );
  assert.match(
    PREVIEW_SRC,
    /panel\.classList\.contains\('open'\)/,
    'the toggle must read the drawer\'s own open state, not the body flag'
  );
});

test('a re-render cannot leave the preview drawer unreachable', () => {
  // The reported sequence: drawer open, dashboard re-renders (new nodes), then
  // the render's reset runs. Nothing may stay hidden or stuck.
  const dom = makePreviewDom();
  dom.sfTogglePreview();
  assert.ok(dom.state.panel.classList.contains('open'), 'the drawer did not open');
  assert.ok(dom.state.handle.classList.contains('is-open'), 'an open drawer should hide its handle');
  assert.equal(dom.win.paintCalls, 1, 'opening the drawer must paint the live preview');

  // Re-render: the dashboard swaps in fresh, closed nodes while the body keeps
  // the flags (that is exactly what the old code did).
  dom.state.panel = { classList: classListMock() };
  dom.state.backdrop = { classList: classListMock() };
  dom.state.handle = { classList: classListMock(), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };

  dom.sfResetPreviewOverlays();

  assert.equal(dom.state.body.classList.contains('sf-preview-open'), false, 'the stale flag survived a render');
  assert.equal(dom.state.body.classList.contains('sfcp-open'), false, 'the colour-picker flag survived a render');
  assert.equal(dom.state.handle.classList.contains('is-open'), false, 'the fresh handle came back hidden');
  assert.equal(dom.state.handle.attrs['aria-expanded'], 'false');

  // And the drawer can be opened again, which is what the user could not do.
  dom.sfTogglePreview();
  assert.ok(dom.state.panel.classList.contains('open'), 'the drawer could not be reopened after a render');
});

test('the reset drops a stale flag even when no overlay node is left', () => {
  const dom = makePreviewDom({ bodyClasses: ['sf-preview-open', 'sfcp-open'] });
  dom.sfResetPreviewOverlays();
  assert.equal(dom.state.body.classList.contains('sf-preview-open'), false);
  assert.equal(dom.state.body.classList.contains('sfcp-open'), false);
});

test('every re-render and navigation clears the overlay flags', () => {
  // Each call site is asserted by its guarded call, not by the helper's name
  // merely appearing somewhere in the file (its own definition would match).
  const CALLED_AFTER_A_RENDER = /typeof window\.sfResetPreviewOverlays === 'function'\) window\.sfResetPreviewOverlays\(\);/;
  assert.match(
    vendorSrc,
    CALLED_AFTER_A_RENDER,
    'renderVendorDashboard does not clear overlay state after replacing the markup'
  );
  const NAVIGATION_CALL = /if \(App\.prevPage !== pageId && typeof window\.sfResetPreviewOverlays === 'function'\) \{\s*window\.sfResetPreviewOverlays\(\);/;
  assert.match(
    stripComments(appSrc),
    NAVIGATION_CALL,
    'showPage does not clear overlay state when leaving the page that owns it'
  );
  const TAB_SWITCH_CALL = /if \(typeof window\.sfResetPreviewOverlays === 'function'\) \{\s*window\.sfResetPreviewOverlays\(\);/;
  assert.match(
    stripComments(utilsSrc),
    TAB_SWITCH_CALL,
    'switchTab does not clear overlay state on a tab switch'
  );
});
