'use strict';
// The vendor Wallet tab must acknowledge a completed order.
//
// Three numbers on that tab silently dropped sales that had actually happened:
//
//   * "Sales This Month" bucketed Mon→Sun of the CURRENT WEEK while the card
//     promised the month, and it gated on a `'confirmed'` package status that
//     nothing in this codebase ever writes (only pending / in_transit /
//     delivered / cancelled). An order placed before Monday — or completed
//     earlier in the month — therefore read as zero sales. It also bucketed by
//     created_at while gating on delivery, so an order created last month and
//     delivered this month fell outside the window entirely.
//   * "Total Earned" summed `vendor_amount` behind a bare `balance_released`
//     filter. A released order whose legacy `vendor_amount` was missing summed
//     to 0 and landed in NEITHER Total Earned nor Pending Release — the money
//     simply vanished from the screen.
//   * "Top Products" read only the denormalised `sold_count` product counter.
//
// The chart is exercised for real — extracted from js/vendor.js and run against
// fakes. The earnings helpers are inline in renderVendorDashboard's template, so
// they are asserted on the shape of the source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const vendorSrc = fs.readFileSync(path.join(ROOT, 'js/vendor.js'), 'utf-8');

/**
 * Extract renderVendorChart from js/vendor.js (brace-balanced) and run it in a
 * stubbed DOM so the real bucketing logic is what gets asserted.
 * @returns {{render: Function, lastData: Function, lastLabels: Function}}
 */
function loadRenderVendorChart() {
  const start = vendorSrc.indexOf('function renderVendorChart');
  assert.ok(start !== -1, 'renderVendorChart() is missing from js/vendor.js');

  let i = vendorSrc.indexOf('{', start);
  assert.ok(i !== -1, 'could not find the renderVendorChart body');
  let depth = 0;
  for (; i < vendorSrc.length; i++) {
    const ch = vendorSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const body = vendorSrc.slice(start, i);
  assert.ok(depth === 0, 'could not isolate the renderVendorChart body');

  const canvas = { outerHTML: '' };
  const documentStub = { getElementById: id => (id === 'vendor-sales-chart' ? canvas : null) };
  const windowStub = {};
  function ChartStub(_canvas, config) { this.config = config; }
  ChartStub.prototype.destroy = function () {};

  const render = new Function('document', 'window', 'Chart',
    `${body}\nreturn renderVendorChart;`)(documentStub, windowStub, ChartStub);

  return {
    render,
    lastData: () => (windowStub._vendorChart ? windowStub._vendorChart.config.data.datasets[0].data : null),
    lastLabels: () => (windowStub._vendorChart ? windowStub._vendorChart.config.data.labels : null)
  };
}

const now = new Date();
const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0);
const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 12, 0, 0);
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

test('vendor wallet: "Sales This Month" really spans the month', () => {
  const { render, lastData, lastLabels } = loadRenderVendorChart();

  // Two sales this month: one placed on the 1st, and one placed LAST month but
  // delivered today. Both must land in this month's chart.
  render([
    { id: 'p1', status: 'delivered', created_at: firstOfMonth.toISOString(), gross_amount: 600 },
    { id: 'p2', status: 'pending', created_at: lastMonth.toISOString(),
      delivered_date: now.toISOString(), vendor_amount: 300 },
    // Placed last month, still awaiting delivery — that is last month's sale.
    { id: 'p3', status: 'pending', created_at: lastMonth.toISOString(), vendor_amount: 999 },
    // Never counted.
    { id: 'p4', status: 'cancelled', created_at: firstOfMonth.toISOString(), gross_amount: 111 },
    { id: 'p5', vendor_status: 'rejected', created_at: firstOfMonth.toISOString(), gross_amount: 222 }
  ]);

  const labels = lastLabels();
  assert.equal(labels.length, daysInMonth,
    'the chart must have one bucket per day of the current month');
  assert.deepEqual(labels[0], '1');
  assert.deepEqual(labels[labels.length - 1], String(daysInMonth));

  const total = lastData().reduce((s, v) => s + v, 0);
  assert.equal(total, 900,
    'both this month\'s sales must be counted; cancelled, rejected and last month\'s outstanding order must not');
  assert.equal(lastData()[0], 600, 'the order placed on the 1st belongs in day 1');
  assert.equal(lastData()[now.getDate() - 1], 300,
    'the order delivered today must be plotted on today');
});

test('vendor wallet: the chart never depends on a status nothing writes', () => {
  const { render, lastData } = loadRenderVendorChart();

  // A completed main-site order that is still `pending` at the orders table
  // level (the vendor has finished it, the admin has not pressed Delivered).
  render([{ id: 'p', status: 'pending', vendor_status: 'processed',
    created_at: firstOfMonth.toISOString(), gross_amount: 600 }]);

  const total = lastData().reduce((s, v) => s + v, 0);
  assert.equal(total, 600, 'a sale placed this month must be counted regardless of its status label');
  assert.ok(!/includes\(p\.status\)/.test(vendorSrc.slice(vendorSrc.indexOf('function renderVendorChart'))),
    'the chart must not gate on a package status whitelist — \'confirmed\' is never written');
});

test('vendor wallet: a completed sale lands in Total Earned or Pending, never neither', () => {
  // Total Earned / Pending Release are inline in renderVendorDashboard's
  // template, so assert the shape of the expressions that compute them.
  const earned = vendorSrc.match(/const totalEarnedGHS[\s\S]{0,240}?pendingReleaseGHS/);
  assert.ok(earned, 'the wallet summary must be computed into named totals, not inline in the template');
  assert.match(vendorSrc, /const pkgIsComplete[\s\S]*?delivered/,
    'an order must count as complete once delivered, even if balance_released never persisted');
  assert.match(vendorSrc, /const pkgVendorAmt[\s\S]*?gross_amount \|\| p\.total/,
    'vendor_amount must fall back to gross minus commission so a legacy row is never invisible');
  assert.match(vendorSrc, /activeVendorPkgs\.filter\(pkgIsComplete\)/,
    'Total Earned must be derived from the completed-order set');
  assert.match(vendorSrc, /activeVendorPkgs\.filter\(p => !pkgIsComplete\(p\)\)/,
    'Pending Release must be the exact complement, so every active package appears exactly once');
});

test('vendor wallet: Top Products falls back to units counted from the vendor\'s own orders', () => {
  assert.match(vendorSrc, /const soldFromOrders = \{\}/,
    'units sold must be tallied from this vendor\'s packages');
  assert.match(vendorSrc, /const productSoldCount[\s\S]*?sold_count \|\| p\.total_sold/,
    'Top Products must read the product counter first');
  assert.match(vendorSrc, /const topProductRows[\s\S]*?soldFromOrders\[pid\] > 0/,
    'Top Products must consider sold products even when the product row is gone');
  assert.match(vendorSrc, /topProductRows\.slice\(\)\.sort\(\(a,b\)=>productSoldCount\(b\)-productSoldCount\(a\)\)/,
    'Top Products must sort by the derived count, not the raw counter alone');
});

/**
 * Extract the real inline earnings/Top-Products block from
 * renderVendorDashboard and run it against package fixtures, so the sold-out
 * auto-delete path is exercised for real rather than by source shape.
 */
function runWalletStats(myPackages, myProducts) {
  const s = vendorSrc.indexOf('const activeVendorPkgs');
  const e = vendorSrc.indexOf('// Fetch storefront', s);
  assert.ok(s !== -1 && e !== -1, 'could not isolate the wallet stat block');
  const block = vendorSrc.slice(s, e);
  const fn = new Function('myPackages', 'myProducts',
    `${block}\nreturn { totalEarnedGHS, pendingReleaseGHS, productSoldCount, topProductRows, soldFromOrders };`);
  return fn(myPackages, myProducts);
}

test('vendor wallet: a completed order for an auto-deleted sold-out product still shows in Top Products', () => {
  const live = { id: 'prod1', name: 'Kente Scarf', price: 50, sold_count: 0, images: [] };
  const packages = [
    // main-site order delivered by the admin
    { id: 'PK-1', status: 'delivered', vendor_status: 'processed', admin_status: 'delivered',
      balance_released: true, delivered_date: now.toISOString(), created_at: lastMonth.toISOString(),
      gross_amount: 100, vendor_amount: 92, items: [{ id: 'prod1', name: 'Kente Scarf', qty: 1, price: 50 }] },
    // storefront COD delivered today; its product has since sold out and been deleted
    { id: 'pkg-3', status: 'delivered', vendor_status: 'delivered', admin_status: 'delivered',
      balance_released: true, delivered_date: now.toISOString(), created_at: firstOfMonth.toISOString(),
      gross_amount: 80, vendor_amount: 72,
      items: [{ product_id: 'prodGone', name: 'Sold-out Item', qty: 1, price: 80, image: 'x.jpg' }] }
  ];

  // prodGone is NOT in myProducts — it was auto-deleted when it sold out.
  const st = runWalletStats(packages, [live]);

  assert.equal(st.soldFromOrders['prodGone'], 1, 'the sold-out unit must be counted from the package');
  const ghost = st.topProductRows.find(p => String(p.id) === 'prodGone');
  assert.ok(ghost, 'a product deleted after its sale must still be listed in Top Products');
  assert.equal(ghost.name, 'Sold-out Item', 'the deleted product\'s name comes from the package item');
  assert.equal(ghost.price, 80, 'its price comes from the package item');
  assert.equal(st.productSoldCount(ghost), 1);
  assert.equal(st.totalEarnedGHS, 164, 'both completed orders are acknowledged as earned');
  assert.equal(st.pendingReleaseGHS, 0);
});

test('vendor wallet: a released order carrying only settlement_status still counts as earned', () => {
  // The wallet engine writes settlement_status:'released' independently of
  // balance_released, and the admin earnings view already treats it as paid.
  const packages = [
    { id: 'PK-9', status: 'pending', admin_status: 'vendor_controlled',
      settlement_status: 'released', created_at: firstOfMonth.toISOString(),
      gross_amount: 200, commission_amount: 16, vendor_amount: 184,
      items: [{ id: 'prod1', name: 'Kente Scarf', qty: 1, price: 200 }] }
  ];
  const st = runWalletStats(packages, [{ id: 'prod1', name: 'Kente Scarf', price: 200, sold_count: 1 }]);
  assert.equal(st.totalEarnedGHS, 184, 'settlement_status:\'released\' must be treated as earned');
  assert.equal(st.pendingReleaseGHS, 0, 'it must not also sit in Pending Release');
});

test('vendor wallet: a delivered order whose balance_released write failed still counts as earned', () => {
  const packages = [
    { id: 'PK-10', status: 'delivered', admin_status: 'delivered', created_at: firstOfMonth.toISOString(),
      gross_amount: 50, commission_amount: 4,
      items: [{ id: 'prod1', name: 'Kente Scarf', qty: 1, price: 50 }] }
  ];
  const st = runWalletStats(packages, [{ id: 'prod1', name: 'Kente Scarf', price: 50, sold_count: 1 }]);
  assert.equal(st.totalEarnedGHS, 46, 'a delivered order must count even without balance_released');
  assert.equal(st.pendingReleaseGHS, 0);
});
