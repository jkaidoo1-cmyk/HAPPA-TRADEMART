'use strict';
// Referral coupons (REF-<userId>) and admin coupons.
//
// Regressions guarded here:
//
//   * The REF- code was parsed with `code.split('-')[1] === userId`, which can
//     never match a real id: every generated id contains dashes (use-123-456,
//     uuids) and the input was uppercased while ids are lowercase. The owner of
//     the balance was rejected with "This referral coupon cannot be used by
//     you" — on BOTH the client and the server — so personal referral coupons
//     never worked at all. The id is everything after the 'REF-' prefix and the
//     comparison is case-insensitive.
//   * Admin coupons must be revalidated server-side (active/expiry/max_uses)
//     with the amount recomputed from type/value — the client's "applied" tick
//     is only a preview.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const commerce = require(path.join(ROOT, 'lib/commerce.js'));
const checkoutSrc = fs.readFileSync(path.join(ROOT, 'js/checkout.js'), 'utf-8');

/** Extract a top-level function from source (brace-balanced). */
function extract(src, sig) {
  const start = src.indexOf(sig);
  assert.ok(start !== -1, `${sig} is missing`);
  let i = src.indexOf('{', start);
  assert.ok(i !== -1, `could not find the body of ${sig}`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  assert.equal(depth, 0, `could not isolate the body of ${sig}`);
  return src.slice(start, i);
}

function loadReferralCouponMatch() {
  const body = extract(checkoutSrc, 'function referralCouponMatch');
  const make = new Function(`${body}\nreturn referralCouponMatch;`);
  return make();
}

// ── REF- personal coupon, server side (lib/commerce.js) ────────────────────

test('REF- coupon: owner with a dash-id and lowercase id matches', () => {
  const ctx = { viewerId: 'buyer-test-1', txns: [{ type: 'referral_reward', amount: 2.82, status: 'completed' }], user: { referral_commission_used: 0 } };
  const cd = commerce.computeDiscount('REF-buyer-test-1', 50, ctx);
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 2.82); // capped balance available
});

test('REF- coupon: uppercased input matches a lowercase id (case-insensitive)', () => {
  const ctx = { viewerId: 'use-1791099507174-159', txns: [{ type: 'referral_reward', amount: 5, status: 'completed' }], user: {} };
  const cd = commerce.computeDiscount('REF-USE-1791099507174-159', 50, ctx);
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 5);
});

test('REF- coupon: balance is capped at the subtotal', () => {
  const ctx = { viewerId: 'u1', txns: [{ type: 'referral_reward', amount: 40, status: 'completed' }], user: {} };
  const cd = commerce.computeDiscount('REF-U1', 25, ctx);
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 25);
});

test('REF- coupon: already-spent balance is subtracted', () => {
  const ctx = { viewerId: 'u1', txns: [{ type: 'referral_reward', amount: 10, status: 'completed' }], user: { referral_commission_used: 6 } };
  const cd = commerce.computeDiscount('REF-U1', 50, ctx);
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 4);
});

test('REF- coupon: someone else\'s code is rejected', () => {
  const ctx = { viewerId: 'buyer-test-1', txns: [], user: {} };
  const cd = commerce.computeDiscount('REF-otheruser', 50, ctx);
  assert.match(cd.error || '', /cannot be used by you/);
});

test('REF- coupon: guest cannot spend a REF- code', () => {
  const cd = commerce.computeDiscount('REF-anybody', 50, { txns: [], user: {} });
  assert.match(cd.error || '', /cannot be used by you/);
});

test('REF- coupon: zero balance is rejected with the balance message', () => {
  const ctx = { viewerId: 'u1', txns: [], user: { referral_commission_used: 0 } };
  const cd = commerce.computeDiscount('REF-U1', 50, ctx);
  assert.match(cd.error || '', /No referral balance/);
});

test('REF- coupon: failed reward rows do not count toward the balance', () => {
  const ctx = { viewerId: 'u1', txns: [{ type: 'referral_reward', amount: 9, status: 'failed' }], user: {} };
  const cd = commerce.computeDiscount('REF-U1', 50, ctx);
  assert.match(cd.error || '', /No referral balance/);
});

test('REF- coupon: a bare "REF-" never matches', () => {
  const ctx = { viewerId: 'u1', txns: [{ type: 'referral_reward', amount: 9, status: 'completed' }], user: {} };
  const cd = commerce.computeDiscount('REF-', 50, ctx);
  assert.match(cd.error || '', /cannot be used by you/);
});

// ── Admin coupons, server side ─────────────────────────────────────────────

const adminCtx = (coupon, over = {}) => ({
  viewerId: 'buyer-test-1',
  coupons: [coupon],
  ...over
});

test('admin coupon: percentage discount is recomputed from subtotal', () => {
  const cd = commerce.computeDiscount('SAVE10', 200, adminCtx({ code: 'save10', type: '%', value: 10, max_uses: 0, used_count: 0 }));
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 20);
  assert.equal(cd.countUse, true);
});

test('admin coupon: legacy pct type behaves as a percentage', () => {
  const cd = commerce.computeDiscount('HALF', 100, adminCtx({ code: 'HALF', type: 'pct', value: 50, used_count: 0 }));
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 50);
});

test('admin coupon: GHS type is a flat amount capped at the subtotal', () => {
  const cd = commerce.computeDiscount('FLAT', 30, adminCtx({ code: 'FLAT', type: 'GHS', value: 50, used_count: 0 }));
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 30);
});

test('admin coupon: max_uses is enforced', () => {
  const cd = commerce.computeDiscount('LIMITED', 100, adminCtx({ code: 'LIMITED', type: '%', value: 10, max_uses: 2, used_count: 2 }));
  assert.match(cd.error || '', /maximum number of times/);
});

test('admin coupon: expired coupons are rejected', () => {
  const cd = commerce.computeDiscount('OLD', 100, adminCtx({ code: 'OLD', type: '%', value: 10, expires_at: '2020-01-01T00:00:00Z' }));
  assert.match(cd.error || '', /expired/);
});

test('admin coupon: a second redemption by the same account is rejected', () => {
  const cd = commerce.computeDiscount('ONCE', 100, adminCtx({ code: 'ONCE', type: '%', value: 10, max_uses: 10, used_count: 1, used_by: ['buyer-test-1'] }));
  assert.match(cd.error || '', /already been used by you/);
});

test('admin coupon: another account may still redeem it', () => {
  const cd = commerce.computeDiscount('ONCE', 100, adminCtx({ code: 'ONCE', type: '%', value: 10, max_uses: 10, used_count: 1, used_by: ['someone-else'] }));
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 10);
});

test('admin coupon: guests are only bounded by max_uses (no id to track)', () => {
  const cd = commerce.computeDiscount('OPEN', 100, { coupons: [{ code: 'OPEN', type: '%', value: 10, max_uses: 5, used_count: 1, used_by: ['anybody'] }] });
  assert.ok(!cd.error, cd.error);
  assert.equal(cd.discount, 10);
});

test('admin coupon: deactivated coupons are rejected', () => {
  const cd = commerce.computeDiscount('OFF', 100, adminCtx({ code: 'OFF', type: '%', value: 10, active: false }));
  assert.match(cd.error || '', /no longer active/);
});

test('admin coupon: unknown codes are rejected', () => {
  const cd = commerce.computeDiscount('NOPE', 100, adminCtx({ code: 'OTHER', type: '%', value: 10 }));
  assert.match(cd.error || '', /not valid/);
});

test('admin coupon: without a coupons table the order is rejected, not undercharged', () => {
  const cd = commerce.computeDiscount('ANY', 100, { viewerId: 'u1' });
  assert.match(cd.error || '', /not valid/);
});

// ── REF- matcher, client side (js/checkout.js) ─────────────────────────────

test('client: uppercased input matches a dash-id — the exact production bug', () => {
  const match = loadReferralCouponMatch();
  // The checkout input uppercases what the user typed; the buyer tab shows
  // REF-buyer-test-1. split('-')[1] would yield 'BUYER' ≠ 'buyer-test-1'.
  const r = match('REF-BUYER-TEST-1', 'buyer-test-1');
  assert.equal(r.isReferral, true);
  assert.equal(r.match, true);
});

test('client: generated ids (use-…-…) match case-insensitively', () => {
  const match = loadReferralCouponMatch();
  assert.equal(match('ref-USE-1791099507174-159', 'use-1791099507174-159').match, true);
  assert.equal(match('REF-8F3A9C00-1111-2222-3333-444455556666', '8f3a9c00-1111-2222-3333-444455556666').match, true);
});

test('client: another user\'s REF- code is flagged as referral but not a match', () => {
  const match = loadReferralCouponMatch();
  const r = match('REF-OTHERUSER', 'buyer-test-1');
  assert.equal(r.isReferral, true);
  assert.equal(r.match, false);
});

test('client: a guest (no user id) never matches', () => {
  const match = loadReferralCouponMatch();
  const r = match('REF-BUYER-TEST-1', undefined);
  assert.equal(r.isReferral, true);
  assert.equal(r.match, false);
});

test('client: regular admin coupons are not treated as referral codes', () => {
  const match = loadReferralCouponMatch();
  assert.equal(match('SAVE10', 'buyer-test-1').isReferral, false);
  assert.equal(match('ref', 'buyer-test-1').isReferral, false);
});

test('client: a bare REF- never matches', () => {
  const match = loadReferralCouponMatch();
  const r = match('REF-', 'buyer-test-1');
  assert.equal(r.isReferral, true);
  assert.equal(r.match, false);
});

// ── Product-share purchase credit (lib/wallet.js releaseDelivery) ─────────
//
// A product share only ever credited a SIGNUP. An already-registered friend
// who bought through the share left `product_share_referrer` on the order, but
// releaseDelivery never read it, so the sharer earned nothing on the sale. It
// now pays the sharer on delivery when the buyer carries no active referral.

const wallet = require(path.join(ROOT, 'lib/wallet.js'));

function makeReleaseAdapter(opts = {}) {
  const balances = Object.assign(
    { 'vendor-1': 0, 'sharer-1': 0, 'referrer-A': 0, 'buyer-reg': 0 }, opts.balances || {}
  );
  const txns = [];
  const state = { balances, txns, updates: [] };
  const pkg = Object.assign({
    id: 'PKG-SHARE-1',
    package_code: 'AC-10001',
    order_id: 'ord-share-1',
    vendor_id: 'vendor-1',
    buyer_id: 'buyer-reg',
    buyer_name: 'Reg Buyer',
    vendor_amount: 100,
    commission_amount: 8,
    platform_fee: 1.5,
    order_source: 'main',
    settlement_status: 'pending'
  }, opts.pkg || {});
  const adapter = {
    async loadPackage() { return { ...pkg }; },
    async loadOrder() {
      if (opts.order === null) return null;
      return Object.assign({ id: 'ord-share-1', product_share_referrer: 'SHARER01' }, opts.order || {});
    },
    async findUserByReferralCode(code) {
      if (opts.resolve) return opts.resolve(code);
      return String(code).toUpperCase() === 'SHARER01' ? { id: 'sharer-1', referral_code: 'SHARER01' } : null;
    },
    async listUserTxns() { return []; },
    async loadAdmin() { return { id: 'admin' }; },
    async getSetting(k, def) {
      if (k === 'referral_commission_tiers') return opts.tiers || '[]';
      if (k === 'referral_reward_pct') return opts.flatPct != null ? String(opts.flatPct) : '5';
      return def;
    },
    async listActiveReferrals() { return opts.referrals || []; },
    async loadUser(id) { return { id, wallet_balance: balances[id] != null ? balances[id] : 0 }; },
    async saveUser(id, patch) { if (patch.wallet_balance != null) balances[id] = patch.wallet_balance; return true; },
    async insert(table, rec) { if (table === 'wallet_transactions') txns.push(rec); return rec; },
    async update(table, id, patch) { state.updates.push({ table, id, patch }); return null; }
  };
  return { adapter, state };
}

function rewardsTo(state, userId) {
  return state.txns.filter(t => t.type === 'referral_reward' && String(t.user_id) === String(userId));
}

test('product share: an already-registered friend credits the sharer on delivery', async () => {
  const { adapter, state } = makeReleaseAdapter();
  const res = await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rewards = rewardsTo(state, 'sharer-1');
  assert.equal(rewards.length, 1, 'the sharer earns exactly one reward');
  assert.equal(rewards[0].amount, 5, '5% of the GHS 100 vendor earnings');
  assert.equal(String(rewards[0].package_id), 'PKG-SHARE-1');
  assert.equal(state.balances['sharer-1'], 5);
  assert.equal(state.balances['vendor-1'], 100, 'the vendor is still paid');
});

test('product share: a buyer with an active referral pays the referrer, not the sharer', async () => {
  const { adapter, state } = makeReleaseAdapter({
    referrals: [{ id: 'ref-1', referrer_id: 'referrer-A', status: 'active' }]
  });
  const res = await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(rewardsTo(state, 'referrer-A').length, 1, 'the active referrer is paid');
  assert.equal(rewardsTo(state, 'sharer-1').length, 0, 'the product sharer is not double-paid');
});

test('product share: a self-share never pays the buyer', async () => {
  const { adapter, state } = makeReleaseAdapter({
    order: { product_share_referrer: 'buyer-reg' },
    resolve: (code) => (String(code) === 'buyer-reg' ? { id: 'buyer-reg' } : null)
  });
  const res = await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(rewardsTo(state, 'buyer-reg').length, 0);
});

test('product share: an unknown share code is ignored, the sale still releases', async () => {
  const { adapter, state } = makeReleaseAdapter({ resolve: () => null });
  const res = await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(state.txns.filter(t => t.type === 'referral_reward').length, 0);
  assert.equal(state.balances['vendor-1'], 100, 'the vendor is still paid');
});

test('product share: the admin-configured reward rate applies', async () => {
  const { adapter, state } = makeReleaseAdapter({ flatPct: 12 });
  await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(state.balances['sharer-1'], 12, '12% of GHS 100');
});

test('product share: the package field is a fallback when the order cannot be loaded', async () => {
  const { adapter, state } = makeReleaseAdapter({
    order: null,
    pkg: { product_share_referrer: 'SHARER01' }
  });
  const res = await wallet.releaseDelivery(adapter, { userId: 'vendor-1', role: 'vendor' }, { package_id: 'PKG-SHARE-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(state.balances['sharer-1'], 5);
});
