'use strict';
// The storefront colour swatches, pinned here:
//
//   1. A native <input type="color"> opens the full palette on desktop, but on a
//      phone or tablet the OS sheet comes up on a grid of preset swatches first,
//      so the two views behaved differently. On a coarse pointer the swatch is now
//      our own chip (.sf-color-chip) that opens the in-app palette (.sfcp-*) in a
//      single tap, so mobile matches desktop. Desktop is untouched and still uses
//      the native picker.
//   2. The hidden <input type="color"> behind the chip keeps the SAME id, because
//      saveVendorStoreSettings() reads #store-primary-color by id — the save path
//      had to keep working unchanged.
//   3. The swatch is `store-primary-color` but the hex field beside it is
//      `store-primary-text`; resolving a `-text` suffix off the full id pointed at
//      an element that does not exist, so a picked colour updated the input but
//      left the hex field (and, on desktop, the live preview) behind. One write
//      path now updates all of them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

const vendor = read(path.join('js', 'vendor.js'));

// The module starts at its banner comment and ends where the next top-level
// assignment resumes.
const MODULE_START = vendor.indexOf('// ── In-app colour palette');
const MODULE_END = vendor.indexOf("window.previewActiveTab = 'home';");
assert.ok(MODULE_START !== -1 && MODULE_END > MODULE_START, 'the in-app colour palette module is missing from js/vendor.js');
const moduleSource = vendor.slice(MODULE_START, MODULE_END);

// ── A tiny DOM stand-in: the module only needs getElementById for the paths
// exercised here, and openStoreColorPicker() builds its own markup on demand. ──
function fakeDocument(ids) {
  const elements = {};
  for (const id of ids) elements[id] = { id, value: '', style: {}, textContent: '' };
  return {
    elements,
    document: { getElementById: id => elements[id] || null },
  };
}

// Run the shipped module against a fake window so the swatch markup and the
// write path are tested as they actually run, not by matching strings.
function loadPickerModule({ coarse, ids }) {
  const dom = fakeDocument(ids);
  const calls = { preview: 0 };
  const fakeWindow = {
    matchMedia: query => ({ matches: query.includes("(pointer: coarse)") && !!coarse, media: query }),
    updateStorefrontPreview: () => { calls.preview++; },
  };
  const factory = new Function(
    'window', 'document',
    moduleSource + '\nreturn { sfColorControlHTML: window.sfColorControlHTML, sfPrefersAppColorPicker: window.sfPrefersAppColorPicker, sfSyncColorChip: window.sfSyncColorChip, sfSetColorFromInput: window.sfSetColorFromInput, openStoreColorPicker: window.openStoreColorPicker, closeStoreColorPicker: window.closeStoreColorPicker };'
  );
  const mod = factory(fakeWindow, dom.document);
  return { mod, fakeWindow, ...dom, calls };
}

const COLOR_IDS = [
  'store-primary-color', 'store-primary-color-chip', 'store-primary-text',
  'store-secondary-color', 'store-secondary-color-chip', 'store-secondary-text',
];

test('a coarse pointer gets a chip that opens the palette in one tap', () => {
  const { mod } = loadPickerModule({ coarse: true, ids: COLOR_IDS });
  assert.equal(mod.sfPrefersAppColorPicker(), true, 'a touch device must take the in-app palette path');

  const html = mod.sfColorControlHTML('store-primary-color', '#e85d04', 'Primary Color');
  assert.ok(html.includes('id="store-primary-color-chip"'), 'the chip is what the vendor taps');
  assert.ok(html.includes('class="sf-color-chip"'), 'the chip must carry its styling hook');
  assert.ok(
    html.includes("onclick=\"window.openStoreColorPicker('store-primary-color', 'Primary Color')\""),
    'tapping the chip must open the palette straight away — no preset sheet in between'
  );
  assert.ok(html.includes('background:#e85d04'), 'the chip must start on the saved colour');

  // The value holder stays a real colour input with the original id, so the
  // existing save path (which reads #store-primary-color) is untouched.
  assert.ok(html.includes('id="store-primary-color"'), 'the hidden input must keep the id the save reads');
  assert.ok(/<input type="color" id="store-primary-color"[^>]*value="#e85d04"/.test(html), 'the saved colour must be held in the input');
  assert.ok(/id="store-primary-color"[^>]*display:none/.test(html), 'the native swatch must be hidden behind the chip');
});

test('a desktop pointer still gets the native colour input', () => {
  const { mod } = loadPickerModule({ coarse: false, ids: COLOR_IDS });
  assert.equal(mod.sfPrefersAppColorPicker(), false, 'a mouse must keep the native picker');

  const html = mod.sfColorControlHTML('store-primary-color', '#e85d04', 'Primary Color');
  assert.ok(!html.includes('sf-color-chip'), 'desktop must not render the chip');
  assert.ok(!html.includes('display:none'), 'the native swatch must be visible on desktop');
  assert.ok(/<input type="color" id="store-primary-color"[^>]*value="#e85d04"/.test(html), 'desktop keeps the native input');
});

test('picking a colour updates the input, the hex field, the chip and the preview', () => {
  const { mod, elements, calls } = loadPickerModule({ coarse: true, ids: COLOR_IDS });
  elements['store-primary-color'].value = '#e85d04';
  elements['store-primary-color-chip'].style.background = '#e85d04';
  elements['store-primary-text'].value = '#e85d04';

  mod.sfSetColorFromInput('store-primary-color', '#123456');

  assert.equal(elements['store-primary-color'].value, '#123456', 'the value holder must carry the choice');
  // The hex field is `store-primary-text`, NOT `store-primary-color-text`: this
  // resolution is what a picked colour used to miss.
  assert.equal(elements['store-primary-text'].value, '#123456', 'the hex field beside the swatch must follow');
  assert.equal(elements['store-primary-color-chip'].style.background, '#123456', 'the chip must repaint');
  assert.equal(calls.preview, 1, 'the live preview must repaint exactly once');

  // The secondary control is independent.
  assert.notEqual(elements['store-secondary-text'].value, '#123456', 'the other colour must not change');

  // A half-typed or malformed hex is ignored rather than written through.
  mod.sfSetColorFromInput('store-primary-color', '#12');
  assert.equal(elements['store-primary-color'].value, '#123456', 'a partial hex must not overwrite the colour');
  assert.equal(calls.preview, 1, 'an ignored value must not repaint the preview');
});

test('both swatches use the shared control and one write path', () => {
  // The editor markup must go through sfColorControlHTML(), not hand-rolled inputs.
  assert.ok(
    vendor.includes("${window.sfColorControlHTML('store-primary-color', sfPrimaryColor, 'Primary Color')}"),
    'the primary swatch must use the shared colour control'
  );
  assert.ok(
    vendor.includes("${window.sfColorControlHTML('store-secondary-color', sfSecondaryColor, 'Secondary Color')}"),
    'the secondary swatch must use the shared colour control'
  );
  assert.ok(
    !/<input type="color" id="store-primary-color"/.test(vendor),
    'no raw colour input may remain in the editor markup'
  );

  // Typing a hex by hand must repaint the chip too, or the two controls disagree.
  assert.ok(
    /id="store-primary-text"[^>]*oninput="[^"]*window\.sfSyncColorChip\('store-primary-color', this\.value\)/.test(vendor),
    'the primary hex field must repaint its chip while typing'
  );
  assert.ok(
    /id="store-secondary-text"[^>]*oninput="[^"]*window\.sfSyncColorChip\('store-secondary-color', this\.value\)/.test(vendor),
    'the secondary hex field must repaint its chip while typing'
  );

  // The theme presets change both colours at once, so they must move both chips.
  const comboStart = vendor.indexOf('window.applyColorCombo');
  assert.ok(comboStart !== -1, 'applyColorCombo() is missing');
  const combo = vendor.slice(comboStart, vendor.indexOf('function sfcpNormalizeHex', comboStart));
  assert.ok(combo.includes("window.sfSyncColorChip('store-primary-color', primary)"), 'a theme preset must repaint the primary chip');
  assert.ok(combo.includes("window.sfSyncColorChip('store-secondary-color', secondary)"), 'a theme preset must repaint the secondary chip');

  // The palette writes back through the one path, so nothing can drift.
  assert.ok(
    /window\.sfSetColorFromInput\(inputId, hex\)/.test(moduleSource),
    'the palette must push through the shared write path'
  );
});

test('the palette is exposed and styled for touch', () => {
  for (const fn of ['window.sfPrefersAppColorPicker', 'window.sfColorControlHTML', 'window.sfSyncColorChip', 'window.sfSetColorFromInput', 'window.openStoreColorPicker', 'window.closeStoreColorPicker']) {
    assert.ok(vendor.includes(`${fn} = function`), `${fn}() must be exposed`);
  }
  assert.ok(moduleSource.includes('(pointer: coarse)'), 'the touch check must key off a coarse pointer');
  assert.ok(/try \{[\s\S]*matchMedia[\s\S]*\} catch/.test(moduleSource), 'a missing matchMedia must fall back to the native picker, not throw');

  const styleStart = vendor.indexOf('.sf-color-chip{');
  const styleEnd = vendor.indexOf('</style>', styleStart);
  assert.ok(styleStart !== -1 && styleEnd > styleStart, 'the .sf-color-chip / .sfcp-* styles are missing');
  const styles = vendor.slice(styleStart, styleEnd);
  const squash = s => s.replace(/\s+/g, ' ').replace(/\s*([{};,:])\s*/g, '$1');

  for (const rule of ['.sf-color-chip{', '.sfcp-overlay{', '.sfcp-card{', '.sfcp-sv{', '.sfcp-hue{', '.sfcp-dot{']) {
    assert.ok(squash(styles).includes(rule), `${rule} is missing — the palette would render unstyled`);
  }
  // Dragging inside the square must pick a colour, not scroll the editor.
  assert.ok(/\.sfcp-sv\{[^}]*touch-action:none/.test(squash(styles)), '.sfcp-sv must own the touch gesture');
  assert.ok(
    squash(styles).includes('body.sfcp-open #main-content{overflow:hidden}'),
    'the editor must not scroll behind the open palette'
  );

  // Tapping the dimmed backdrop and the Done button both close it.
  assert.ok(
    /overlay\.addEventListener\('click', e => \{ if \(e\.target === overlay\) window\.closeStoreColorPicker\(\)/.test(moduleSource),
    'tapping the backdrop must dismiss the palette'
  );
  assert.ok(moduleSource.includes('onclick="window.closeStoreColorPicker()"'), 'the Done / close controls must dismiss the palette');
});
