'use strict';
// Icon codepoint snapshot guard.
//
// tools/subset-icons.py trims the bundled Font Awesome CSS and fonts down to
// the icons the app actually uses. A previous revision of that script deleted
// only the tail of a grouped alias rule, so the group's surviving selectors
// were glued onto the NEXT rule's codepoint — 34 icons silently drew the wrong
// glyph (the home icon rendered as something else entirely). Nobody noticed
// until it was on a phone, because a remapped icon is still a crisp, valid
// glyph.
//
// The subsetter now refuses to write a remapped class, and this test keeps a
// snapshot of the ORIGINAL codepoints (taken from the pristine 6.4.0
// stylesheet, see test/icon-codepoints.fixture.json) so any future trim or
// hand edit fails here instead of in the UI.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'icon-codepoints.fixture.json'), 'utf-8'));
const css = fs.readFileSync(path.join(ROOT, 'css', 'vendor', 'fontawesome.min.css'), 'utf-8');

// Exactly the subsetter's rules: a content rule may list a GROUP of aliases,
// and every selector in the group maps to that rule's codepoint.
const CONTENT_RULE = /([^{}]*)\{content:"\\([0-9a-fA-F]{2,5})"\}/g;
const CLASS_IN_SELECTORS = /\.fa-([A-Za-z0-9-]+):before/g;

const map = {};
for (const rule of css.matchAll(CONTENT_RULE)) {
  const cp = '\\' + rule[2].toLowerCase().padStart(4, '0');
  for (const name of rule[1].matchAll(CLASS_IN_SELECTORS)) map[name[1]] = cp;
}

test('every snapshotted icon keeps its original codepoint', () => {
  assert.ok(Object.keys(map).length > 100, `the stylesheet only maps ${Object.keys(map).length} icons — it looks truncated`);
  const missing = [];
  const remapped = [];
  for (const [name, cp] of Object.entries(snapshot)) {
    if (!(name in map)) missing.push(name);
    else if (map[name] !== cp) remapped.push(`${name}: ${cp} -> ${map[name]}`);
  }
  assert.deepEqual(missing, [], `icon classes lost their rule: ${missing.join(', ')}`);
  assert.deepEqual(remapped, [], `icon classes were remapped to a wrong glyph: ${remapped.join(', ')}`);
});

test('the reported regression: the home icon still draws U+F015', () => {
  assert.equal(map.home, '\\f015');
  // A few more navigation anchors that a bad trim must not move.
  assert.equal(map['shopping-cart'], '\\f07a');
  assert.equal(map.user, '\\f007');
  assert.equal(map['map-marker-alt'], '\\f3c5');
});
