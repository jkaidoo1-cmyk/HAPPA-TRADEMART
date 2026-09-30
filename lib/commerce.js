'use strict';
// lib/commerce.js — server-authoritative money math for orders/packages.
// Mirrors the client's display formulas exactly, but is driven ONLY by product
// records and server-side settings — never by client-sent amounts.
// Reference: AI Coding Agent Master Guide §6 (commerce): "Server-calculate
// price, delivery, discount, commission ... from authoritative records
// immediately before checkout ... do not trust browser totals."

const COMMISSION_TIERS = [
  [1, 50, 8], [51, 100, 6], [101, 500, 4], [501, 1000, 3], [1001, Infinity, 2]
];
const PLATFORM_FEE_PCT = 1.5;   // main-site buyer fee (js/app.js PLATFORM_FEE_PCT)
const STOREFRONT_FEE_PCT = 1;   // storefront buyer fee (marketplace payout flow)

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Same tier table as js/app.js getCommission() — commission is a platform
// policy, so it is recomputed here from the unit price and never taken from a
// product row the vendor controls (a crafted commission_pct: 0 must not work).
function commissionPct(unitPrice) {
  const p = Number(unitPrice);
  for (const [min, max, pct] of COMMISSION_TIERS) {
    if (p >= min && p <= max) return pct;
  }
  return 2;
}

/**
 * Replace every item's price with the authoritative product price.
 * A referenced product that no longer exists rejects the whole request
 * (409) — we never charge an amount we cannot justify from a record.
 * opts.adminBypass lets admins keep client prices (manual/admin orders).
 * Returns { ok, error } or { ok:true, items, subtotal }.
 */
function resolveItems(items, productsById, opts = {}) {
  const out = [];
  let subtotal = 0;
  let count = 0;
  for (const raw of (Array.isArray(items) ? items : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const pid = String(raw.product_id || raw.id || '');
    const qty = Math.max(1, parseInt(raw.qty, 10) || 1);
    const prod = pid ? productsById.get(pid) : null;
    if (!prod) {
      if (!opts.adminBypass) {
        return {
          ok: false,
          error: 'An item in your cart is no longer available. Please refresh and try again.'
        };
      }
      const price = r2(raw.price);
      subtotal += price * qty;
      count += qty;
      out.push({ ...raw, qty, price });
      continue;
    }
    const price = r2(prod.price);
    subtotal += price * qty;
    count += qty;
    out.push({ ...raw, product_id: pid, qty, price });
  }
  return { ok: true, items: out, subtotal: r2(subtotal), itemsCount: count };
}

/**
 * Aggregate per-product stock requirements and refuse orders that would
 * oversell. Products without a finite stock_qty are treated as unlimited
 * (legacy rows). Returns { ok, error } or { ok:true, reqs } where each req
 * is { pid, qty, before, after, prod } for the caller to persist atomically.
 */
function stockRequirements(items, productsById) {
  const need = new Map();
  for (const it of items) {
    const pid = String(it.product_id || it.id || '');
    if (!pid) continue;
    need.set(pid, (need.get(pid) || 0) + (parseInt(it.qty, 10) || 1));
  }
  const reqs = [];
  for (const [pid, qty] of need) {
    const prod = productsById.get(pid);
    if (!prod) continue;
    const stock = Number(prod.stock_qty);
    if (!Number.isFinite(stock)) continue; // unlimited / legacy
    if (stock < qty) {
      const name = String(prod.name || 'An item').slice(0, 60);
      return { ok: false, error: `Only ${Math.max(0, stock)} left of "${name}" in your cart.` };
    }
    reqs.push({ pid, qty, before: stock, after: r2(stock - qty), prod });
  }
  return { ok: true, reqs };
}

const STORE_ITEM_ERROR = 'An item in your cart is not available from this store. Please refresh your cart and try again.';

/**
 * (#14) Item→store binding. A package is attributed to exactly one store and
 * that store's vendor is who gets paid, so a cart that mixes another store's
 * products into a package would silently redirect the earnings (and credit the
 * store sales stats) for products the store never sold. Every resolved item
 * must therefore be provable as belonging to the claimed store:
 *
 *   - product.store_id === store.id            → belongs (the normal case), or
 *   - legacy row with no store_id at all whose vendor_id is the store's
 *     vendor                                    → belongs.
 *
 * Anything else rejects the whole package (409). Items whose product row is
 * unknown are skipped — resolveItems only tolerates those for admins creating
 * manual orders, and the caller bypasses this check for admins anyway.
 * Returns { ok:true } | { ok:false, error }.
 */
function validateItemsForStore(items, productsById, store) {
  const storeId = String((store && store.id) || '');
  if (!storeId) {
    return { ok: false, error: 'We could not verify the store for this order. Please refresh and try again.' };
  }
  const vendorId = String((store && store.vendor_id) || '');
  for (const it of (Array.isArray(items) ? items : [])) {
    const pid = String((it && (it.product_id || it.id)) || '');
    if (!pid) continue;
    const prod = productsById.get(pid);
    if (!prod) continue; // unknown product — admin manual line item
    const pStore = String(prod.store_id || '');
    if (pStore) {
      if (pStore !== storeId) return { ok: false, error: STORE_ITEM_ERROR };
      continue;
    }
    // Pre-store_id row: it may ride along only under the store's own vendor.
    const pVendor = String(prod.vendor_id || '');
    if (!pVendor || !vendorId || pVendor !== vendorId) {
      return { ok: false, error: STORE_ITEM_ERROR };
    }
  }
  return { ok: true };
}

/**
 * Package money derivation. Storefront packages: vendor earns the full gross,
 * platform takes 1%, commission 0 (matches the storefront payout flow).
 * Main-site packages: tier commission + 1.5% platform fee — same formulas the
 * client displays, recomputed from authoritative prices.
 */
function packageMoney(items, opts = {}) {
  const storefront = !!opts.storefront;
  let gross = 0;
  let commission = 0;
  let itemCount = 0;
  for (const it of items) {
    const qty = parseInt(it.qty, 10) || 1;
    const price = Number(it.price) || 0;
    gross += price * qty;
    if (!storefront) commission += price * qty * commissionPct(price) / 100;
    itemCount += qty;
  }
  gross = r2(gross);
  commission = r2(commission);
  const fee = r2(gross * (storefront ? STOREFRONT_FEE_PCT : PLATFORM_FEE_PCT) / 100);
  return {
    gross,
    commission,
    vendorAmount: r2(gross - commission),
    platformFee: fee,
    itemCount,
    totalAmount: r2(gross + fee) // storefront buyer total (gross + fee)
  };
}

/** Order-level totals. discount must already be validated by computeDiscount. */
function orderTotals(items, opts = {}) {
  const storefront = !!opts.storefront;
  let subtotal = 0;
  for (const it of items) {
    subtotal += (Number(it.price) || 0) * (parseInt(it.qty, 10) || 1);
  }
  subtotal = r2(subtotal);
  const platformFee = r2(subtotal * (storefront ? STOREFRONT_FEE_PCT : PLATFORM_FEE_PCT) / 100);
  const discount = Math.min(subtotal, Math.max(0, r2(opts.discount)));
  const total = Math.max(0, r2(subtotal + platformFee - discount));
  return { subtotal, platformFee, deliveryFee: 0, discount, total };
}

/**
 * Validate a claimed discount against server-side records.
 *  - REF- personal coupons: code must embed the viewer's own id; the balance
 *    (referral_rewards earned − used) is recomputed from the ledger.
 *  - Standard coupons: looked up in the coupons setting, checked for
 *    active/max_uses/expiry, and the amount recomputed from type/value.
 * Unknown/unverifiable codes reject the order (409) rather than silently
 * charging a different amount than the buyer saw.
 * Returns { discount } | { discount, countUse, coupon } | { error }.
 */
function computeDiscount(codeRaw, subtotal, ctx = {}) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return { discount: 0 };

  if (code.startsWith('REF-')) {
    const uid = String(code.split('-')[1] || '');
    const viewerId = String(ctx.viewerId || '');
    if (!viewerId || uid !== viewerId) {
      return { error: 'This referral coupon cannot be used by you.' };
    }
    const earned = (Array.isArray(ctx.txns) ? ctx.txns : [])
      .filter(t => t && t.type === 'referral_reward' && String(t.status) !== 'failed')
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const used = parseFloat(ctx.user && ctx.user.referral_commission_used) || 0;
    const balance = Math.max(0, r2(earned - used));
    if (balance <= 0) return { error: 'No referral balance available.' };
    return { discount: Math.min(subtotal, balance) };
  }

  const coupons = ctx.coupons;
  if (!Array.isArray(coupons)) {
    return { error: `Coupon "${code}" is not valid.` };
  }
  const now = Date.now();
  const c = coupons.find(x => x && String(x.code || '').trim().toUpperCase() === code);
  if (!c) return { error: `Coupon "${code}" is not valid.` };
  if (c.active === false) return { error: `Coupon "${code}" is no longer active.` };
  const expiry = c.expires_at || c.expiry;
  if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) < now) {
    return { error: `Coupon "${code}" has expired.` };
  }
  const maxUses = parseInt(c.max_uses, 10);
  const usedCount = parseInt(c.used_count, 10) || 0;
  if (Number.isFinite(maxUses) && maxUses > 0 && usedCount >= maxUses) {
    return { error: `Coupon "${code}" has already been used the maximum number of times.` };
  }
  const val = parseFloat(c.value) || 0;
  const type = String(c.type || '');
  const raw = (type === '%' || type === 'pct') ? subtotal * val / 100 : val;
  const discount = Math.min(subtotal, r2(raw));
  if (discount <= 0) return { error: `Coupon "${code}" is not valid.` };
  return { discount, countUse: true, coupon: c };
}

/** Light sanity rules for product writes (POST/PUT/PATCH). */
function validateProductBody(body) {
  // JSON.stringify turns NaN into null and an empty input field into "", and
  // Number(null)/Number('') are 0 — so the old numeric-only check let a
  // product with NO price save as `price: null` and render as "GHS null".
  // A price field that is present must be a real, finite, non-negative number.
  if ('price' in body) {
    if (body.price == null || body.price === '') return { ok: false, error: 'Price is required. Enter how much the product costs.' };
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0) return { ok: false, error: 'Price must be a non-negative number.' };
  }
  if ('original_price' in body && body.original_price != null && body.original_price !== '') {
    const p = Number(body.original_price);
    if (!Number.isFinite(p) || p < 0) return { ok: false, error: 'Original price must be a non-negative number.' };
  }
  if ('stock_qty' in body && body.stock_qty != null && body.stock_qty !== '') {
    const s = Number(body.stock_qty);
    if (!Number.isFinite(s) || s < 0) return { ok: false, error: 'Stock must be a non-negative number.' };
  }
  // A product with a blank name is undiscoverable and unsearchable — block it
  // at the door instead of showing an empty titled card everywhere.
  if ('name' in body && !String(body.name || '').trim()) {
    return { ok: false, error: 'Product name is required.' };
  }
  if (body.is_flash_sale === true || body.is_flash_sale === 'true') {
    const pct = Number(body.flash_pct);
    if (body.flash_pct != null && body.flash_pct !== '' && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return { ok: false, error: 'Flash discount must be between 0 and 100.' };
    }
  }
  return { ok: true };
}

// ── Atomic stock mutation (guide §7: no oversell) ─────────────────────

function _soldOf(row) {
  const raw = row && (row.total_sold != null ? row.total_sold : row.sold_count);
  return Math.max(0, parseInt(raw, 10) || 0);
}

/**
 * Conditional (compare-and-swap) stock decrement against Supabase.
 * Each UPDATE only lands while stock_qty still equals the value we validated
 * (`UPDATE ... SET ... WHERE id = ? AND stock_qty = ?`), so two concurrent
 * purchases can never both take the last unit:
 *
 *  - CAS lands (row returned)      → applied, continue.
 *  - CAS misses (0 rows)           → someone else moved the row: re-read the
 *                                    fresh row and retry; if fresh stock can no
 *                                    longer cover the quantity the sale is
 *                                    refused (conflict → caller answers 409).
 *  - transport/timeout error       → the outcome is INDETERMINATE (the update
 *                                    may have landed server-side), so we never
 *                                    retry it blindly — bail as an infra
 *                                    failure (caller answers 503).
 *
 * On refusal, every row already applied in THIS call is restored first, so a
 * rejected sale never leaves stock behind. The restore only runs for rows we
 * got a definitive success for — never for the indeterminate one, because a
 * restore of an update that never landed would inflate stock (the oversell
 * direction). All errors returned: { ok:false, conflict, error }.
 *
 * Returns { ok:true, applied } where each applied entry is
 * { pid, qty, after, patch, prev } (patch = fields written, prev = status
 * before we touched it) so callers can mirror locally or undo via restoreStock.
 */
async function atomicStockDecrement(supabase, reqs, opts = {}) {
  const attempts = Math.max(1, opts.attempts || 4);
  const timeoutMs = opts.timeoutMs || 3000;
  const withTimeout = typeof opts.withTimeout === 'function' ? opts.withTimeout : (p) => p;
  const applied = [];
  // Deterministic lock order (by pid) avoids deadlocks between overlapping sales.
  const sorted = [...reqs].sort((a, b) => String(a.pid).localeCompare(String(b.pid)));

  const bail = async (conflict, error) => {
    if (applied.length) await restoreStock(supabase, applied, opts);
    return { ok: false, conflict, error: String((error && error.message) || error) };
  };

  for (const req of sorted) {
    const prod = (req && req.prod) || {};
    let stock = Number(prod.stock_qty);
    if (!Number.isFinite(stock)) continue; // unlimited / legacy row
    let sold = _soldOf(prod);
    let done = false;

    for (let attempt = 0; attempt < attempts && !done; attempt++) {
      const after = r2(stock - req.qty);
      const newSold = sold + req.qty;
      const patch = { stock_qty: after, total_sold: newSold, sold_count: newSold };
      if (after === 0) { patch.status = 'sold_out'; patch.is_available = false; }

      let data = null; let error = null;
      try {
        ({ data, error } = await withTimeout(
          supabase.from('products').update(patch).eq('id', req.pid).eq('stock_qty', stock).select('id'),
          timeoutMs));
      } catch (e) { error = e; }

      if (!error && Array.isArray(data) && data.length) {
        applied.push({
          pid: String(req.pid), qty: req.qty, after, patch,
          prev: { status: prod.status, is_available: prod.is_available }
        });
        done = true;
        break;
      }
      if (error) return bail(false, error); // indeterminate — never blind-retry

      // Definitive 0-row CAS miss: the row moved under us. Re-read fresh.
      let fresh = null; let readErr = null;
      try {
        const r = await withTimeout(
          supabase.from('products').select('id, stock_qty, total_sold, sold_count, name, status, is_available').eq('id', req.pid).maybeSingle(),
          timeoutMs);
        readErr = r.error || null;
        fresh = r.data || null;
      } catch (e) { readErr = e; }
      if (readErr) return bail(false, readErr);
      if (!fresh) return bail(true, new Error('An item in your cart is no longer available.'));

      const fs = Number(fresh.stock_qty);
      if (Number.isFinite(fs) && fs < req.qty) {
        const name = String(fresh.name || prod.name || 'An item').slice(0, 60);
        return bail(true, new Error(`Only ${Math.max(0, fs)} left of "${name}" in your cart.`));
      }
      if (!Number.isFinite(fs)) break; // became unlimited — nothing to take
      stock = fs;
      sold = _soldOf(fresh);
    }

    if (!done) return bail(false, new Error('Could not reserve stock (persistent contention). Please retry.'));
  }
  return { ok: true, applied };
}

/**
 * Best-effort undo for rows that were DEFINITIVELY decremented. Read + CAS
 * again (stock may have moved since we took it); the target is always
 * `current + qty`, so we can only ever return the unit we took — restoring
 * never pushes stock above reality. A failed restore leaves stock lower than
 * reality (a missed sale — the safe direction) and is logged by the caller.
 */
async function restoreStock(supabase, applied, opts = {}) {
  const attempts = Math.max(1, opts.attempts || 4);
  const timeoutMs = opts.timeoutMs || 3000;
  const withTimeout = typeof opts.withTimeout === 'function' ? opts.withTimeout : (p) => p;
  for (const entry of [...applied].reverse()) {
    let restored = false;
    for (let attempt = 0; attempt < attempts && !restored; attempt++) {
      let fresh = null; let readErr = null;
      try {
        const r = await withTimeout(
          supabase.from('products').select('id, stock_qty, total_sold, sold_count, status, is_available').eq('id', entry.pid).maybeSingle(),
          timeoutMs);
        readErr = r.error || null;
        fresh = r.data || null;
      } catch (e) { readErr = e; }
      if (readErr || !fresh) continue;
      const cur = Number(fresh.stock_qty);
      if (!Number.isFinite(cur)) { restored = true; break; } // unlimited now
      const target = r2(cur + entry.qty);
      const backSold = Math.max(0, _soldOf(fresh) - entry.qty);
      const patch = { stock_qty: target, total_sold: backSold, sold_count: backSold };
      if (entry.patch && entry.patch.status === 'sold_out' && target > 0) {
        patch.status = (entry.prev && entry.prev.status) || 'active';
        patch.is_available = entry.prev ? entry.prev.is_available !== false : true;
      }
      try {
        const { data, error } = await withTimeout(
          supabase.from('products').update(patch).eq('id', entry.pid).eq('stock_qty', cur).select('id'),
          timeoutMs);
        if (!error && Array.isArray(data) && data.length) restored = true;
      } catch (e) {}
    }
    if (!restored && opts.log !== false) {
      console.error('[commerce] FAILED to restore stock for product', entry.pid, '(+' + entry.qty, ') — stock may be under-counted; correct manually.');
    }
  }
}

/**
 * Synchronous all-or-nothing decrement for the local JSON store. Two passes
 * (validate every requirement against a fresh read, then apply) run without a
 * single await in between, so on Node's single thread nothing can interleave
 * and a refusal never leaves a partial decrement.
 * Returns { ok:true, applied } | { ok:false, conflict:true, error }.
 */
function applyLocalDecrement(products, reqs) {
  const rows = new Map();
  for (const p of (products || [])) if (p && p.id != null) rows.set(String(p.id), p);
  // Pass 1 — validate against the freshest local values.
  for (const req of reqs) {
    const row = rows.get(String(req.pid));
    if (!row) continue;
    const stock = Number(row.stock_qty);
    if (!Number.isFinite(stock)) continue;
    if (stock < req.qty) {
      const name = String(row.name || 'An item').slice(0, 60);
      return { ok: false, conflict: true, error: `Only ${Math.max(0, stock)} left of "${name}" in your cart.` };
    }
  }
  // Pass 2 — apply.
  const applied = [];
  for (const req of reqs) {
    const row = rows.get(String(req.pid));
    if (!row) continue;
    const stock = Number(row.stock_qty);
    if (!Number.isFinite(stock)) continue;
    const sold = _soldOf(row) + req.qty;
    const prev = { status: row.status, is_available: row.is_available };
    row.stock_qty = r2(stock - req.qty);
    row.total_sold = sold;
    row.sold_count = sold;
    const patch = { stock_qty: row.stock_qty, total_sold: sold, sold_count: sold };
    if (row.stock_qty === 0) { row.status = 'sold_out'; row.is_available = false; patch.status = 'sold_out'; patch.is_available = false; }
    applied.push({ pid: String(req.pid), qty: req.qty, after: row.stock_qty, patch, prev });
  }
  return { ok: true, applied };
}

/** Undo for applyLocalDecrement — same `current + qty` safety rule. */
function restoreLocalDecrement(products, applied) {
  const rows = new Map();
  for (const p of (products || [])) if (p && p.id != null) rows.set(String(p.id), p);
  for (const entry of [...applied].reverse()) {
    const row = rows.get(String(entry.pid));
    if (!row) continue;
    const cur = Number(row.stock_qty);
    if (!Number.isFinite(cur)) continue;
    row.stock_qty = r2(cur + entry.qty);
    row.total_sold = Math.max(0, _soldOf(row) - entry.qty);
    row.sold_count = row.total_sold;
    if (entry.patch && entry.patch.status === 'sold_out' && row.stock_qty > 0) {
      row.status = (entry.prev && entry.prev.status) || 'active';
      row.is_available = entry.prev ? entry.prev.is_available !== false : true;
    }
  }
}

module.exports = {
  PLATFORM_FEE_PCT,
  STOREFRONT_FEE_PCT,
  COMMISSION_TIERS,
  r2,
  commissionPct,
  resolveItems,
  stockRequirements,
  validateItemsForStore,
  packageMoney,
  orderTotals,
  computeDiscount,
  validateProductBody,
  atomicStockDecrement,
  restoreStock,
  applyLocalDecrement,
  restoreLocalDecrement
};
