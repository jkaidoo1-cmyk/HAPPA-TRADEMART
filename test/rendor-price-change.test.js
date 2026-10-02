'use strict';
// The rendor subscription fee, and what happens when admin changes it.
//
// The reported bug: admin set the fee to GHS 10, the rendor's page still showed
// the generic GHS 30, and paying produced a wall of text about a rejected
// request. Three separate things had to hold, and each is asserted here:
//
//   1. The fee is per month and the admin's own screens charge fee × months, so
//      the rendor's card must quote the same total the server will charge.
//   2. A price that moved while the payment screen was open must not be charged
//      silently and must not be refused in transport language — the response
//      names the new fee in a sentence and is tagged so the UI can re-quote.
//   3. The fee always comes from the server (per-rendor override first, then the
//      global setting). A client can never name its own price, but its offered
//      amount is still constrained to a server-derived figure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const wallet = require('../lib/wallet.js');

// Minimal wallet adapter — the engine only needs these methods.
function makeAdapter({ price = '10', override = null, balance = 0 } = {}) {
  const state = {
    user: {
      id: 'rendor-1',
      wallet_balance: balance,
      rendor_sub_status: null,
      rendor_sub_expiry: null,
      rendor_sub_price_override: override,
    },
    txns: [],
    revenue: [],
  };
  return {
    state,
    loadUser: async () => state.user,
    saveUser: async (id, patch) => { state.user = { ...state.user, ...patch }; return true; },
    getSetting: async (key, def) => (key === 'rendor_sub_price' ? price : def),
    listUserTxns: async () => state.txns,
    insert: async (table, rec) => {
      if (table === 'wallet_transactions') state.txns.push(rec);
      if (table === 'platform_revenue') state.revenue.push(rec);
      return rec;
    },
    update: async () => ({}),
  };
}

const RENDOR = { userId: 'rendor-1', role: 'rendor' };

test('a stale fee is refused in plain language and tagged for a re-quote', async () => {
  const adapter = makeAdapter({ price: '10' });
  const res = await wallet.rendorSubscribe(adapter, RENDOR, {
    months: 1, amount: 30, method: 'momo', payment_ref: 'R-stale',
  });

  assert.equal(res.ok, false, 'the old GHS 30 must not buy a GHS 10 subscription');
  assert.equal(res.status, 400);

  // The markup the client reacts to.
  assert.equal(res.code, 'price_changed', 'the client needs a machine-readable reason');
  assert.equal(res.extra.expected, 10, 'the response must carry the current fee');
  assert.equal(res.extra.months, 1);

  // The copy a rendor reads: the new fee, in a sentence, with a next step.
  assert.match(res.error, /GHS 10\.00/, 'the message must name the new fee');
  assert.match(res.error, /pay again/i, 'the message must say what to do next');
  for (const leak of [/HTTP/, /\b400\b/, /server/i, /supabase/i, /rejected/i]) {
    assert.ok(!leak.test(res.error), `rejection copy still leaks "${leak}": ${res.error}`);
  }

  // Nothing was charged or activated on a refused payment.
  assert.equal(adapter.state.user.rendor_sub_status, null);
  assert.equal(adapter.state.txns.length, 0);
  assert.equal(adapter.state.revenue.length, 0);
});

test('the current fee activates the subscription and records the real amount', async () => {
  const adapter = makeAdapter({ price: '10' });
  const res = await wallet.rendorSubscribe(adapter, RENDOR, {
    months: 1, amount: 10, method: 'momo', payment_ref: 'R-ok',
  });

  assert.equal(res.ok, true);
  assert.equal(adapter.state.user.rendor_sub_status, 'active');
  assert.equal(adapter.state.user.rendor_sub_plan, '1month');
  assert.ok(Number(adapter.state.user.rendor_sub_expiry) > Date.now());
  assert.equal(adapter.state.revenue.length, 1);
  assert.equal(adapter.state.revenue[0].amount, 10);
});

test('a per-rendor override outranks the global fee, exactly as the admin set it', async () => {
  const adapter = makeAdapter({ price: '10', override: '25' });

  const global = await wallet.rendorSubscribe(adapter, RENDOR, {
    months: 1, amount: 10, method: 'momo', payment_ref: 'R-global',
  });
  assert.equal(global.ok, false);
  assert.equal(global.code, 'price_changed');
  assert.equal(global.extra.expected, 25, 'the custom price must win over the global fee');
  assert.match(global.error, /GHS 25\.00/);

  const custom = await wallet.rendorSubscribe(adapter, RENDOR, {
    months: 1, amount: 25, method: 'momo', payment_ref: 'R-custom',
  });
  assert.equal(custom.ok, true);
  assert.equal(adapter.state.revenue[0].amount, 25);
});

test('the quoted total is the fee for the whole cycle, not one month of it', async () => {
  const adapter = makeAdapter({ price: '10' });
  // fee × months — this is the figure the rendor's card quotes and the server
  // charges, so a 3-month cycle is GHS 30.
  const res = await wallet.rendorSubscribe(adapter, RENDOR, {
    months: 3, amount: 30, method: 'momo', payment_ref: 'R-3',
  });
  assert.equal(res.ok, true);
  assert.equal(adapter.state.revenue[0].amount, 30);

  // ...and a client that only sends one month still cannot buy three.
  const adapter2 = makeAdapter({ price: '10' });
  const short = await wallet.rendorSubscribe(adapter2, RENDOR, {
    months: 3, amount: 5, method: 'momo', payment_ref: 'R-5',
  });
  assert.equal(short.ok, false);
  assert.equal(short.code, 'price_changed');
});

test('the wallet route hands the price-change hint to the browser', () => {
  // The engine's code/extra are useless if the route drops them.
  for (const file of ['api/index.js', 'server.js']) {
    const src = read(file);
    assert.match(
      src,
      /if \(!out\.ok\) return res\.status\(out\.status\)\.json\(\{ error: out\.error, \.\.\.\(out\.code/,
      `${file} no longer forwards the wallet engine's code/extra`
    );
  }
});

test('the rendor page prices from the current settings and re-quotes on a price change', () => {
  const src = read('js/rendor.js');

  // 1. Re-read the published settings when the subscription screen renders: the
  //    session-long cache is what kept showing the generic fee.
  const renderBody = src.slice(
    src.indexOf('async function renderRendorSubscription'),
    src.indexOf('async function requestRendorSubscription')
  );
  assert.match(renderBody, /loadPublicSettings\(\)/, 'renderRendorSubscription must refresh the published settings');
  assert.match(renderBody, /unitPrice \* duration/, 'the card must quote the fee for the whole cycle');

  // 2. Re-read the fee when the payment modal opens, so the amount on the
  //    confirm button is the one that will be charged.
  const modalBody = src.slice(
    src.indexOf('async function requestRendorSubscription'),
    src.indexOf('async function confirmRendorSubscription')
  );
  assert.match(modalBody, /getRendorSubPrice\(/, 'the payment modal must re-read the fee');

  // 3. Handle a fee that moved mid-checkout: name it, refresh, re-quote once.
  const confirmBody = src.slice(src.indexOf('async function confirmRendorSubscription'));
  assert.match(confirmBody, /code === 'price_changed'/, 'confirmRendorSubscription must react to price_changed');
  assert.match(confirmBody, /renderRendorSubscription\(\)/, 'the changed fee must be reflected on the page');
  assert.match(confirmBody, /showApiErrorToast\(/, 'other failures must not print transport detail');
});
