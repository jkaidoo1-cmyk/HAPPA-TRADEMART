'use strict';
// The AdEngine's daily allowance, pinned here — an advertiser buys minutes per
// store per day (store_budgets, in minutes), each slide that finishes
// displaying is charged slideMs / 60000 minutes to its store, and a store that
// is out of budget drops out of the rotation.
//
// Two ways that failed before:
//
//   1. When EVERY participating store was out of budget the engine rebuilt a
//      state with a zeroed `spent` ("so fallback or campaign continues to
//      display"). The campaign therefore never stopped: it kept rotating for
//      the rest of the day, and each rebuild wrote the fresh counters back to
//      localStorage, wiping the day's record — which also reset the
//      "Used: X mins today" bar on the admin Ads tab. Rebuilding the state on
//      the next page view must leave the campaign off for the day.
//
//   2. Ticks were charged unconditionally. Every page of the SPA other than the
//      active one is display:none and a background tab keeps firing its timers,
//      so a banner nobody could see drained the allowance (and counted
//      impressions for slides that were never looked at).
//
// The engine is run as shipped, against a fake DOM + fake clock, so these
// assertions exercise the real tick/charge path rather than matching strings.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'ads.js'), 'utf-8');
assert.ok(SOURCE.includes('AdEngine'), 'js/ads.js is missing or empty');

const DAY_MS = 86400000;
const NOW0 = new Date('2026-10-07T10:00:00').getTime();
const STATS_FLUSH_MS = 20000; // the analytics flush interval inside ads.js

// `_todayStr()` uses the browser's local calendar date; mirror it exactly.
function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function campaign(overrides = {}) {
  return {
    id: 'camp1',
    name: 'Test Campaign',
    status: 'active',
    store_ids: ['s1'],
    store_budgets: { s1: 3 },
    interval_value: 120,          // 2-minute slides
    interval_unit: 'seconds',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    pages: ['home'],
    show_store_name: true,
    ...overrides,
  };
}

function product(id, name, storeId) {
  return { id, name, store_id: storeId, price: 10, original_price: 20, status: 'active', images: [] };
}

function storeRow(id, name) { return { id, name }; }

function makeElement(id) {
  return {
    id,
    style: {},
    innerHTML: '',
    offsetParent: { id: `${id}-page` },        // rendered by default
    getClientRects: () => [{}],
    querySelector: () => null,
    classList: { add() {}, remove() {}, contains: () => false },
  };
}

// A controllable clock shared with the sandbox: the engine reads the wall clock
// for its daily key and for campaign start/end.
function makeClock(startMs) {
  let now = startMs;
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() { return now; }
  }
  return { Date: FakeDate, advance: ms => { now += ms; } };
}

function boot({ campaign: camp, products, stores, now = NOW0, spent = null, hidden = false }) {
  const clock = makeClock(now);
  const elements = {
    'ad-banner-home': makeElement('ad-banner-home'),
    'hero-default': makeElement('hero-default'),
  };
  const storage = {};
  const campaignId = camp ? camp.id : 'camp1';
  if (spent) storage[`happa_ads_${campaignId}_${localDayKey(now)}`] = JSON.stringify(spent);

  const beacons = [];
  const timers = new Map();
  let nextTimerId = 0;

  const sandbox = {
    console: { info() {}, log() {}, warn() {}, error() {} },
    Blob,
    Date: clock.Date,
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: k => { delete storage[k]; },
    },
    navigator: {
      sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; },
    },
    document: {
      hidden: !!hidden,
      getElementById: id => elements[id] || null,
      createElement: tag => makeElement(tag),
      addEventListener() {},
    },
    addEventListener() {},          // window listeners (pagehide)
    setInterval: (fn, ms) => { const id = ++nextTimerId; timers.set(id, { fn, ms }); return id; },
    clearInterval: id => { timers.delete(id); },
    setTimeout: () => 0,
    requestAnimationFrame: fn => { fn(); return 0; },
    apiGet: async table => {
      if (table === 'ad_campaigns') return camp ? [camp] : [];
      if (table === 'settings') return { data: [] };
      return [];
    },
    escHtml: s => String(s == null ? '' : s),
    itemDisplayName: n => String(n == null ? '' : n),
    isProductListable: p => !p || p.status !== 'archived',
    openProduct: () => {},
    App: { allProducts: products, allStores: stores },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'js/ads.js' });

  return {
    sandbox,
    elements,
    storage,
    beacons,
    clock,
    slot: elements['ad-banner-home'],
    hero: elements['hero-default'],
    // Fire the ad-rotation intervals (never the analytics flush).
    runTimers() {
      for (const { fn, ms } of Array.from(timers.values())) if (ms !== STATS_FLUSH_MS) fn();
    },
    flush() {
      for (const { fn, ms } of Array.from(timers.values())) if (ms === STATS_FLUSH_MS) fn();
    },
    rotationTimers: () => Array.from(timers.values()).filter(t => t.ms !== STATS_FLUSH_MS).length,
    spent: (dayMs = now) => {
      const raw = storage[`happa_ads_${campaignId}_${localDayKey(dayMs)}`];
      return raw ? JSON.parse(raw) : null;
    },
  };
}

test("a campaign whose stores have all used up today's allowance does not come back", async () => {
  const b = boot({
    campaign: campaign(),                    // s1: 3 minutes/day
    products: [product('p1', 'Kofi Rice', 's1'), product('p2', 'Kofi Beans', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
    spent: { s1: 5 },                        // already 5 of 3 minutes
  });

  await b.sandbox.initAdBanners('home');

  assert.equal(b.slot.style.display, 'none', 'the slot must stay hidden');
  assert.equal(b.slot.innerHTML, '', 'no slide may be rendered');
  assert.equal(b.hero.style.display, '', 'the default hero must come back');
  assert.deepEqual(b.spent(), { s1: 5 }, "the day's record must not be reset to zero");
  assert.equal(b.rotationTimers(), 0, 'nothing left to rotate, so no timer should run');

  b.flush();
  assert.equal(b.beacons.length, 0, 'no impression may be reported for a banner that never showed');
});

test('a store out of budget is skipped while the others keep rotating', async () => {
  const b = boot({
    campaign: campaign({ store_ids: ['s1', 's2'], store_budgets: { s1: 3, s2: 60 } }),
    products: [
      product('p1', 'Kofi Rice', 's1'),
      product('p2', 'Ama Shoes', 's2'),
      product('p3', 'Ama Bags', 's2'),
    ],
    stores: [storeRow('s1', 'Kofi Store'), storeRow('s2', 'Ama Store')],
    spent: { s1: 9 },                        // s1 is done for the day, s2 is not
  });

  await b.sandbox.initAdBanners('home');

  assert.equal(b.slot.style.display, '', 'the campaign still runs for s2');
  assert.match(b.slot.innerHTML, /Ama /, 'the slide must come from the store with budget');
  assert.doesNotMatch(b.slot.innerHTML, /Kofi /, 'the spent store must not be shown');
  assert.deepEqual(b.spent(), { s1: 9 }, "the spent store's record must be left alone");
});

test('the banner stops mid-session when the last store uses up its allowance', async () => {
  const b = boot({
    campaign: campaign(),                    // s1: 3 minutes/day, 2-minute slides
    products: [product('p1', 'Kofi Rice', 's1'), product('p2', 'Kofi Beans', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
  });

  await b.sandbox.initAdBanners('home');
  assert.equal(b.slot.style.display, '', 'the first slide renders');
  assert.ok(b.slot.innerHTML.includes('Kofi '), 'the first slide is a product from the store');

  b.runTimers();                            // first slide finishes → 2 of 3 minutes
  assert.equal(b.slot.style.display, '', 'one slide of budget left, still running');
  assert.deepEqual(b.spent(), { s1: 2 });

  b.runTimers();                            // second slide → 4 of 3 minutes, allowance gone
  assert.equal(b.slot.style.display, 'none', 'the banner must stop for the rest of the day');
  assert.equal(b.slot.innerHTML, '', 'the last slide is removed');
  assert.equal(b.hero.style.display, '', 'the default hero takes the home hero slot back');
  assert.deepEqual(b.spent(), { s1: 4 }, 'the time actually shown is recorded');
  assert.equal(b.rotationTimers(), 0, 'the rotation timer is cleared, it must not keep ticking');

  // Coming back to the page must not resurrect the campaign.
  await b.sandbox.initAdBanners('home');
  assert.equal(b.slot.style.display, 'none', 'a revisit later in the day stays empty');
  assert.equal(b.rotationTimers(), 0);
});

test('a backgrounded tab neither renders nor spends the allowance', async () => {
  const b = boot({
    campaign: campaign(),
    products: [product('p1', 'Kofi Rice', 's1'), product('p2', 'Kofi Beans', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
  });

  await b.sandbox.initAdBanners('home');
  const firstSlide = b.slot.innerHTML;

  b.sandbox.document.hidden = true;
  b.runTimers();
  b.runTimers();
  b.runTimers();

  assert.equal(b.slot.innerHTML, firstSlide, 'no slide is rendered into a hidden tab');
  assert.equal(b.spent(), null, 'nothing may be charged while the tab is backgrounded');

  b.sandbox.document.hidden = false;
  b.runTimers();                            // first visible tick: the off-screen stretch is not billed
  assert.notEqual(b.slot.innerHTML, firstSlide, 'rotation resumes when the tab comes back');
  assert.equal(b.spent(), null, 'the unseen stretch must not be charged');

  b.runTimers();                            // a slide the user really saw
  assert.deepEqual(b.spent(), { s1: 2 }, 'only the on-screen slide is charged');
});

test('a banner on a page the SPA has navigated away from is not charged', async () => {
  const b = boot({
    campaign: campaign(),
    products: [product('p1', 'Kofi Rice', 's1'), product('p2', 'Kofi Beans', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
  });

  await b.sandbox.initAdBanners('home');
  assert.equal(b.slot.style.display, '');

  // showPage() sets every non-active .page to display:none, so the slot — and
  // everything above it — has no offsetParent and no box.
  b.slot.offsetParent = null;
  b.slot.getClientRects = () => [];
  b.runTimers();
  b.runTimers();

  assert.equal(b.spent(), null, 'an off-screen page must not spend the campaign budget');

  b.slot.offsetParent = { id: 'page-home' };
  b.slot.getClientRects = () => [{}];
  b.runTimers();                            // back on the page
  b.runTimers();
  assert.deepEqual(b.spent(), { s1: 2 }, 'charging resumes once the page is visible again');
});

test("the allowance resets on the next calendar day", async () => {
  const b = boot({
    campaign: campaign(),
    products: [product('p1', 'Kofi Rice', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
    spent: { s1: 5 },
  });

  await b.sandbox.initAdBanners('home');
  assert.equal(b.slot.style.display, 'none', 'spent for the day');

  b.clock.advance(DAY_MS);
  await b.sandbox.initAdBanners('home');

  assert.equal(b.slot.style.display, '', 'a new day brings the campaign back');
  assert.match(b.slot.innerHTML, /Kofi Rice/);
  assert.deepEqual(b.spent(NOW0), { s1: 5 }, "yesterday's record is left untouched");
  assert.equal(b.spent(NOW0 + DAY_MS), null, 'the new day starts from zero');
});

test('every rendered slide is one impression, carrying its dwell seconds', async () => {
  const b = boot({
    campaign: campaign({ interval_value: 1, store_budgets: { s1: 30 } }),
    products: [product('p1', 'Kofi Rice', 's1'), product('p2', 'Kofi Beans', 's1')],
    stores: [storeRow('s1', 'Kofi Store')],
  });

  await b.sandbox.initAdBanners('home');    // slide 1
  b.runTimers();                            // slide 2
  b.runTimers();                            // slide 3

  b.flush();
  assert.equal(b.beacons.length, 1, 'deltas are sent in one request');
  assert.equal(b.beacons[0].url, '/api/ads/track');
  const body = JSON.parse(await b.beacons[0].blob.text());
  assert.deepEqual(body, { campaign_id: 'camp1', impressions: 3, clicks: 0, seconds: 6 });
});
