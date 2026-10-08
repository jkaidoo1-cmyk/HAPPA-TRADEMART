'use strict';
// The real price helpers, for test harnesses that run ONE function out of a
// client bundle in isolation.
//
// Those harnesses stub the cross-file globals a function reaches for
// (escHtml, itemDisplayName, getCommission…). Now that prices are read through
// priceNumber/priceText/priceAmount/discountPercent, a harness that does not
// provide them fails with "priceNumber is not defined" — a harness gap, not a
// bug in the code under test. Rather than re-implementing the helpers (which
// would let the stub and the shipped rule drift), this loads the real
// declarations straight out of js/utils.js.
//
//   DECLARATIONS — bare `function …` source. Prepend it to the body handed to
//                  `new Function(...)`, or run it in a vm context, so the
//                  extracted function closes over the real implementations.
//   create(win)  — DECLARATIONS plus the window.* exports, for a stub `window`.

const fs = require('node:fs');
const path = require('node:path');

const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf-8');

const START = utilsSrc.indexOf('// ── Price display helper');
const BEFORE_EXPORTS = utilsSrc.indexOf('// Explicit globals:');
const END = utilsSrc.indexOf('window.priceInputValue = priceInputValue;');

if (START === -1 || BEFORE_EXPORTS === -1 || END === -1 || !(START < BEFORE_EXPORTS && BEFORE_EXPORTS < END)) {
  throw new Error('the price helpers could not be located in js/utils.js');
}

// Declarations only: no `window.x = x` assignments, so this is safe to run in a
// harness that has no `window` parameter.
const DECLARATIONS = utilsSrc.slice(START, BEFORE_EXPORTS);

const WITH_EXPORTS = utilsSrc.slice(START, END) + '\nwindow.priceInputValue = priceInputValue;';

function create(win) {
  const target = win || {};
  new Function('window', WITH_EXPORTS)(target);
  return target;
}

module.exports = { DECLARATIONS, create };
