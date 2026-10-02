'use strict';
// Admin Settings must persist AND reach the screens that depend on them.
//
// Every failure this file guards against looks the same to the admin: they
// change a value in Settings, hit Save, get "Settings saved successfully!" — and
// the site keeps showing the old number. Three separate causes:
//
//   1. A setting read by a NON-admin client silently returns nothing unless its
//      key is on the server's public allowlist (PUBLIC_SETTINGS_KEYS), so the
//      caller drops to its hardcoded default. This is how an admin-set rendor
//      subscription fee kept displaying as the generic GHS 30.
//   2. A setting that is stored but that nothing authoritative reads. The
//      commission tiers were the worst case: the client displayed them only on
//      the admin's own screen, and the server charged commission from its own
//      hardcoded table — editing the tiers changed no money at all.
//   3. A setting the admin can turn off that the code demands unconditionally.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const access = require('../lib/access');
const commerce = require('../lib/commerce');
const wallet = require('../lib/wallet');

// ── 1. Every key a client reads must be readable by that client ──────────
test('every settings key read by client code is readable by a non-admin', () => {
  const clientFiles = [
    'js/app.js', 'js/auth.js', 'js/cart.js', 'js/checkout.js', 'js/marketplace.js',
    'js/orders.js', 'js/vendor.js', 'js/rendor.js', 'js/support.js', 'js/wallet.js',
    'js/admin-settings.js'
  ];
  const readPatterns = [
    /getSetting\(\s*'([a-z0-9_]+)'/g,
    /sVal\(\s*'([a-z0-9_]+)'/g,
    /cachedSetting\(\s*'([a-z0-9_]+)'/g,
    /_tiersFromSetting\(\s*'([a-z0-9_]+)'/g
  ];

  const checked = new Set();
  for (const file of clientFiles) {
    const src = read(file);
    for (const re of readPatterns) {
      for (const m of src.matchAll(re)) checked.add(m[1]);
    }
  }

  assert.ok(checked.size >= 12, `expected to find the settings readers, found ${checked.size}`);

  const missing = [...checked].filter(k => !access.PUBLIC_SETTINGS_KEYS.has(k));
  assert.deepEqual(
    missing, [],
    `these keys are read by client code but are not on PUBLIC_SETTINGS_KEYS, so ` +
    `non-admin readers silently get their hardcoded default instead of the ` +
    `admin's value: ${missing.join(', ')}`
  );
});

test('the public allowlist never exposes secrets', () => {
  for (const key of access.PUBLIC_SETTINGS_KEYS) {
    assert.doesNotMatch(
      key, /private|secret|password|token|vapid/i,
      `${key} looks like a secret and must not be readable by clients`
    );
  }
});

test('the server hands a rendor the admin fee, and never a secret', () => {
  const rows = [
    { id: 's1', key: 'rendor_sub_price', value: '10' },
    { id: 's2', key: 'rendor_sub_months', value: '1' },
    { id: 's3', key: 'min_withdrawal', value: '100' },
    { id: 's4', key: 'vapid_private_key', value: 'SECRET' },
    { id: 's5', key: 'commission_tiers', value: '[{"min":1,"max":99999,"pct":5}]' }
  ];
  const rendor = { userId: 'rendor-1', role: 'rendor' };
  const visible = access.applyReadPolicy('settings', rows, rendor);
  const byKey = Object.fromEntries(visible.map(r => [r.key, r.value]));

  // The admin's fee must survive the read policy, otherwise the rendor page
  // silently prices the plan from its own GHS 30 default.
  assert.equal(byKey['rendor_sub_price'], '10', 'the rendor cannot see the fee the admin set');
  assert.equal(byKey['min_withdrawal'], '100');
  assert.ok(byKey['commission_tiers'], 'vendors must see the commission policy they are charged');
  assert.equal(byKey['vapid_private_key'], undefined, 'a private key reached a client read');

  // Anonymous callers read settings too (vendor signup checks auto-approve
  // before the account exists).
  const anonVisible = access.applyReadPolicy('settings', rows, null).map(r => r.key);
  assert.ok(anonVisible.includes('rendor_sub_price'));
  assert.ok(!anonVisible.includes('vapid_private_key'));
});

test('the superseded per-plan rendor prices are gone', () => {
  const accessSrc = read('lib/access.js');
  for (const legacy of ['rendor_sub_monthly', 'rendor_sub_quarterly', 'rendor_sub_biannual']) {
    assert.ok(
      !accessSrc.includes(legacy),
      `${legacy} is a leftover generic price — the rendor fee is the single ` +
      `rendor_sub_price setting now`
    );
  }
});

// ── 2. The admin's commission table must drive real money ───────────────
test('commission tiers from Settings drive the money the server charges', () => {
  const custom = commerce.parseCommissionTiers(JSON.stringify([
    { min: 1, max: 50, pct: 20 },
    { min: 51, max: 99999, pct: 5 }
  ]));
  assert.ok(custom, 'a valid admin tier table must parse');
  assert.equal(commerce.commissionPct(10, custom), 20, 'the admin tier must win for a GHS 10 item');
  assert.equal(commerce.commissionPct(500, custom), 5);

  const money = commerce.packageMoney([{ price: 10, qty: 2 }], { tiers: custom });
  assert.equal(money.gross, 20);
  assert.equal(money.commission, 4, '20% of GHS 20 — the admin rate, not the default 8%');
  assert.equal(money.vendorAmount, 16);

  // Without a configured table the built-in tiers still apply, so an untouched
  // install charges exactly what it always did.
  const fallback = commerce.packageMoney([{ price: 10, qty: 2 }], {});
  assert.equal(fallback.commission, commerce.packageMoney([{ price: 10, qty: 2 }], { tiers: null }).commission);
  assert.equal(fallback.commission, 1.6, 'default 8% of GHS 20');
});

test('a malformed commission setting falls back instead of charging 0%', () => {
  assert.equal(commerce.parseCommissionTiers('not json'), null);
  assert.equal(commerce.parseCommissionTiers(''), null);
  assert.equal(commerce.parseCommissionTiers('[]'), null);
  assert.equal(commerce.parseCommissionTiers('[{"min":1,"max":9,"pct":-5}]'), null);
  assert.equal(commerce.parseCommissionTiers('[{"min":50,"max":10,"pct":5}]'), null);
  assert.equal(
    commerce.packageMoney([{ price: 10, qty: 1 }], { tiers: commerce.parseCommissionTiers('nonsense') }).commission,
    0.8,
    'a broken setting must fall back to the default tier table, never to 0%'
  );
});

// ── 3. Toggles the admin can turn off must actually be off ──────────────
function makeAdapter(user, settings = {}) {
  const state = { user: { wallet_balance: 100, ...user }, txns: [], rpcCalls: [] };
  return {
    state,
    adapter: {
      async loadUser() { return { ...state.user }; },
      async saveUser(_id, patch) { Object.assign(state.user, patch); return true; },
      async insert(table, rec) {
        if (table === 'wallet_transactions') state.txns.push(rec);
        return rec;
      },
      async update() { return null; },
      async listUserTxns() { return state.txns; },
      async loadAdmin() { return null; },
      async loadPackage() { return null; },
      async getSetting(k, def) { return Object.prototype.hasOwnProperty.call(settings, k) ? settings[k] : def; },
      async listActiveReferrals() { return []; },
      async countUserTxns() { return 0; },
      async moveBalance(rec) {
        state.rpcCalls.push(rec);
        return { ok: true, balance_after: state.user.wallet_balance, txn: {} };
      }
    }
  };
}

const VENDOR = { id: 'v1', role: 'vendor', is_verified: false, id_verified: false };
const viewer = { userId: 'v1', role: 'vendor' };

test('withdrawals are held back only while the admin requires verification', async () => {
  // Defaults (nothing configured): both checks apply, as before.
  const strict = makeAdapter(VENDOR, {});
  const blocked = await wallet.withdraw(strict.adapter, viewer, { amount: 10, method: 'mobile_money' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /verification/i);

  // Admin turned both off — an unverified vendor may withdraw again.
  const relaxed = makeAdapter(VENDOR, { require_phone_verify: 'false', require_id_verify: 'false' });
  const allowed = await wallet.withdraw(relaxed.adapter, viewer, { amount: 10, method: 'mobile_money' });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
});

test('the two verification toggles are independent', async () => {
  // Phone required, ID not: a phone-verified vendor with no ID passes.
  const phoneOnly = makeAdapter(
    { ...VENDOR, is_verified: true },
    { require_phone_verify: 'true', require_id_verify: 'false' }
  );
  const ok = await wallet.withdraw(phoneOnly.adapter, viewer, { amount: 10, method: 'mobile_money' });
  assert.equal(ok.ok, true, JSON.stringify(ok));

  // ID required, phone not: the same vendor is now blocked.
  const idOnly = makeAdapter(
    { ...VENDOR, is_verified: true },
    { require_phone_verify: 'false', require_id_verify: 'true' }
  );
  const blocked = await wallet.withdraw(idOnly.adapter, viewer, { amount: 10, method: 'mobile_money' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /ID verification/i);
});

test('the flat referral rate from Settings is the fallback for rewards', () => {
  const tiers = [{ min: 1, max: 99999, pct: 6 }];
  assert.equal(wallet.referralPctFor(tiers, 100, 7), 6, 'a configured tier wins');
  assert.equal(wallet.referralPctFor([], 100, 7), 7, 'no tiers → the admin flat rate');
  assert.equal(wallet.referralPctFor(null, 100, 7), 7);
  assert.equal(wallet.referralPctFor([], 100, undefined), 3, 'default stays 3%');
  assert.equal(wallet.referralPctFor([], 100, 'nonsense'), 3);
});

// ── 4. The wallet screen shows the configured processing window ─────────
test('the withdrawal window shown to vendors comes from Settings', () => {
  const walletSrc = read('js/wallet.js');
  assert.ok(
    walletSrc.includes("sVal('withdrawal_days'"),
    'js/wallet.js no longer reads the withdrawal_days setting'
  );
  assert.ok(
    !/1–2 business days/.test(walletSrc),
    'the hardcoded "1–2 business days" promise is back — the admin sets this window'
  );
});
