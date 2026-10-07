'use strict';
// (#5) The wallet engine must move money atomically.
//
// Two paths:
//   1. Supabase  → the wallet_move RPC (row lock + ledger insert + balance
//      update in one transaction, idempotent on user_id+type+reference). The
//      engine must hand the whole move to it and must NOT also write the ledger
//      row or the balance itself.
//   2. db.json   → the same read-check-write sequence, but serialized per
//      wallet so two concurrent requests cannot both spend the same balance.
//
// These are unit tests against a stub adapter, so they run without a database.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const wallet = require('../lib/wallet');

// A stub adapter: the "database" is a plain object, and every write is counted so
// the tests can prove where the money actually moved.
function makeAdapter(user, opts = {}) {
  const state = {
    user: { wallet_balance: 0, ...user },
    txns: [],
    inserts: 0,
    saveUserCalls: 0,
    rpcCalls: []
  };
  const adapter = {
    async loadUser() { return { ...state.user }; },
    async saveUser(_id, patch) {
      state.saveUserCalls += 1;
      Object.assign(state.user, patch);
      return true;
    },
    async insert(table, rec) {
      state.inserts += 1;
      if (table === 'wallet_transactions') state.txns.push(rec);
      return rec;
    },
    async update() { return null; },
    async listUserTxns() { return state.txns; },
    async loadAdmin() { return null; },
    async loadPackage() { return null; },
    async getSetting(_k, def) { return def; },
    async listActiveReferrals() { return []; },
    async countUserTxns() { return 0; }
  };
  if (opts.rpc) {
    adapter.moveBalance = async (rec, row) => {
      state.rpcCalls.push({ rec, row });
      if (opts.rpc.fail) return { ok: false, error: opts.rpc.fail };
      const delta = rec.balanceDelta != null ? rec.balanceDelta : rec.amount;
      const after = Math.round((state.user.wallet_balance + delta) * 100) / 100;
      if (after < 0) return { ok: false, error: 'Insufficient balance' };
      state.user.wallet_balance = after;
      return { ok: true, balance_after: after, txn_id: 'rpc-txn-1', txn: { ...row, balance_after: after } };
    };
  }
  return { adapter, state };
}

test('#5: applyMove credits the balance and writes one ledger row', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 10 });
  const res = await wallet.applyMove(adapter, { user_id: 'u1', type: 'deposit', amount: 5, reference: 'DEP1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.balanceAfter, 15);
  assert.equal(state.user.wallet_balance, 15);
  assert.equal(state.txns.length, 1);
  assert.equal(state.txns[0].amount, 5);
  assert.equal(state.txns[0].balance_before, 10);
  assert.equal(state.txns[0].balance_after, 15);
});

test('#5: balanceDelta lets a withdrawal record +amount while the balance drops', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 100 });
  const res = await wallet.applyMove(adapter, {
    user_id: 'u1', type: 'withdrawal', amount: 30, balanceDelta: -30, reference: 'WD1'
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.balanceAfter, 70);
  assert.equal(state.txns[0].amount, 30, 'the ledger keeps the requested magnitude');
  assert.equal(state.txns[0].balance_after, 70);
  assert.equal(state.user.wallet_balance, 70);
});

test('#5: the local path refuses to go negative', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 5 });
  const res = await wallet.applyMove(adapter, { user_id: 'u1', type: 'purchase', amount: 50, balanceDelta: -50 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(state.user.wallet_balance, 5, 'the balance is untouched');
  assert.equal(state.txns.length, 0, 'no ledger row is written for a refused move');
});

test('#5: the RPC is trusted with the whole move (no double write)', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 20 }, { rpc: {} });
  const res = await wallet.applyMove(adapter, { user_id: 'u1', type: 'deposit', amount: 5, reference: 'DEP2' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.balanceAfter, 25);
  assert.equal(state.rpcCalls.length, 1, 'the RPC is called exactly once');
  assert.equal(state.inserts, 0, 'the engine must not also insert the ledger row');
  assert.equal(state.saveUserCalls, 0, 'the engine must not also write the balance');
  assert.equal(state.user.wallet_balance, 25);
});

test('#5: an RPC rejection is surfaced, never retried locally', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 20 }, { rpc: { fail: 'Insufficient balance' } });
  const res = await wallet.applyMove(adapter, { user_id: 'u1', type: 'purchase', amount: 500, balanceDelta: -500 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(state.saveUserCalls, 0, 'a failed RPC must not be replayed through the local path');
  assert.equal(state.inserts, 0);
  assert.equal(state.user.wallet_balance, 20);
});

test('#5: concurrent moves on one wallet cannot overspend', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 10 });
  // Both start from the same 10. Serialized, the second must see the first's
  // result; unserialized they would both pass and the balance would go negative.
  const [a, b] = await Promise.all([
    wallet.applyMove(adapter, { user_id: 'u1', type: 'withdrawal', amount: 8, balanceDelta: -8, reference: 'C1' }),
    wallet.applyMove(adapter, { user_id: 'u1', type: 'withdrawal', amount: 8, balanceDelta: -8, reference: 'C2' })
  ]);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(b.ok, false, 'the second move must be refused');
  assert.equal(state.txns.length, 1);
  assert.equal(state.user.wallet_balance, 2);
});

test('#5: a replayed reference on the local path cannot move money twice', async () => {
  // The Supabase path is idempotent via the unique (user_id, type, reference)
  // index. db.json has no such constraint, so without an explicit check a
  // retried deposit/payout credited the wallet again — the module claimed
  // otherwise and storefrontPayout/releaseDelivery rely on the promise.
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 10 });
  const rec = { user_id: 'u1', type: 'earning', amount: 25, reference: 'SFP-pkg-7', package_id: 'pkg-7' };

  const first = await wallet.applyMove(adapter, rec);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(state.user.wallet_balance, 35);

  const again = await wallet.applyMove(adapter, rec);
  assert.equal(again.ok, true, 'a replay is answered as success, not an error');
  assert.equal(state.user.wallet_balance, 35, 'the replay must not credit the wallet again');
  assert.equal(state.txns.length, 1, 'no second ledger row is written');
  assert.equal(again.balanceAfter, 35);

  // A genuinely different reference still moves money.
  const other = await wallet.applyMove(adapter, { ...rec, reference: 'SFP-pkg-8' });
  assert.equal(other.ok, true);
  assert.equal(state.user.wallet_balance, 60);
});

test('#5: a zero amount is refused before anything is written', async () => {
  const { adapter, state } = makeAdapter({ id: 'u1', wallet_balance: 10 });
  const res = await wallet.applyMove(adapter, { user_id: 'u1', type: 'deposit', amount: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(state.inserts, 0);
  assert.equal(state.user.wallet_balance, 10);
});

test('#5: the ledger row shape is complete (package link survives)', () => {
  const row = wallet.buildTxnRow({
    user_id: 'u1', type: 'earning', amount: 12.345, balance_before: 1, balance_after: 13.34,
    package_id: 'pkg-9', reference: 'REL-pkg-9', note: 'n'
  });
  assert.equal(row.amount, 12.35, 'money is rounded to 2dp');
  assert.equal(row.package_id, 'pkg-9', 'the package link is not silently dropped');
  assert.equal(row.balance_after, 13.34);
  assert.ok(row.id && row.created_at && row.updated_at);
});
