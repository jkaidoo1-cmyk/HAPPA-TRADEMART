/**
 * HAPPA TRADEMART — Server-side wallet engine.
 *
 * The ONLY place balance-changing ledger rows are created. Both backends
 * (server.js local dev, api/index.js deployed) wire this in with a small
 * persistence adapter so the money rules live in exactly one place:
 *
 *   - deposit            → credits the session user's wallet (ledger first)
 *   - withdraw           → holds the session user's balance (pending admin approval)
 *   - pay                → deducts the wallet, or records a MoMo payment (storefront
 *                          subscription payments; also records platform revenue)
 *   - storefront-payout  → credits the store vendor + platform admin when a storefront
 *                          order is placed (amounts re-derived from the package, never
 *                          trusted from the client)
 *   - release-delivery   → pays vendor earnings + platform commission + referral reward
 *                          on delivery (admin or the package's own vendor)
 *   - refund-reject      → refunds the buyer and claws back storefront payouts on
 *                          rejection (admin or the package's own vendor)
 *
 * Every action is idempotent so a retried / duplicated request can never move
 * money twice.
 */

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function txnId() {
  return 'wtx-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100);
}

// Mirror of the client's getEffectiveReferralCommissionPct (js/admin-settings.js).
function referralPctFor(tiers, amount, fallbackPct) {
  const fallback = Number.isFinite(Number(fallbackPct)) && Number(fallbackPct) >= 0
    ? Number(fallbackPct)
    : 3;
  if (Array.isArray(tiers) && tiers.length) {
    for (const t of tiers) {
      const maxVal = Number(t.max) >= 99999 ? Infinity : Number(t.max);
      if (amount >= Number(t.min) && amount <= maxVal) return Number(t.pct) || 0;
    }
    return Number(tiers[tiers.length - 1] && tiers[tiers.length - 1].pct) || fallback;
  }
  // No tier table configured — the flat rate from Settings applies.
  return fallback;
}

// The full ledger row shape. Kept separate from the insert so the atomic-move
// path can hand the exact same row to the persistence layer (which mirrors it
// locally while the database transaction does the real work).
function buildTxnRow(rec) {
  return {
    id: rec.id || txnId(),
    user_id: String(rec.user_id != null ? rec.user_id : ''),
    type: rec.type,
    amount: r2(rec.amount),
    balance_before: r2(rec.balance_before),
    balance_after: r2(rec.balance_after),
    description: rec.description || '',
    reference: rec.reference || '',
    payment_method: rec.payment_method || 'system',
    status: rec.status || 'completed',
    note: rec.note || '',
    network: rec.network || '',
    account_number: rec.account_number || '',
    reviewed_by: rec.reviewed_by || '',
    // (#15) The package a row settles. Previously this was dropped here, so a
    // refund could not prove whether the same package had already paid out.
    package_id: rec.package_id || '',
    created_at: rec.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// Ledger-only write: records a row WITHOUT touching the balance (used for
// payments that arrive through an external gateway, where balance_before and
// balance_after are identical). Returns the row or null (never throws).
async function writeTxn(adapter, rec) {
  try {
    return await adapter.insert('wallet_transactions', buildTxnRow(rec));
  } catch (e) {
    console.warn('[Wallet] ledger write failed:', e && e.message || e);
    return null;
  }
}

// Per-user move queue for the local backend. db.json has no transactions, so
// the fallback path serializes its read-check-write per wallet: two concurrent
// requests can no longer both read the old balance and both write.
const moveChains = new Map();
function withUserLock(key, fn) {
  const prev = moveChains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  moveChains.set(key, next.then(() => {}, () => {}));
  return next;
}

// Translate a wallet_move RPC failure into an HTTP-shaped result.
function moveFailure(res) {
  const raw = String((res && res.error) || '');
  if (/insufficient/i.test(raw)) return { ok: false, status: 400, error: 'Insufficient wallet balance. Top up your wallet first.' };
  if (/user not found/i.test(raw)) return { ok: false, status: 404, error: 'User not found.' };
  if (/non-zero/i.test(raw)) return { ok: false, status: 400, error: 'Enter a valid amount.' };
  return { ok: false, status: 500, error: raw || 'The wallet could not be updated.' };
}

/**
 * (#5) Move money in ONE step: the ledger row and the new balance.
 *
 * On the Supabase backend this is the `wallet_move` RPC (migration 005): it
 * takes a row lock on the wallet, refuses a negative balance, inserts the
 * ledger row and updates the balance inside a single transaction, and is
 * idempotent on (user_id, type, reference) — so a retried request can never
 * move money twice. `amount` is the ledger magnitude (always positive on the
 * rows the UI renders); `balanceDelta` is the signed balance change and
 * defaults to `amount` (a withdrawal records +500 but removes 500).
 *
 * On the local json backend there is no transaction to be had, so the same
 * read-check-write sequence runs under a per-wallet lock.
 *
 * @returns {{ok: true, balanceAfter: number, txn: object} | {ok: false, status: number, error: string}}
 */
async function applyMove(adapter, rec) {
  const amount = r2(rec.amount);
  if (!amount) return { ok: false, status: 400, error: 'Enter a valid amount.' };
  const delta = rec.balanceDelta != null ? r2(rec.balanceDelta) : amount;

  if (typeof adapter.moveBalance === 'function') {
    const res = await adapter.moveBalance({ ...rec, amount, balanceDelta: delta }, buildTxnRow(rec));
    if (res && res.ok === false) return moveFailure(res);
    if (res && res.ok === true) {
      const after = r2(res.balance_after);
      return {
        ok: true,
        balanceAfter: after,
        txn: res.txn || { ...buildTxnRow(rec), id: res.txn_id || txnId(), balance_before: r2(after - delta), balance_after: after }
      };
    }
    // res === null → the RPC is not available; fall through to the local path.
  }

  return withUserLock(String(rec.user_id), async () => {
    const user = await adapter.loadUser(rec.user_id);
    if (!user) return { ok: false, status: 404, error: 'User not found.' };
    const before = r2(user.wallet_balance || 0);
    const after = r2(before + delta);
    if (after < 0) return { ok: false, status: 400, error: 'Insufficient wallet balance. Top up your wallet first.' };

    const txn = await writeTxn(adapter, { ...rec, amount, balance_before: before, balance_after: after });
    if (!txn) return { ok: false, status: 500, error: 'Could not record the transaction. Balance was NOT changed.' };

    let saved = true;
    try { saved = await adapter.saveUser(rec.user_id, { wallet_balance: after }); } catch (e) { saved = false; }
    if (saved === false) {
      console.warn('[Wallet] balance write did not reach the primary store for', rec.user_id, '— ledger row', txn && txn.id);
      return { ok: false, status: 500, error: 'The new balance could not be saved. Please contact support.' };
    }
    return { ok: true, balanceAfter: after, txn };
  });
}

/**
 * (#15) Record the package's settlement state (pending → released | refunded)
 * so the two settlements are mutually exclusive. Prefers a dedicated adapter
 * method, then the generic table update.
 */
async function markSettlement(adapter, packageId, status) {
  if (!packageId) return null;
  try {
    if (typeof adapter.updatePackage === 'function') return await adapter.updatePackage(packageId, { settlement_status: status });
    if (typeof adapter.update === 'function') return await adapter.update('packages', packageId, { settlement_status: status });
  } catch (e) {
    console.warn('[Wallet] settlement_status update failed for', packageId, ':', e && e.message || e);
  }
  return null;
}

// PostgREST reports a missing function as PGRST202 ("Could not find the
// function … in the schema cache"); older/edge builds surface PostgreSQL's
// 42883 undefined_function. Anything else is a real failure and must NOT be
// retried through the non-atomic path, or the money would move twice.
function rpcUnavailable(error) {
  const code = String((error && error.code) || '');
  const msg = String((error && error.message) || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(msg);
}

/**
 * (#5) Atomic balance move against Supabase via the wallet_move RPC, then mirror
 * the resulting ledger row + balance into the local store (db.json), because the
 * read paths merge local OVER Supabase — a skipped mirror would leave a stale
 * balance visible for the rest of the session.
 *
 * @returns {{ok: true, balance_after: number, txn: object} | {ok: false, error: string} | null}
 *          `null` means the RPC is not deployed yet, so the caller falls back to
 *          the local read/write path. A non-null failure must be surfaced, never
 *          retried.
 */
async function rpcMoveBalance({ supabase, withTimeout, rec, row, mirror }) {
  if (!supabase || typeof supabase.rpc !== 'function') return null;
  const delta = r2(rec.balanceDelta != null ? rec.balanceDelta : rec.amount);
  let out;
  try {
    out = await withTimeout(supabase.rpc('wallet_move', {
      p_user_id: String(rec.user_id),
      p_type: String(rec.type),
      p_amount: r2(rec.amount),
      p_reference: String(rec.reference || ''),
      p_description: String(rec.description || ''),
      p_payment_method: String(rec.payment_method || 'system'),
      p_balance_delta: delta,
      p_extra: {
        status: rec.status || 'completed',
        note: rec.note || '',
        network: rec.network || '',
        account_number: rec.account_number || '',
        reviewed_by: rec.reviewed_by || '',
        package_id: rec.package_id || ''
      }
    }), 3000);
  } catch (e) {
    console.warn('[Wallet] wallet_move RPC threw:', e && e.message || e);
    return null;
  }
  const error = out && out.error;
  if (error) {
    if (rpcUnavailable(error)) {
      console.warn('[Wallet] wallet_move RPC not deployed yet — using the local path:', error.message);
      return null;
    }
    console.warn('[Wallet] wallet_move RPC failed:', error.message);
    return { ok: false, error: error.message || 'The wallet could not be updated.' };
  }

  const result = Array.isArray(out.data) ? out.data[0] : out.data;
  if (!result) return { ok: false, error: 'The wallet move returned no result.' };
  if (result.ok === false) return { ok: false, error: result.error || 'The wallet could not be updated.' };

  const after = r2(result.balance_after);
  const stamped = {
    ...row,
    id: result.txn_id || row.id,
    balance_before: r2(after - delta),
    balance_after: after
  };
  if (typeof mirror === 'function') {
    try { mirror(stamped, after); } catch (e) { console.warn('[Wallet] local mirror failed:', e && e.message || e); }
  }
  return { ok: true, balance_after: after, txn: stamped };
}

// `code`/`extra` are optional machine-readable hints for the client. They never
// reach the user as-is: a code lets the UI say something useful (e.g. refresh a
// price that admin changed mid-checkout) instead of printing `error` verbatim.
function fail(status, error, code, extra) {
  const out = { ok: false, status, error };
  if (code) out.code = code;
  if (extra && typeof extra === 'object') out.extra = extra;
  return out;
}
function ok(data) { return { ok: true, data }; }

/**
 * POST /api/wallet/deposit — { amount, method, network, account_number, payment_ref, note }
 * Credits the session user. Payment verification is a separate concern (a real
 * gateway is a future integration); the ledger + balance move atomically.
 */
async function deposit(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) === 'rendor') {
    return fail(403, 'Rendors do not have a wallet.');
  }
  // SECURITY: Without a real MoMo/payment gateway verifying the transaction,
  // any user calling deposit with an arbitrary amount would mint free money.
  // Only admins may credit wallets until a payment gateway is integrated.
  if (String(viewer.role) !== 'admin') {
    return fail(403, 'Wallet deposits require admin approval. Please contact support.');
  }
  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid deposit amount.');
  }
  // One atomic move: ledger row + balance (wallet_move RPC on Supabase, lock
  // + read/write on the local store).
  const res = await applyMove(adapter, {
    user_id: viewer.userId,
    type: 'deposit',
    amount,
    payment_method: String(body.method || 'mobile_money'),
    reference: String(body.payment_ref || 'DEP' + Date.now()),
    network: String(body.network || ''),
    account_number: String(body.account_number || ''),
    status: 'completed',
    note: String(body.note || 'Wallet top-up'),
    reviewed_by: ''
  });
  if (!res.ok) return fail(res.status, res.error);
  return ok({ balance: res.balanceAfter, txn: res.txn });
}

/**
 * POST /api/wallet/withdraw — { amount, method, network, account_number, note }
 * Holds the session user's balance (status pending) for admin approval.
 */
async function withdraw(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) !== 'vendor') {
    return fail(403, 'Only vendors can request withdrawals.');
  }
  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  // Verification is demanded only when Settings says so (both default to on, and
  // to on when the adapter cannot answer). These two toggles were saved by the
  // admin but never read, so switching them off still refused every withdrawal
  // with no way to see why.
  const toggle = async (key) => {
    if (typeof adapter.getSetting !== 'function') return true;
    return String(await adapter.getSetting(key, 'true')) !== 'false';
  };
  const requirePhone = await toggle('require_phone_verify');
  const requireId    = await toggle('require_id_verify');
  if (requirePhone && !user.is_verified) {
    return fail(403, 'Complete phone verification before withdrawing.');
  }
  if (requireId && !user.id_verified) {
    return fail(403, 'Complete ID verification before withdrawing.');
  }

  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid withdrawal amount.');
  }
  const balBefore = r2(user.wallet_balance || 0);
  if (amount > balBefore) return fail(400, 'Amount exceeds available balance.');

  const method = String(body.method || 'mobile_money');
  if (!['mobile_money', 'bank_transfer'].includes(method)) return fail(400, 'Invalid withdrawal method.');

  // Respect the pending-withdrawal limit from Settings (default 3).
  const maxPending = parseInt(await adapter.getSetting('max_pending_withdrawals', '3'), 10) || 3;
  const pendingCount = await adapter.countUserTxns(viewer.userId, t => t.type === 'withdrawal' && t.status === 'pending');
  if (pendingCount >= maxPending) {
    return fail(400, `You have ${pendingCount} pending withdrawal request${pendingCount > 1 ? 's' : ''}. Wait for it to be processed before submitting another.`);
  }

  // (#5) Hold the balance atomically. The old code re-read the balance and
  // then wrote, which still lost the race between two parallel requests; the
  // wallet_move RPC locks the wallet row (and refuses a negative result) and
  // the local path runs under a per-wallet lock. The DB CHECK
  // (wallet_balance >= 0) in migration 005 backs this up.
  const res = await applyMove(adapter, {
    user_id: viewer.userId,
    type: 'withdrawal',
    amount,
    // The ledger row shows the requested amount (+), the balance goes down.
    balanceDelta: -amount,
    payment_method: method,
    // Random suffix: two requests in the same millisecond must not share a
    // reference, or the unique (user_id, type, reference) index would treat the
    // second one as an idempotent replay and silently skip it.
    reference: 'WD' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000),
    network: String(body.network || ''),
    account_number: String(body.account_number || ''),
    status: 'pending',
    note: String(body.note || (method === 'mobile_money' ? 'MoMo withdrawal' : 'Bank transfer withdrawal')),
    reviewed_by: ''
  });
  if (!res.ok) return fail(res.status, res.error);
  return ok({ balance: res.balanceAfter, txn: res.txn });
}

/**
 * POST /api/wallet/pay — { amount, method: 'wallet'|'momo', note, record_revenue? }
 * Used for storefront subscription payments. 'wallet' deducts the balance with a
 * full ledger entry; 'momo' records the payment without a balance change (a real
 * MoMo gateway is a future integration). Optional record_revenue
 * { source, description, reference } records a platform_revenue row.
 */
async function pay(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) === 'rendor') {
    return fail(403, 'Rendors do not have a wallet.');
  }
  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid payment amount.');
  }
  const method = String(body.method || 'wallet');
  if (!['wallet', 'momo'].includes(method)) return fail(400, 'Invalid payment method.');

  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  const row = {
    user_id: viewer.userId,
    type: 'payment',
    amount,
    payment_method: method,
    // Random suffix prevents a same-millisecond reference collision (the
    // unique (user_id, type, reference) index would drop the second row).
    reference: String(body.payment_ref || 'PAY' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000)),
    status: 'completed',
    note: String(body.note || 'Payment'),
    reviewed_by: ''
  };

  let balAfter;
  let txn;
  if (method === 'wallet') {
    const res = await applyMove(adapter, { ...row, balanceDelta: -amount });
    if (!res.ok) return fail(res.status, res.error);
    balAfter = res.balanceAfter;
    txn = res.txn;
  } else {
    // A gateway payment never touches the wallet, so this is a ledger-only row:
    // balance_before === balance_after. wallet_move applies an amount, so it
    // cannot express this shape.
    balAfter = r2(user.wallet_balance || 0);
    txn = await writeTxn(adapter, { ...row, balance_before: balAfter, balance_after: balAfter });
    if (!txn) return fail(500, 'Could not record the transaction. Payment was NOT completed.');
  }

  if (body.record_revenue && typeof body.record_revenue === 'object') {
    const rv = body.record_revenue;
    try {
      await adapter.insert('platform_revenue', {
        source: String(rv.source || 'subscription'),
        amount: r2(rv.amount != null ? rv.amount : amount),
        reference: String(rv.reference || 'REV' + Date.now()),
        description: String(rv.description || ''),
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[Wallet] platform_revenue record failed:', e && e.message || e);
    }
  }

  return ok({ balance: balAfter, txn });
}

/**
 * POST /api/wallet/rendor-subscribe — { months, amount, method, payment_ref, note }
 * Simple rendor subscription: the rendor pays a single price set by admin
 * (per-rendor override wins, else the global setting). Subscription activates
 * IMMEDIATELY — no admin verification round-trip. Renewals extend from the
 * current expiry. Idempotent via the payment reference.
 */
async function rendorSubscribe(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) !== 'rendor') {
    return fail(403, 'Only rendors can subscribe.');
  }
  const months = Number(body && body.months);
  if (!Number.isFinite(months) || months < 1 || months > 24) return fail(400, 'Invalid subscription duration.');

  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid payment amount.');
  }
  const method = String(body.method || 'momo');
  if (!['momo', 'wallet'].includes(method)) return fail(400, 'Invalid payment method.');

  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  // Expected price: per-rendor override wins, else global setting.
  const override = parseFloat(user.rendor_sub_price_override);
  let expectedUnit = Number.isFinite(override) && override > 0 ? override : parseFloat(await adapter.getSetting('rendor_sub_price', ''));
  if (!Number.isFinite(expectedUnit) || expectedUnit <= 0) expectedUnit = 30;
  const expectedTotal = r2(expectedUnit * months);
  if (Math.round(amount * 100) !== Math.round(expectedTotal * 100) && Math.round(amount * 100) !== Math.round(expectedUnit * 100)) {
    // Admin changed the fee while this rendor had the payment screen open. The
    // old rejection was a bare "The subscription costs GHS X." — technically
    // true, impossible to act on. Name the new fee in a full sentence and tag
    // the response so the client can refresh the price and let them pay again.
    const period = months === 1 ? '1 month' : `${months} months`;
    return fail(400,
      `The subscription fee is now GHS ${expectedTotal.toFixed(2)} for ${period}. Please check the new fee and pay again.`,
      'price_changed',
      { expected: expectedTotal, unit: expectedUnit, months }
    );
  }

  // Idempotency: a retried request with the same payment_ref must not double-activate.
  const ref = String(body.payment_ref || 'RENDORSUB-' + Date.now());
  try {
    const mine = await adapter.listUserTxns(viewer.userId);
    const dup = mine.find(t => t.type === 'payment' && String(t.reference || '') === ref);
    if (dup) return ok({ already: true, expiry: user.rendor_sub_expiry });
  } catch (e) {}

  const row = {
    user_id: viewer.userId,
    type: 'payment',
    // Caller-supplied, but already constrained above to exactly one of the two
    // server-derived figures (this cycle's total, or one month of it), so a
    // client can never name its own price.
    amount,
    payment_method: method,
    reference: ref,
    status: 'completed',
    note: `Rendor Subscription: ${months}-month plan via ${method === 'momo' ? 'MoMo' : 'wallet'}`,
    reviewed_by: ''
  };

  let balAfter;
  let txn;
  if (method === 'wallet') {
    const res = await applyMove(adapter, { ...row, balanceDelta: -amount });
    if (!res.ok) return fail(res.status, res.error);
    balAfter = res.balanceAfter;
    txn = res.txn;
  } else {
    // A MoMo payment never touches the wallet — ledger-only row.
    balAfter = r2(user.wallet_balance || 0);
    txn = await writeTxn(adapter, { ...row, balance_before: balAfter, balance_after: balAfter });
    if (!txn) return fail(500, 'Could not record the transaction. Subscription was NOT activated.');
  }

  // Activate: extend from the current expiry on renewal, else start now.
  const now = Date.now();
  const curMs = Number(user.rendor_sub_expiry);
  const startFrom = Number.isFinite(curMs) && curMs > now ? curMs : now;
  const newExpiry = new Date(startFrom + months * 30 * 86400000);
  const planId = months + 'month';

  // saveUser reports whether the primary store accepted the write, so a
  // silent write failure surfaces as an error — never a false "subscription
  // active" toast.
  let saved = false;
  try { saved = await adapter.saveUser(viewer.userId, {
    rendor_sub_status: 'active',
    rendor_sub_plan: planId,
    rendor_sub_expiry: String(newExpiry.getTime())
  }); } catch (e) {}
  if (!saved) {
    console.warn('[Wallet] rendor-subscribe: activation did not persist for', viewer.userId);
    return fail(500, 'Your payment was recorded but the subscription could not be activated. Please contact admin for help.');
  }

  // Platform revenue so the admin dashboard reflects the payment.
  try {
    await adapter.insert('platform_revenue', {
      source: 'subscription',
      amount,
      reference: ref,
      description: `Rendor Subscription: ${months}-month plan (GHS ${amount.toFixed(2)})`,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('[Wallet] rendor platform_revenue record failed:', e && e.message || e);
  }

  return ok({ balance: balAfter, expiry: String(newExpiry.getTime()), plan: planId, txn });
}

/**
 * POST /api/wallet/purchase — { amount, note }
 * Deducts the session user's wallet for a platform purchase (e.g. buying a
 * store slot). Ledger + balance move atomically; admin-only balance patches
 * stay blocked.
 */
async function purchase(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) === 'rendor') {
    return fail(403, 'Rendors do not have a wallet.');
  }
  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid purchase amount.');
  }
  const res = await applyMove(adapter, {
    user_id: viewer.userId,
    type: 'purchase',
    amount,
    balanceDelta: -amount,
    payment_method: 'wallet',
    reference: String(body.payment_ref || 'PUR' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000)),
    status: 'completed',
    note: String(body.note || 'Platform purchase'),
    reviewed_by: ''
  });
  if (!res.ok) return fail(res.status, res.error);
  return ok({ balance: res.balanceAfter, txn: res.txn });
}

/**
 * POST /api/wallet/storefront-payout — { package_id, payment }
 * Called right after a storefront order package is created. Credits the store
 * vendor (prepaid orders) and the platform admin (1% fee on every storefront
 * order). Amounts are re-derived from the package row — never from the client.
 * Idempotent via the package's sf_payout_done flag.
 */
async function storefrontPayout(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  const packageId = String((body && body.package_id) || '');
  if (!packageId) return fail(400, 'package_id is required.');
  const pkg = await adapter.loadPackage(packageId);
  if (!pkg) return fail(404, 'Package not found.');
  const isSf = String(pkg.order_source || '') === 'storefront' || !!pkg.storefront_id;
  if (!isSf) return fail(400, 'Not a storefront order.');
  if (pkg.sf_payout_done) return ok({ already: true });

  // Amounts are re-derived from the package's own items — a stored
  // vendor_amount/platform_fee can come from a crafted request (the create
  // path is now hardened too, but legacy/crafted rows must not pay out).
  const items = Array.isArray(pkg.items) ? pkg.items : [];
  const derivedGross = r2(items.reduce((s, i) => s + (parseFloat(i && i.price) || 0) * (parseInt(i && i.qty) || 1), 0));
  const storedGross = r2(pkg.gross_amount != null ? pkg.gross_amount : pkg.vendor_amount);
  // Trust the derived total when the stored one disagrees (crafted row) or is missing.
  const gross = (storedGross > 0 && Math.abs(storedGross - derivedGross) < 0.01) ? storedGross : derivedGross;
  const vendorShare = gross;
  const adminShare = r2(gross * 0.01);
  const pCode = pkg.package_code || pkg.code || pkg.id || '';
  const payment = String((body && body.payment) || 'momo');
  const source = `Storefront order from ${pkg.storefront_name || pkg.store_id || 'store'}`;

  // Prepaid storefront orders pay the vendor immediately at checkout.
  if (payment !== 'cod' && vendorShare > 0 && pkg.vendor_id) {
    // Reference keyed on the package id so a retried payout can never credit
    // the vendor twice — the unique (user_id, type, reference) index makes the
    // second attempt an idempotent no-op instead of a duplicate earning.
    const res = await applyMove(adapter, {
      user_id: pkg.vendor_id,
      type: 'earning',
      amount: vendorShare,
      payment_method: 'system',
      reference: 'SFP-' + packageId,
      status: 'completed',
      // (#15) Link the ledger row to the package by id — note text is
      // display-only; reconciliation must not string-match notes.
      package_id: packageId,
      note: `${source} — payout ${pCode} (${vendorShare.toFixed(2)} direct payout)`,
      reviewed_by: ''
    });
    if (!res.ok) console.warn('[Wallet] Storefront vendor payout failed for', pCode, ':', res.error);
  }

  // Platform fee (1%): credited to the admin wallet on EVERY storefront order,
  // regardless of payment method.
  if (adminShare > 0) {
    const admin = await adapter.loadAdmin();
    if (admin) {
      const res = await applyMove(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: adminShare,
        payment_method: 'system',
        reference: 'SFC-' + packageId,
        status: 'completed',
        package_id: packageId, // (#15) structured package link
        note: `${source} — platform fee ${pCode} (${adminShare.toFixed(2)})`,
        reviewed_by: ''
      });
      if (!res.ok) console.warn('[Wallet] Storefront platform fee failed for', pCode, ':', res.error);
    }
  }

  try {
    await adapter.insert('platform_revenue', {
      source: 'platform_fee',
      amount: adminShare,
      reference: pCode || 'SF-' + Date.now(),
      description: `Platform fee (1%) on storefront order ${pCode} — ${pkg.storefront_name || ''}`,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('[Wallet] platform_revenue record failed:', e && e.message || e);
  }

  await adapter.update('packages', pkg.id, { sf_payout_done: true });
  return ok({ vendorShare, adminShare });
}

/**
 * POST /api/wallet/release-delivery — { package_id }
 * Admin (main-site orders) or the package's own vendor (storefront orders) marks
 * delivery: pays the vendor earnings, credits the platform commission/fee, and
 * pays referral rewards. Idempotent via the ledger guard (an 'earning' txn for
 * the vendor already containing the package code means it was released).
 */
async function releaseDelivery(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  const packageId = String((body && body.package_id) || '');
  if (!packageId) return fail(400, 'package_id is required.');
  const pkg = await adapter.loadPackage(packageId);
  if (!pkg) return fail(404, 'Package not found.');

  const isAdmin = String(viewer.role) === 'admin';
  if (!isAdmin && String(pkg.vendor_id || '') !== String(viewer.userId)) {
    return fail(403, 'You can only release delivery for your own orders.');
  }

  const pCode = pkg.package_code || pkg.code || pkg.id || '';
  if (!pkg.vendor_id || !pCode) return ok({ already: true });

  // (#15) Settlement guard: prefer the package's structured settlement_status
  // (pending → released | refunded), falling back to ledger matching by the
  // package's OWN id (not note text — two packages can share note fragments).
  if (pkg.settlement_status === 'released' || pkg.settlement_status === 'refunded') {
    return ok({ already: true, settlement: pkg.settlement_status });
  }
  const vendorTxns = await adapter.listUserTxns(pkg.vendor_id);
  const alreadyReleased = vendorTxns.some(t =>
    String(t.user_id) === String(pkg.vendor_id) &&
    t.type === 'earning' &&
    (String(t.package_id || '') === String(pkg.id) || String(t.note || '').includes(String(pCode)))
  );
  if (alreadyReleased) return ok({ already: true });

  const earnAmt = r2(pkg.vendor_amount);
  const commAmt = r2(pkg.commission_amount);
  const sfFee = r2(pkg.platform_fee);
  const isSf = String(pkg.order_source || '') === 'storefront';

  // 1. Vendor earnings.
  if (earnAmt > 0) {
    const res = await applyMove(adapter, {
      user_id: pkg.vendor_id,
      type: 'earning',
      amount: earnAmt,
      payment_method: 'system',
      status: 'completed',
      reference: 'REL-' + packageId, // unique per package → safe idempotency key
      package_id: packageId, // (#15) structured link
      note: `Earnings released: ${pCode} — GHS ${earnAmt.toFixed(2)} paid to vendor (commission GHS ${commAmt.toFixed(2)} retained by platform)`,
      reviewed_by: ''
    });
    if (!res.ok) console.warn('[Wallet] Delivery vendor payout failed for', pCode, ':', res.error);
    // (#15) Mark settled so a refund can never also release (or vice versa).
    await markSettlement(adapter, packageId, 'released');
  }

  // 2. Platform commission + main-site platform fee (storefront fees already
  //    credited to the admin wallet at checkout).
  const adminShare = commAmt + (!isSf ? sfFee : 0);
  if (adminShare > 0) {
    const admin = await adapter.loadAdmin();
    if (admin) {
      const res = await applyMove(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: adminShare,
        payment_method: 'system',
        status: 'completed',
        reference: 'COMM-' + packageId,
        package_id: packageId,
        note: `Platform earnings: ${pCode} — GHS ${adminShare.toFixed(2)} (commission GHS ${commAmt.toFixed(2)}${!isSf && sfFee > 0 ? ` + platform fee GHS ${sfFee.toFixed(2)}` : ''})`,
        reviewed_by: ''
      });
      if (!res.ok) console.warn('[Wallet] Delivery admin earnings failed for', pCode, ':', res.error);
    }
  }

  // 3. Referral rewards for the buyer's referrer.
  try {
    const tiersRaw = await adapter.getSetting('referral_commission_tiers', '[]');
    let tiers = [];
    try { tiers = JSON.parse(tiersRaw); } catch (e) {}
    // Flat fallback rate (Settings → referral reward %). Without this the field
    // was inert: with no tier table every reward was silently paid at 3%.
    const flatPct = Number(await adapter.getSetting('referral_reward_pct', '3'));
    const referrals = await adapter.listActiveReferrals(pkg.buyer_id);
    for (const refItem of referrals) {
      const pct = referralPctFor(tiers, earnAmt, flatPct);
      const reward = r2(earnAmt * (pct / 100));
      if (reward <= 0) continue;
      const referrer = await adapter.loadUser(refItem.referrer_id);
      if (!referrer) continue;
      await adapter.update('referrals', refItem.id, {
        reward_amount: reward,
        reward_pct: pct,
        order_id: pkg.order_id || pkg.id,
        status: 'completed'
      });
      const res = await applyMove(adapter, {
        user_id: refItem.referrer_id,
        type: 'referral_reward',
        amount: reward,
        payment_method: 'system',
        status: 'completed',
        reference: 'REF-' + packageId,
        package_id: packageId,
        note: `Referral Reward: Earned ${pct}% on referred purchase by ${pkg.buyer_name || 'referred buyer'} (${pCode})`,
        reviewed_by: ''
      });
      if (!res.ok) console.warn('[Wallet] Referral reward failed for', pCode, ':', res.error);
    }
  } catch (e) {
    console.warn('[Wallet] Referral reward processing error:', e && e.message || e);
  }

  await adapter.update('packages', pkg.id, { balance_released: true });
  return ok({ released: true });
}

/**
 * POST /api/wallet/refund-reject — { package_id, reason }
 * Admin or the package's own vendor rejects an order: refunds the buyer
 * (product + delivery, minus the retained platform fee), claws back storefront
 * prepaid payouts, and credits the retained main-site fee to the admin wallet
 * so the revenue stats always match real money. Idempotent via the package's
 * refund_recorded flag.
 */
async function refundReject(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  const packageId = String((body && body.package_id) || '');
  if (!packageId) return fail(400, 'package_id is required.');
  const pkg = await adapter.loadPackage(packageId);
  if (!pkg) return fail(404, 'Package not found.');

  const isAdmin = String(viewer.role) === 'admin';
  if (!isAdmin && String(pkg.vendor_id || '') !== String(viewer.userId)) {
    return fail(403, 'You can only reject your own orders.');
  }
  if (pkg.refund_recorded) return ok({ already: true, refundAmt: r2(pkg.refund_recorded) });
  // (#15) A released order has already paid the vendor: refunding it too would
  // hand the money out twice. Only an explicit admin reconciliation may undo a
  // settled payout, so refuse instead of silently double-settling.
  if (String(pkg.settlement_status || '') === 'released') {
    return fail(409, 'This order was already settled to the vendor and cannot be rejected. Contact support to reverse the payout first.');
  }
  if (String(pkg.settlement_status || '') === 'refunded') {
    return ok({ already: true, refundAmt: r2(pkg.refund_recorded) || 0 });
  }

  const pCode = pkg.package_code || pkg.code || pkg.id || '';
  const reason = String((body && body.reason) || 'Product unavailable');

  const productCost = r2(pkg.gross_amount != null
    ? pkg.gross_amount
    : (Array.isArray(pkg.items) ? pkg.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0) : 0));
  const deliveryFee = r2(pkg.delivery_fee || 0);
  const refundAmt = r2(productCost + deliveryFee);

  const wasPaid = String(pkg.payment_status || '').toLowerCase() !== 'pending'
    && String(pkg.payment_method || '').toLowerCase() !== 'cod';

  // 1. Refund the buyer (only if they actually paid).
  if (pkg.buyer_id && wasPaid && refundAmt > 0) {
    const buyer = await adapter.loadUser(pkg.buyer_id);
    if (buyer) {
      const res = await applyMove(adapter, {
        user_id: pkg.buyer_id,
        type: 'refund',
        amount: refundAmt,
        payment_method: 'wallet',
        status: 'completed',
        reference: 'RFD-' + packageId,
        package_id: packageId,
        note: `Refund for rejected order ${pCode}: ${reason}`,
        reviewed_by: viewer.userId || ''
      });
      if (!res.ok) console.warn('[Wallet] Refund failed for', pCode, ':', res.error);
    } else {
      // Guest refund tracking record.
      await writeTxn(adapter, {
        user_id: pkg.buyer_id,
        type: 'refund',
        amount: refundAmt,
        payment_method: 'guest_refund',
        status: 'completed',
        reference: 'RFD-' + packageId,
        note: `Guest Refund (${pkg.buyer_name || 'Guest'} - ${pkg.buyer_phone || 'N/A'}): Order ${pCode} rejected. Reason: ${reason}`,
        reviewed_by: viewer.userId || ''
      });
    }
  }

  // 2. Claw back storefront prepaid payouts (platform refunds the buyer AND the
  //    vendor keeps the money otherwise).
  const vendorPaidAmt = r2(pkg.vendor_amount);
  const vendorWasPaid = !!pkg.balance_released
    && String(pkg.payment_status || '').toLowerCase() !== 'pending'
    && vendorPaidAmt > 0;
  if (vendorWasPaid && pkg.vendor_id) {
    const vendor = await adapter.loadUser(pkg.vendor_id);
    if (vendor) {
      const vb = r2(vendor.wallet_balance || 0);
      const clawback = Math.min(vendorPaidAmt, vb);
      if (clawback > 0) {
        const res = await applyMove(adapter, {
          user_id: pkg.vendor_id,
          type: 'reversal',
          amount: clawback,
          balanceDelta: -clawback,
          payment_method: 'system',
          status: 'completed',
          reference: 'REV-' + packageId,
          package_id: packageId,
          note: `Payout reversal: order ${pCode} was rejected — GHS ${clawback.toFixed(2)} clawed back from vendor`,
          reviewed_by: viewer.userId || ''
        });
        if (!res.ok) console.warn('[Wallet] Clawback failed for', pCode, ':', res.error);
      }
    }
  }

  // 3. The platform retains the fee on rejected orders (per the refund copy),
  //    so for main-site orders credit the admin wallet now — otherwise the
  //    revenue stats show a fee the admin wallet never received. Storefront
  //    orders already credited the admin fee at checkout.
  const isSf = String(pkg.order_source || '') === 'storefront';
  const retainedFee = r2(pkg.platform_fee);
  if (!isSf && retainedFee > 0) {
    const admin = await adapter.loadAdmin();
    if (admin) {
      const res = await applyMove(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: retainedFee,
        payment_method: 'system',
        status: 'completed',
        reference: 'FEE-' + packageId,
        package_id: packageId,
        note: `Retained platform fee (rejected order ${pCode}) — GHS ${retainedFee.toFixed(2)}`,
        reviewed_by: viewer.userId || ''
      });
      if (!res.ok) console.warn('[Wallet] Retained fee failed for', pCode, ':', res.error);
    }
  }

  await markSettlement(adapter, pkg.id, 'refunded');
  await adapter.update('packages', pkg.id, { refund_recorded: refundAmt > 0 ? refundAmt : true });
  return ok({ refundAmt, clawedBack: vendorWasPaid });
}

module.exports = {
  r2,
  referralPctFor,
  applyMove,
  rpcMoveBalance,
  writeTxn,
  buildTxnRow,
  deposit,
  withdraw,
  pay,
  purchase,
  rendorSubscribe,
  storefrontPayout,
  releaseDelivery,
  refundReject
};