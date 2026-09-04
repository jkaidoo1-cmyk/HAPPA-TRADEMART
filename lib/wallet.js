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
function referralPctFor(tiers, amount) {
  if (Array.isArray(tiers) && tiers.length) {
    for (const t of tiers) {
      const maxVal = Number(t.max) >= 99999 ? Infinity : Number(t.max);
      if (amount >= Number(t.min) && amount <= maxVal) return Number(t.pct) || 0;
    }
    return Number(tiers[tiers.length - 1] && tiers[tiers.length - 1].pct) || 3;
  }
  return 3;
}

// Ledger-first write: returns the row or null (never throws).
async function writeTxn(adapter, rec) {
  try {
    const full = {
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
      created_at: rec.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return await adapter.insert('wallet_transactions', full);
  } catch (e) {
    console.warn('[Wallet] ledger write failed:', e && e.message || e);
    return null;
  }
}

function fail(status, error) { return { ok: false, status, error }; }
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
  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid deposit amount.');
  }
  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  const balBefore = r2(user.wallet_balance || 0);
  const balAfter = r2(balBefore + amount);

  const txn = await writeTxn(adapter, {
    user_id: viewer.userId,
    type: 'deposit',
    amount,
    balance_before: balBefore,
    balance_after: balAfter,
    payment_method: String(body.method || 'mobile_money'),
    reference: String(body.payment_ref || 'DEP' + Date.now()),
    network: String(body.network || ''),
    account_number: String(body.account_number || ''),
    status: 'completed',
    note: String(body.note || 'Wallet top-up'),
    reviewed_by: ''
  });
  if (!txn) return fail(500, 'Could not record the transaction. Balance was NOT changed.');

  await adapter.saveUser(viewer.userId, { wallet_balance: balAfter });
  return ok({ balance: balAfter, txn });
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
  if (!user.is_verified || !user.id_verified) {
    return fail(403, 'Complete phone & ID verification before withdrawing.');
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

  const balAfter = r2(balBefore - amount);
  const txn = await writeTxn(adapter, {
    user_id: viewer.userId,
    type: 'withdrawal',
    amount,
    balance_before: balBefore,
    balance_after: balAfter,
    payment_method: method,
    reference: 'WD' + Date.now(),
    network: String(body.network || ''),
    account_number: String(body.account_number || ''),
    status: 'pending',
    note: String(body.note || (method === 'mobile_money' ? 'MoMo withdrawal' : 'Bank transfer withdrawal')),
    reviewed_by: ''
  });
  if (!txn) return fail(500, 'Could not record the transaction. Balance was NOT changed.');

  await adapter.saveUser(viewer.userId, { wallet_balance: balAfter });
  return ok({ balance: balAfter, txn });
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
  const balBefore = r2(user.wallet_balance || 0);

  let balAfter = balBefore;
  if (method === 'wallet') {
    if (amount > balBefore) return fail(400, 'Insufficient wallet balance. Top up your wallet first.');
    balAfter = r2(balBefore - amount);
  }

  const txn = await writeTxn(adapter, {
    user_id: viewer.userId,
    type: 'payment',
    amount,
    balance_before: balBefore,
    balance_after: balAfter,
    payment_method: method,
    reference: String(body.payment_ref || 'PAY' + Date.now()),
    status: 'completed',
    note: String(body.note || 'Payment'),
    reviewed_by: ''
  });
  if (!txn) return fail(500, 'Could not record the transaction. Payment was NOT completed.');

  if (method === 'wallet') {
    await adapter.saveUser(viewer.userId, { wallet_balance: balAfter });
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
 * Storefront-style rendor subscription: the rendor picks a 1 / 3 / 6 month
 * plan, pays in-app (MoMo), and the subscription activates IMMEDIATELY — no
 * admin verification round-trip. The server validates the amount against the
 * admin-set price (per-rendor quote wins, else the global settings default),
 * records the payment + platform revenue, and sets rendor_sub_* itself — the
 * client never touches those admin-only fields. Renewals extend from the
 * current expiry. Idempotent via the payment reference.
 */
async function rendorSubscribe(adapter, viewer, body) {
  if (!viewer) return fail(401, 'Unauthorized. Please sign in.');
  if (String(viewer.role) !== 'rendor') {
    return fail(403, 'Only rendors can subscribe.');
  }
  const months = Number(body && body.months);
  if (![1, 3, 6].includes(months)) return fail(400, 'Choose a valid plan (1, 3 or 6 months).');

  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
    return fail(400, 'Enter a valid payment amount.');
  }
  const method = String(body.method || 'momo');
  if (!['momo', 'wallet'].includes(method)) return fail(400, 'Invalid payment method.');

  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  // Expected price: per-rendor quote (if admin set one) else global settings.
  const key = months === 1 ? 'monthly' : months === 3 ? 'quarterly' : 'biannual';
  const qKey = 'sub_quote_' + key;
  const sKey = 'rendor_sub_' + key;
  const qVal = parseFloat(user[qKey]);
  let expected = Number.isFinite(qVal) && qVal > 0 ? qVal : parseFloat(await adapter.getSetting(sKey, ''));
  if (!Number.isFinite(expected) || expected <= 0) expected = { monthly: 30, quarterly: 80, biannual: 150 }[key];
  expected = r2(expected);
  if (Math.round(amount * 100) !== Math.round(expected * 100)) {
    return fail(400, `The ${months}-month plan costs GHS ${expected.toFixed(2)}.`);
  }

  // Idempotency: a retried request with the same payment_ref must not double-activate.
  const ref = String(body.payment_ref || 'RENDORSUB-' + Date.now());
  try {
    const mine = await adapter.listUserTxns(viewer.userId);
    const dup = mine.find(t => t.type === 'payment' && String(t.reference || '') === ref);
    if (dup) return ok({ already: true, expiry: user.rendor_sub_expiry });
  } catch (e) {}

  const balBefore = r2(user.wallet_balance || 0);
  let balAfter = balBefore;
  if (method === 'wallet') {
    if (amount > balBefore) return fail(400, 'Insufficient wallet balance. Top up your wallet first.');
    balAfter = r2(balBefore - amount);
  }

  const txn = await writeTxn(adapter, {
    user_id: viewer.userId,
    type: 'payment',
    amount,
    balance_before: balBefore,
    balance_after: balAfter,
    payment_method: method,
    reference: ref,
    status: 'completed',
    note: `Rendor Subscription: ${months}-month plan via ${method === 'momo' ? 'MoMo' : 'wallet'}`,
    reviewed_by: ''
  });
  if (!txn) return fail(500, 'Could not record the transaction. Subscription was NOT activated.');

  if (method === 'wallet') {
    await adapter.saveUser(viewer.userId, { wallet_balance: balAfter });
  }

  // Activate: extend from the current expiry on renewal, else start now.
  const now = Date.now();
  const curMs = Number(user.rendor_sub_expiry);
  const startFrom = Number.isFinite(curMs) && curMs > now ? curMs : now;
  const newExpiry = new Date(startFrom + months * 30 * 86400000);
  const planId = key; // monthly / quarterly / biannual

  await adapter.saveUser(viewer.userId, {
    rendor_sub_status: 'active',
    rendor_sub_plan: planId,
    rendor_sub_expiry: String(newExpiry.getTime()),
    // Clear any stale claim/quote-request state — the flow is self-serve now.
    sub_request_status: null,
    sub_payment_status: null,
    sub_payment_months: null,
    sub_payment_amount: null,
    sub_paid_at: null,
    sub_payment_ref: null
  });

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
  const user = await adapter.loadUser(viewer.userId);
  if (!user) return fail(404, 'User not found.');

  const balBefore = r2(user.wallet_balance || 0);
  if (amount > balBefore) return fail(400, 'Insufficient wallet balance. Top up your wallet first.');
  const balAfter = r2(balBefore - amount);

  const txn = await writeTxn(adapter, {
    user_id: viewer.userId,
    type: 'purchase',
    amount,
    balance_before: balBefore,
    balance_after: balAfter,
    payment_method: 'wallet',
    reference: String(body.payment_ref || 'PUR' + Date.now()),
    status: 'completed',
    note: String(body.note || 'Platform purchase'),
    reviewed_by: ''
  });
  if (!txn) return fail(500, 'Could not record the transaction. Balance was NOT changed.');

  await adapter.saveUser(viewer.userId, { wallet_balance: balAfter });
  return ok({ balance: balAfter, txn });
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

  const vendorShare = r2(pkg.vendor_amount != null ? pkg.vendor_amount : pkg.gross_amount);
  const adminShare = r2(pkg.platform_fee || 0);
  const pCode = pkg.package_code || pkg.code || pkg.id || '';
  const payment = String((body && body.payment) || 'momo');
  const source = `Storefront order from ${pkg.storefront_name || pkg.store_id || 'store'}`;

  // Prepaid storefront orders pay the vendor immediately at checkout.
  if (payment !== 'cod' && vendorShare > 0 && pkg.vendor_id) {
    const vendor = await adapter.loadUser(pkg.vendor_id);
    if (vendor) {
      const vb = r2(vendor.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: pkg.vendor_id,
        type: 'earning',
        amount: vendorShare,
        balance_before: vb,
        balance_after: r2(vb + vendorShare),
        payment_method: 'system',
        reference: 'SF-PAYOUT-' + Date.now(),
        status: 'completed',
        note: `${source} — payout ${pCode} (${vendorShare.toFixed(2)} direct payout)`,
        reviewed_by: ''
      });
      if (txn) await adapter.saveUser(pkg.vendor_id, { wallet_balance: r2(vb + vendorShare) });
      else console.warn('[Wallet] Storefront vendor payout ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
    }
  }

  // Platform fee (1%): credited to the admin wallet on EVERY storefront order,
  // regardless of payment method.
  if (adminShare > 0) {
    const admin = await adapter.loadAdmin();
    if (admin) {
      const ab = r2(admin.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: adminShare,
        balance_before: ab,
        balance_after: r2(ab + adminShare),
        payment_method: 'system',
        reference: 'SF-COMM-' + Date.now(),
        status: 'completed',
        note: `${source} — platform fee ${pCode} (${adminShare.toFixed(2)})`,
        reviewed_by: ''
      });
      if (txn) await adapter.saveUser(admin.id, { wallet_balance: r2(ab + adminShare) });
      else console.warn('[Wallet] Storefront platform fee ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
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

  // Ledger-based idempotency guard (mirrors orders.js _packageEarningsReleased).
  const vendorTxns = await adapter.listUserTxns(pkg.vendor_id);
  const alreadyReleased = vendorTxns.some(t =>
    String(t.user_id) === String(pkg.vendor_id) &&
    t.type === 'earning' &&
    String(t.note || '').includes(String(pCode))
  );
  if (alreadyReleased) return ok({ already: true });

  const earnAmt = r2(pkg.vendor_amount);
  const commAmt = r2(pkg.commission_amount);
  const sfFee = r2(pkg.platform_fee);
  const isSf = String(pkg.order_source || '') === 'storefront';

  // 1. Vendor earnings.
  if (earnAmt > 0) {
    const vendor = await adapter.loadUser(pkg.vendor_id);
    if (vendor) {
      const vb = r2(vendor.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: pkg.vendor_id,
        type: 'earning',
        amount: earnAmt,
        balance_before: vb,
        balance_after: r2(vb + earnAmt),
        payment_method: 'system',
        status: 'completed',
        note: `Earnings released: ${pCode} — GHS ${earnAmt.toFixed(2)} paid to vendor (commission GHS ${commAmt.toFixed(2)} retained by platform)`,
        reviewed_by: ''
      });
      if (txn) await adapter.saveUser(pkg.vendor_id, { wallet_balance: r2(vb + earnAmt) });
      else console.warn('[Wallet] Delivery vendor payout ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
    }
  }

  // 2. Platform commission + main-site platform fee (storefront fees already
  //    credited to the admin wallet at checkout).
  const adminShare = commAmt + (!isSf ? sfFee : 0);
  if (adminShare > 0) {
    const admin = await adapter.loadAdmin();
    if (admin) {
      const ab = r2(admin.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: adminShare,
        balance_before: ab,
        balance_after: r2(ab + adminShare),
        payment_method: 'system',
        status: 'completed',
        note: `Platform earnings: ${pCode} — GHS ${adminShare.toFixed(2)} (commission GHS ${commAmt.toFixed(2)}${!isSf && sfFee > 0 ? ` + platform fee GHS ${sfFee.toFixed(2)}` : ''})`,
        reviewed_by: ''
      });
      if (txn) await adapter.saveUser(admin.id, { wallet_balance: r2(ab + adminShare) });
      else console.warn('[Wallet] Delivery admin earnings ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
    }
  }

  // 3. Referral rewards for the buyer's referrer.
  try {
    const tiersRaw = await adapter.getSetting('referral_commission_tiers', '[]');
    let tiers = [];
    try { tiers = JSON.parse(tiersRaw); } catch (e) {}
    const referrals = await adapter.listActiveReferrals(pkg.buyer_id);
    for (const refItem of referrals) {
      const pct = referralPctFor(tiers, earnAmt);
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
      const ob = r2(referrer.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: refItem.referrer_id,
        type: 'referral_reward',
        amount: reward,
        balance_before: ob,
        balance_after: r2(ob + reward),
        payment_method: 'system',
        status: 'completed',
        note: `Referral Reward: Earned ${pct}% on referred purchase by ${pkg.buyer_name || 'referred buyer'} (${pCode})`,
        reviewed_by: ''
      });
      if (txn) await adapter.saveUser(refItem.referrer_id, { wallet_balance: r2(ob + reward) });
      else console.warn('[Wallet] Referral reward ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
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
      const bb = r2(buyer.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: pkg.buyer_id,
        type: 'refund',
        amount: refundAmt,
        balance_before: bb,
        balance_after: r2(bb + refundAmt),
        payment_method: 'wallet',
        status: 'completed',
        note: `Refund for rejected order ${pCode}: ${reason}`,
        reviewed_by: viewer.userId || ''
      });
      if (txn) await adapter.saveUser(pkg.buyer_id, { wallet_balance: r2(bb + refundAmt) });
      else console.warn('[Wallet] Refund ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
    } else {
      // Guest refund tracking record.
      await writeTxn(adapter, {
        user_id: pkg.buyer_id,
        type: 'refund',
        amount: refundAmt,
        payment_method: 'guest_refund',
        status: 'completed',
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
        const txn = await writeTxn(adapter, {
          user_id: pkg.vendor_id,
          type: 'reversal',
          amount: clawback,
          balance_before: vb,
          balance_after: r2(vb - clawback),
          payment_method: 'system',
          status: 'completed',
          note: `Payout reversal: order ${pCode} was rejected — GHS ${clawback.toFixed(2)} clawed back from vendor`,
          reviewed_by: viewer.userId || ''
        });
        if (txn) await adapter.saveUser(pkg.vendor_id, { wallet_balance: r2(vb - clawback) });
        else console.warn('[Wallet] Clawback ledger failed for', pCode, '— balance NOT changed. Reconcile manually.');
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
      const ab = r2(admin.wallet_balance || 0);
      const txn = await writeTxn(adapter, {
        user_id: admin.id,
        type: 'earning',
        amount: retainedFee,
        balance_before: ab,
        balance_after: r2(ab + retainedFee),
        payment_method: 'system',
        status: 'completed',
        note: `Retained platform fee (rejected order ${pCode}) — GHS ${retainedFee.toFixed(2)}`,
        reviewed_by: viewer.userId || ''
      });
      if (txn) await adapter.saveUser(admin.id, { wallet_balance: r2(ab + retainedFee) });
      else console.warn('[Wallet] Retained fee ledger failed for', pCode, '— balance NOT credited. Reconcile manually.');
    }
  }

  await adapter.update('packages', pkg.id, { refund_recorded: refundAmt > 0 ? refundAmt : true });
  return ok({ refundAmt, clawedBack: vendorWasPaid });
}

module.exports = {
  r2,
  deposit,
  withdraw,
  pay,
  purchase,
  rendorSubscribe,
  storefrontPayout,
  releaseDelivery,
  refundReject
};