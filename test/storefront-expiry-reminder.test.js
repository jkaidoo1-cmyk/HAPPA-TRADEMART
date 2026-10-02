'use strict';
// Storefront subscription expiry reminders.
//
// A storefront subscription that lapses silently switches the store to an
// "Under Construction" page for every visitor, and vendors were never warned —
// they discovered it from lost sales. There is no server cron here, so the sweep
// runs client-side for the signed-in vendor and posts through /api/notify.
//
// The behaviour that actually matters is restraint: a vendor must be warned as
// the deadline approaches, and must NOT be spammed on every page load. The sweep
// is exercised for real (extracted from js/vendor.js and run against fakes)
// rather than asserted on the shape of the source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const vendorSrc = fs.readFileSync(path.join(ROOT, 'js/vendor.js'), 'utf-8');

/**
 * Extract the reminder sweep from js/vendor.js and run it against fakes.
 * @returns {{ api, sent, localStore }}
 */
function loadReminderSweep({ currentUser, stores = [], planDefaults } = {}) {
  const start = vendorSrc.indexOf('const SF_REMINDER_DAYS');
  assert.ok(start !== -1, 'the storefront expiry reminder sweep is missing from js/vendor.js');

  // Stop before the `window.… = …` export line so the extracted body needs no
  // `window` global.
  const exportMarker = 'window.checkStorefrontSubscriptionReminders =';
  const end = vendorSrc.indexOf(exportMarker, start);
  assert.ok(end > start, 'could not isolate the reminder sweep from js/vendor.js');
  const src = vendorSrc.slice(start, end);

  const sent = [];
  const localStore = new Map();
  const fakeLocalStorage = {
    getItem: k => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: k => localStore.delete(k)
  };
  const App = { currentUser, allStores: stores };
  const addNotification = async (userId, type, title, message, actionUrl) => {
    sent.push({ userId, type, title, message, actionUrl });
  };
  const apiGet = async () => ({ data: stores });
  const defaults = planDefaults || {
    starter: { name: 'Starter' }, growth: { name: 'Growth' }, pro: { name: 'Pro' }
  };

  const factory = new Function(
    'App', 'addNotification', 'localStorage', 'apiGet', '_STOREFRONT_PLANS_DEFAULTS', 'console',
    `${src}\nreturn { checkStorefrontSubscriptionReminders, _sfReminderStage, SF_REMINDER_DAYS, SF_REMINDER_FINAL_DAYS, SF_REMINDER_KEY_PREFIX };`
  );

  return {
    api: factory(App, addNotification, fakeLocalStorage, apiGet, defaults, { warn() {}, log() {} }),
    sent,
    localStore
  };
}

const DAY = 86400000;
const fromNow = ms => new Date(Date.now() + ms).toISOString();

const VENDOR = { id: 'v1', role: 'vendor' };
const mkStore = (over = {}) => Object.assign({
  id: 'st1', name: 'Kepla Hub', vendor_id: 'v1', subscription_plan: 'growth'
}, over);

test('warns a vendor a week before the storefront subscription lapses', async () => {
  const { api, sent } = loadReminderSweep({
    currentUser: VENDOR,
    stores: [mkStore({ subscription_end: fromNow(5 * DAY) })]
  });

  await api.checkStorefrontSubscriptionReminders();

  assert.equal(sent.length, 1, 'a storefront 5 days from expiry should warn once');
  assert.equal(sent[0].userId, 'v1');
  assert.equal(sent[0].type, 'subscription');
  assert.match(sent[0].title, /expires in 5 days/);
  assert.match(sent[0].message, /Growth plan/);
  assert.match(sent[0].message, /Kepla Hub/);
  // The alert must be actionable: the deep link opens the dashboard AND the
  // Storefront tab, which is where the renew control lives.
  assert.equal(sent[0].actionUrl, '#vendor-renew');

  // Non-obvious trap: app.js's startup preamble treats ANY hash containing
  // "storefront" as a standalone-storefront deep link, and would render a
  // storefront shell instead of the vendor's dashboard. The renewal link must
  // therefore never contain that substring.
  assert.ok(
    !/storefront/i.test(sent[0].actionUrl),
    'the renewal deep link must not contain "storefront" or startup routing hijacks it'
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf-8'),
    /route === 'vendor-renew'/,
    'js/app.js does not handle the vendor-renew deep link'
  );
});

test('never repeats the same reminder, and escalates instead', async () => {
  const store = mkStore({ subscription_end: fromNow(5 * DAY) });
  const { api, sent } = loadReminderSweep({ currentUser: VENDOR, stores: [store] });

  await api.checkStorefrontSubscriptionReminders();
  await api.checkStorefrontSubscriptionReminders();
  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 1, 'repeated sweeps for the same expiry must not re-notify');

  // Time passes: now inside the final-day window. Same expiry, so it escalates.
  store.subscription_end = fromNow(1 * DAY);
  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 2, 'the final-day reminder should still get through');
  assert.match(sent[1].title, /expires tomorrow/);

  // And again once it has actually lapsed.
  store.subscription_end = fromNow(-2 * DAY);
  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 3, 'the expired notice should still get through');
  assert.match(sent[2].title, /offline/);
  assert.match(sent[2].message, /Under Construction|under construction/);

  // Lapsed stays lapsed — no daily repeat.
  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 3);
});

test('stays quiet well before the expiry window', async () => {
  const { api, sent } = loadReminderSweep({
    currentUser: VENDOR,
    stores: [mkStore({ subscription_end: fromNow(30 * DAY) })]
  });

  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 0, 'a storefront a month out must not be nudged yet');
});

test('re-arms after a renewal, keyed on the expiry', async () => {
  const store = mkStore({ subscription_end: fromNow(3 * DAY) });
  const { api, sent, localStore } = loadReminderSweep({ currentUser: VENDOR, stores: [store] });

  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 1);
  assert.ok([...localStore.keys()].some(k => k.startsWith(api.SF_REMINDER_KEY_PREFIX)));

  // The vendor renews: a later expiry, so the ladder starts over rather than
  // being suppressed forever by the previous cycle's marker.
  store.subscription_end = fromNow(4 * DAY);
  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 2, 'a renewed subscription must be able to warn again');
});

test('only sweeps the signed-in vendor, and only paid subscriptions', async () => {
  const otherVendor = mkStore({ id: 'st2', vendor_id: 'v9', subscription_end: fromNow(2 * DAY) });
  const neverPaid = mkStore({ id: 'st3', subscription_end: null, subscription_status: 'none' });
  const mine = mkStore({ id: 'st4', subscription_end: fromNow(2 * DAY) });

  const { api, sent } = loadReminderSweep({
    currentUser: VENDOR,
    stores: [otherVendor, neverPaid, mine]
  });

  await api.checkStorefrontSubscriptionReminders();
  assert.equal(sent.length, 1, 'only this vendor\'s paid storefront should be warned');
  assert.match(sent[0].message, /Kepla Hub/);
});

test('does nothing for non-vendors, signed-out users, or unparseable expiry dates', async () => {
  const buyer = loadReminderSweep({
    currentUser: { id: 'b1', role: 'buyer' },
    stores: [mkStore({ subscription_end: fromNow(2 * DAY) })]
  });
  await buyer.api.checkStorefrontSubscriptionReminders();
  assert.equal(buyer.sent.length, 0, 'buyers have no storefront subscription');

  const anon = loadReminderSweep({
    currentUser: null,
    stores: [mkStore({ subscription_end: fromNow(2 * DAY) })]
  });
  await anon.api.checkStorefrontSubscriptionReminders();
  assert.equal(anon.sent.length, 0, 'a signed-out visitor must not trigger a sweep');

  const badDate = loadReminderSweep({
    currentUser: VENDOR,
    stores: [mkStore({ subscription_end: 'not-a-date' })]
  });
  await badDate.api.checkStorefrontSubscriptionReminders();
  assert.equal(badDate.sent.length, 0, 'an unparseable expiry date must not be treated as imminent');
});

test('the staged thresholds escalate in one direction only', () => {
  const { api } = loadReminderSweep({ currentUser: VENDOR });
  assert.equal(api._sfReminderStage(30, false), 0);
  assert.equal(api._sfReminderStage(api.SF_REMINDER_DAYS, false), 1);
  assert.equal(api._sfReminderStage(api.SF_REMINDER_FINAL_DAYS, false), 2);
  assert.equal(api._sfReminderStage(0, false), 2);
  assert.equal(api._sfReminderStage(0, true), 3);
});
