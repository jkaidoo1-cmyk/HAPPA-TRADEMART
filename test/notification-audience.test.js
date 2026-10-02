'use strict';
// Order notifications must address the *other* party — contract guards.
//
// A vendor once saw "Your order PK-97453 has been received by the vendor and is
// being prepared" in their own feed. The notifications table is correctly scoped
// per user; the row really was addressed to them, because on that package
// buyer_id === vendor_id (the vendor's own test order), so the buyer-side copy
// went to the vendor too. Nothing on the stored row can distinguish the two
// roles afterwards, so the decision has to be made at the call site:
//
//   1. Every buyer-facing order notification goes through notifyOrderParty().
//   2. When one account holds both sides of the order, the buyer copy is
//      replaced by a vendor-side confirmation of the action the actor took.
//
// A regression here is silent: the message still looks plausible, it is just
// addressed to the wrong side of the trade.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const ordersSrc = read('js/orders.js');

// Pull the helper's source out of the browser script and run it against a fake
// addNotification, so the routing decision is asserted on behaviour and not
// only on the shape of the source.
function loadNotifyOrderParty() {
  const start = ordersSrc.indexOf('function notifyOrderParty');
  assert.ok(start !== -1, 'notifyOrderParty() is missing from js/orders.js');
  const end = ordersSrc.indexOf('\n}\n', start);
  assert.ok(end !== -1, 'could not isolate the notifyOrderParty() body');
  const fnSrc = ordersSrc.slice(start, end + 2);

  const calls = [];
  const factory = new Function('addNotification', `${fnSrc}\nreturn notifyOrderParty;`);
  return { notifyOrderParty: factory((...args) => calls.push(args)), calls };
}

test('a self order sends the vendor their own confirmation, not buyer copy', () => {
  const { notifyOrderParty, calls } = loadNotifyOrderParty();
  const ref = { table: 'packages', id: 'pkg-1' };
  const pkg = { id: 'pkg-1', buyer_id: 'u1', vendor_id: 'u1' };

  const sent = notifyOrderParty(pkg, ref,
    { title: '📦 Order Packed', message: 'Your order PK-1 is packed and ready for pickup.' },
    { title: '📦 Order Packed', message: 'You marked order PK-1 as packed and ready for pickup.' });

  assert.equal(sent, true);
  assert.equal(calls.length, 1, 'exactly one notification should be raised');
  assert.equal(calls[0][0], 'u1');
  assert.match(calls[0][3], /^You marked/, 'the vendor must get the action confirmation');
  assert.doesNotMatch(calls[0][3], /Your order/, 'buyer copy must never reach the vendor');
  assert.deepEqual(calls[0][5], ref);
});

test('a normal order still sends the buyer the buyer copy', () => {
  const { notifyOrderParty, calls } = loadNotifyOrderParty();
  const pkg = { id: 'pkg-2', buyer_id: 'buyer2', vendor_id: 'vendor2' };

  notifyOrderParty(pkg, { table: 'packages', id: 'pkg-2' },
    { title: '📬 Order Delivered!', message: 'Package PK-2 has been delivered.' },
    { title: '📬 Order Delivered', message: 'You delivered order PK-2.' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'buyer2', 'the buyer is the recipient on a normal order');
  assert.equal(calls[0][3], 'Package PK-2 has been delivered.');
});

test('a self order falls back to the buyer copy when no vendor copy is given', () => {
  const { notifyOrderParty, calls } = loadNotifyOrderParty();
  const pkg = { id: 'pkg-3', buyer_id: 'u1', vendor_id: 'u1' };

  notifyOrderParty(pkg, null, { title: 'ℹ️ Something', message: 'body' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'ℹ️ Something');
});

test('a guest order has nobody to notify', () => {
  const { notifyOrderParty, calls } = loadNotifyOrderParty();
  const copy = { title: '📦 Order Packed', message: 'Your order PK-1 is packed.' };

  // Storefront orders (and main-site guest checkouts) leave buyer_id 'guest';
  // writing the row would create an unreadable notification for a non-account.
  assert.equal(notifyOrderParty({ buyer_id: 'guest', vendor_id: 'v1' }, null, copy), false);
  assert.equal(notifyOrderParty({ buyer_id: 'guest_1759', vendor_id: 'v1' }, null, copy), false);
  assert.equal(calls.length, 0, 'no notification may be raised for a guest recipient');
});

test('no recipient means no notification', () => {
  const { notifyOrderParty, calls } = loadNotifyOrderParty();
  assert.equal(notifyOrderParty(null, null, { title: 'x', message: 'y' }), false);
  assert.equal(notifyOrderParty({ vendor_id: 'v1' }, null, { title: 'x', message: 'y' }), false);
  assert.equal(calls.length, 0);
});

test('every buyer-facing order notification routes through notifyOrderParty()', () => {
  // The old shape addressed the buyer directly, which is what leaked buyer copy
  // into a vendor's feed on a self order.
  assert.ok(
    !/addNotification\(\s*pkg\.buyer_id/.test(ordersSrc),
    'js/orders.js addresses pkg.buyer_id directly again — use notifyOrderParty()'
  );

  // vendor status change, vendor rejection/refund, delivery finalization.
  const sites = ordersSrc.match(/notifyOrderParty\(pkg,/g) || [];
  assert.ok(
    sites.length >= 3,
    `expected the vendor status, refund and delivery notifications to route ` +
    `through notifyOrderParty(), found ${sites.length} call sites`
  );

  // The vendor-side copies must exist for the status transitions a vendor can
  // make on their own order, otherwise a self order loses the notice entirely.
  assert.match(ordersSrc, /You confirmed order \$\{pCode\}/);
  assert.match(ordersSrc, /You marked order \$\{pCode\} as packed/);
  assert.match(ordersSrc, /You delivered order \$\{pkg\.package_code\}/);
});
