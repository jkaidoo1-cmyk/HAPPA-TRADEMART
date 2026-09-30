'use strict';
// Tests for the atomic stock reservation helpers (guide §7: no oversell).
// Uses a scriptable mock Supabase client so the compare-and-swap paths that
// only run in production are exercised without a database.

const { test } = require('node:test');
const assert = require('node:assert');
const commerce = require('../lib/commerce');

// ── Mock Supabase ────────────────────────────────────────────────────────
// Supports exactly the chains the helper uses:
//   from('products').update(patch).eq(k,v).eq(k,v).select('id')  → {data:[],error}
//   from('products').select('...').eq('id',v).maybeSingle()      → {data,row|null,error}
// Hooks let a test simulate concurrent buyers (mutate rows before the CAS is
// evaluated) or transport errors ('error') at a chosen update call.
function makeSupa(rows, opts = {}) {
  const db = { rows: {} };
  for (const r of rows) db.rows[String(r.id)] = { ...r };
  const counts = { updates: 0, reads: 0 };
  const state = {
    updateHooks: [...(opts.updateHooks || [])],
    readHooks: [...(opts.readHooks || [])]
  };

  function findRow(b) {
    const f = b.filters.find(x => x[0] === 'id');
    return f ? db.rows[String(f[1])] : null;
  }

  function exec(b) {
    if (b.op === 'update') {
      counts.updates++;
      const hook = state.updateHooks.shift();
      if (hook && hook(db) === 'error') return { data: null, error: new Error('network down') };
      const row = findRow(b);
      if (!row) return { data: [], error: null };
      for (const [k, v] of b.filters) {
        if (k !== 'id' && String(row[k]) !== String(v)) return { data: [], error: null }; // CAS miss
      }
      Object.assign(row, b.patch);
      return { data: [{ id: row.id }], error: null };
    }
    counts.reads++;
    const hook = state.readHooks.shift();
    if (hook && hook(db) === 'error') return { data: null, error: new Error('read down') };
    const row = findRow(b);
    return { data: row ? { ...row } : null, error: null };
  }

  class Builder {
    constructor() { this.op = null; this.patch = null; this.filters = []; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    select() { if (!this.op) this.op = 'select'; return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    maybeSingle() { return this; }
    then(resolve, reject) { Promise.resolve().then(() => exec(this)).then(resolve, reject); }
  }

  return { client: { from: () => new Builder() }, db, counts };
}

const req = (pid, qty, prod) => ({ pid, qty, before: prod.stock_qty, after: prod.stock_qty - qty, prod });

// ── Supabase CAS paths ───────────────────────────────────────────────────

test('CAS decrement lands on the first try', async () => {
  const { client, db } = makeSupa([{ id: 'p1', stock_qty: 5, total_sold: 0, name: 'A' }]);
  const out = await commerce.atomicStockDecrement(client, [req('p1', 2, { ...db.rows.p1 })]);
  assert.equal(out.ok, true);
  assert.equal(out.applied.length, 1);
  assert.equal(db.rows.p1.stock_qty, 3);
  assert.equal(db.rows.p1.total_sold, 2);
  assert.equal(db.rows.p1.sold_count, 2);
});

test('lost race: re-reads the fresh row and retries instead of overselling', async () => {
  const { client, db } = makeSupa([{ id: 'p1', stock_qty: 5, total_sold: 0, name: 'A' }], {
    // Another buyer takes 1 unit between our validation read and our CAS.
    updateHooks: [(d) => { d.rows.p1.stock_qty = 4; }]
  });
  const out = await commerce.atomicStockDecrement(client, [req('p1', 2, { ...db.rows.p1 })]);
  assert.equal(out.ok, true);
  assert.equal(db.rows.p1.stock_qty, 2); // 4 − 2 (fresh), NOT 5 − 2 (stale)
  assert.equal(db.rows.p1.total_sold, 2);
});

test('insufficient stock on fresh read refuses AND rolls back earlier rows', async () => {
  const { client, db } = makeSupa([
    { id: 'p1', stock_qty: 5, total_sold: 0, name: 'A' },
    { id: 'p2', stock_qty: 3, total_sold: 0, name: 'B' }
  ], {
    updateHooks: [
      null,                                    // p1 lands normally
      (d) => { d.rows.p2.stock_qty = 1; }      // concurrent buyer drains p2 first
    ]
  });
  const out = await commerce.atomicStockDecrement(client, [
    req('p1', 2, { ...db.rows.p1 }),
    req('p2', 3, { id: 'p2', stock_qty: 3, name: 'B' })
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);           // caller answers 409
  assert.match(out.error, /Only 1 left/);
  assert.equal(db.rows.p1.stock_qty, 5);      // reservation rolled back
  assert.equal(db.rows.p1.total_sold, 0);
  assert.equal(db.rows.p2.stock_qty, 1);      // never touched by us
});

test('transport error: no blind retry, refused as infra failure, rollback', async () => {
  const { client, db, counts } = makeSupa([
    { id: 'p1', stock_qty: 5, total_sold: 0 },
    { id: 'p2', stock_qty: 3, total_sold: 0 }
  ], { updateHooks: [null, () => 'error'] });
  const out = await commerce.atomicStockDecrement(client, [
    req('p1', 2, { stock_qty: 5 }),
    req('p2', 1, { stock_qty: 3 })
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.conflict, false);          // caller answers 503, not 409
  assert.equal(db.rows.p1.stock_qty, 5);      // rolled back
  // p1 apply + p2 failed attempt + p1 restore = 3 updates; p2 was NOT retried
  // (a timed-out update may already have landed — retrying could double-take).
  assert.equal(counts.updates, 3);
});

test('row deleted mid-flight refuses the sale', async () => {
  const { client, db } = makeSupa([{ id: 'p1', stock_qty: 5, total_sold: 0, name: 'A' }], {
    updateHooks: [(d) => { delete d.rows.p1; }]
  });
  const out = await commerce.atomicStockDecrement(client, [req('p1', 2, { stock_qty: 5, name: 'A' })]);
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);
  assert.match(out.error, /no longer available/);
});

test('unlimited-stock rows are skipped entirely', async () => {
  const { client, counts } = makeSupa([{ id: 'u', total_sold: 0 }]);
  const out = await commerce.atomicStockDecrement(client, [{ pid: 'u', qty: 3, prod: { stock_qty: undefined } }]);
  assert.equal(out.ok, true);
  assert.equal(out.applied.length, 0);
  assert.equal(counts.updates, 0);
});

// ── Local store paths ────────────────────────────────────────────────────

test('local decrement is all-or-nothing', () => {
  const products = [
    { id: 'a', stock_qty: 1, name: 'A', total_sold: 0 },
    { id: 'b', stock_qty: 5, name: 'B', total_sold: 0 }
  ];
  const out = commerce.applyLocalDecrement(products, [
    { pid: 'a', qty: 2 }, { pid: 'b', qty: 1 }
  ]);
  assert.equal(out.ok, false);
  assert.equal(out.conflict, true);
  assert.match(out.error, /Only 1 left/);
  assert.equal(products[1].stock_qty, 5); // second product untouched
  assert.equal(products[1].total_sold, 0);
});

test('local decrement marks sold out; restore puts stock back', () => {
  const products = [{ id: 'x', stock_qty: 2, total_sold: 0, status: 'active', is_available: true, name: 'X' }];
  const out = commerce.applyLocalDecrement(products, [{ pid: 'x', qty: 2 }]);
  assert.equal(out.ok, true);
  assert.equal(products[0].stock_qty, 0);
  assert.equal(products[0].status, 'sold_out');
  assert.equal(products[0].is_available, false);
  assert.equal(products[0].total_sold, 2);

  commerce.restoreLocalDecrement(products, out.applied);
  assert.equal(products[0].stock_qty, 2);
  assert.equal(products[0].total_sold, 0);
  assert.equal(products[0].status, 'active');
  assert.equal(products[0].is_available, true);
});

// ── "GHS null" regression (2026-09-30): a vendor product saved with
// price:null and name:'' because JSON.stringify(NaN) → null and
// Number(null) === 0 laundered the empty value through the old check.
test('validateProductBody rejects the payloads that used to save as GHS null', () => {
  assert.equal(commerce.validateProductBody({ name: 'Shorts', price: null }).ok, false);
  assert.equal(commerce.validateProductBody({ name: 'Shorts', price: '' }).ok, false);
  assert.equal(commerce.validateProductBody({ name: 'Shorts', price: 'abc' }).ok, false);
  assert.equal(commerce.validateProductBody({ name: 'Shorts', price: -5 }).ok, false);
  // A blank product name is rejected too — an untitled card is undiscoverable.
  assert.equal(commerce.validateProductBody({ name: '   ', price: 25 }).ok, false);
  // Partial updates and complete creates still pass.
  assert.equal(commerce.validateProductBody({ stock_qty: 3 }).ok, true);
  assert.equal(commerce.validateProductBody({ name: 'Blue Shorts', price: 25, original_price: 40, stock_qty: 3 }).ok, true);
});
